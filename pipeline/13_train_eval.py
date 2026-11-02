"""Train the learned linkage model and test it leave-one-region-out against fixed space-time windows.

For each of six US regions: train on the other five (2020-2024), predict "same fire?" probabilities
for every candidate pair inside the held-out region, link pairs with p >= tau, and take connected
components (single linkage, as in the fixed-window rule). Compare against
  - Cattau et al. (2016) default window (1.5 km, 4 days)
  - the best fixed window chosen on the other five regions (a fair, tuned baseline)
  - the best fixed window chosen on the held-out region itself (an oracle no real user would have)

Outputs: data/models/*.joblib, data/national/oof_<year>.npy, web/data/learned.json
"""
import json
import pathlib
import time

import joblib
import numpy as np
from pyproj import Transformer
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.inspection import permutation_importance

from linkfeat import FEATURES

ROOT = pathlib.Path(__file__).resolve().parents[1]
NAT, MOD, WEB = ROOT / "data/national", ROOT / "data/models", ROOT / "web/data"
MOD.mkdir(parents=True, exist_ok=True)
YEARS = list(range(2020, 2025))
REGIONS = ["Pacific Northwest", "California", "Southwest", "Great Basin & N. Rockies", "Plains", "East"]
D_GRID = [0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 7.5, 10.0]
T_GRID = [0.5, 1.0, 2.0, 3.0, 4.0, 7.0, 10.0, 14.0]
COMBOS = [(d, T) for d in D_GRID for T in T_GRID]
TAUS = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]
DEFAULT = (1.5, 4.0)
CAP_PER_FIRE = 5000
RNG = np.random.default_rng(7)

perims = json.loads((NAT / "perimeters.json").read_text())
to_albers = Transformer.from_crs(4326, 5070, always_xy=True)
ox, oy = to_albers.transform([p["olon"] or np.nan for p in perims], [p["olat"] or np.nan for p in perims])
ORIGIN = np.column_stack([np.asarray(ox) / 1000, np.asarray(oy) / 1000])

D = {y: dict(np.load(NAT / f"dets_{y}.npz")) for y in YEARS}
P = {y: dict(np.load(NAT / f"pairs_{y}.npz")) for y in YEARS}
LAB = {y: np.load(NAT / f"lab_{y}.npy") for y in YEARS}
FEAT = {y: np.load(NAT / f"feat_{y}.npy", mmap_mode="r") for y in YEARS}
for y in YEARS:
    reg = D[y]["region"]
    P[y]["ri"], P[y]["rj"] = reg[P[y]["i"]], reg[P[y]["j"]]


def model():
    return HistGradientBoostingClassifier(
        max_iter=400, learning_rate=0.08, max_leaf_nodes=63, l2_regularization=1.0,
        class_weight="balanced", early_stopping=True, validation_fraction=0.1, random_state=0)


def training_rows(exclude_region=None):
    """Labelled pairs outside the held-out region, with each fire capped at CAP_PER_FIRE positive pairs
    so a few giant fires don't dominate."""
    Xs, ys = [], []
    for y in YEARS:
        lab, pr = LAB[y], P[y]
        ok = lab >= 0
        if exclude_region is not None:
            ok &= (pr["ri"] != exclude_region) & (pr["rj"] != exclude_region)
        idx = np.flatnonzero(ok)
        pos = idx[lab[idx] == 1]
        fire = D[y]["truth"][pr["i"][pos]]
        _, inv, cnt = np.unique(fire, return_inverse=True, return_counts=True)
        keep = RNG.random(len(pos)) < np.minimum(1.0, CAP_PER_FIRE / cnt[inv])
        rows = np.sort(np.concatenate([pos[keep], idx[lab[idx] == 0]]))
        Xs.append(np.asarray(FEAT[y][rows], dtype=np.float32))
        ys.append(lab[rows])
    return np.vstack(Xs), np.concatenate(ys)


def components(n, i, j):
    g = coo_matrix((np.ones(len(i), np.int8), (i, j)), shape=(n, n))
    return connected_components(g, directed=False)[1]


def fire_metrics(lab, truth, t, x, y):
    """Per official fire (>= 3 detections): recovered?, pieces, ignition error (km) if origin known."""
    out = []
    order = np.lexsort((t, lab))
    first_of = {}
    for k in order[::-1]:
        first_of[lab[k]] = k
    scored = truth != -2
    size = np.bincount(lab[scored], minlength=lab.max() + 1)
    for f in np.unique(truth[truth >= 0]):
        mine = np.flatnonzero(truth == f)
        if len(mine) < 3:
            continue
        ev, cnt = np.unique(lab[mine], return_counts=True)
        top = np.argmax(cnt)
        rec = cnt[top] / len(mine) >= 0.9 and cnt[top] / size[ev[top]] >= 0.9
        err = np.nan
        if np.isfinite(ORIGIN[f, 0]):
            i0 = first_of[ev[top]]
            err = float(np.hypot(x[i0] - ORIGIN[f, 0], y[i0] - ORIGIN[f, 1]))
        out.append((int(f), bool(rec), len(ev), err))
    return out


def region_view(y, r):
    """Detections of region r in year y and the pairs with both ends inside it (re-indexed)."""
    det, pr = D[y], P[y]
    idx = np.flatnonzero(det["region"] == r)
    remap = np.full(len(det["t"]), -1)
    remap[idx] = np.arange(len(idx))
    m = (pr["ri"] == r) & (pr["rj"] == r)
    return idx, remap[pr["i"][m]], remap[pr["j"][m]], pr["d"][m], pr["dt"][m], m


def summarize(rows):
    rec = [r[1] for r in rows]
    err = [r[3] for r in rows if np.isfinite(r[3])]
    return dict(recovered=round(float(np.mean(rec)), 4) if rec else None, n_fires=len(rec),
                ign_err_km=round(float(np.median(err)), 2) if err else None,
                pieces=round(float(np.mean([r[2] for r in rows])), 2) if rows else None)


def main():
    t0 = time.time()
    oof = {y: np.full(len(P[y]["i"]), np.nan, np.float32) for y in YEARS}

    # 1. leave-one-region-out models and out-of-fold probabilities
    for r, name in enumerate(REGIONS):
        X, yv = training_rows(exclude_region=r)
        m = model().fit(X, yv)
        joblib.dump(m, MOD / f"linkage_without_{r}.joblib")
        for y in YEARS:
            sel = (P[y]["ri"] == r) & (P[y]["rj"] == r)
            rows = np.flatnonzero(sel)
            for s in range(0, len(rows), 2_000_000):
                b = rows[s:s + 2_000_000]
                oof[y][b] = m.predict_proba(np.asarray(FEAT[y][b], dtype=np.float32))[:, 1]
        print(f"[{time.time() - t0:5.0f}s] trained without {name}: {len(yv):,} rows, {m.n_iter_} iterations")
    for y in YEARS:
        np.save(NAT / f"oof_{y}.npy", oof[y])

    # 2. per-fire outcomes for every method in every region
    fixed = {r: {c: [] for c in COMBOS} for r in range(len(REGIONS))}
    learned = {r: {tau: [] for tau in TAUS} for r in range(len(REGIONS))}
    for y in YEARS:
        det = D[y]
        for r in range(len(REGIONS)):
            idx, i, j, d, dt, m = region_view(y, r)
            if len(idx) == 0:
                continue
            tr, t, x, yy = det["truth"][idx], det["t"][idx], det["x"][idx], det["y"][idx]
            if not (tr >= 0).any():
                continue
            for c in COMBOS:
                k = (d <= c[0]) & (dt <= c[1])
                fixed[r][c] += fire_metrics(components(len(idx), i[k], j[k]), tr, t, x, yy)
            p = oof[y][m]
            for tau in TAUS:
                k = p >= tau
                learned[r][tau] += fire_metrics(components(len(idx), i[k], j[k]), tr, t, x, yy)
        print(f"[{time.time() - t0:5.0f}s] evaluated {y}")

    # 3. compare, choosing every tuned parameter WITHOUT looking at the held-out region
    def pooled(table, r_list, key):
        rows = [row for r in r_list for row in table[r][key]]
        return np.mean([row[1] for row in rows]) if rows else -1

    results = []
    for r, name in enumerate(REGIONS):
        others = [q for q in range(len(REGIONS)) if q != r]
        c_tuned = max(COMBOS, key=lambda c: pooled(fixed, others, c))
        c_oracle = max(COMBOS, key=lambda c: pooled(fixed, [r], c))
        tau_tuned = max(TAUS, key=lambda tau: pooled(learned, others, tau))
        L = learned[r][0.5]
        F = fixed[r][c_tuned]
        lw = sum(1 for a, b in zip(L, F) if a[1] and not b[1])
        fw = sum(1 for a, b in zip(L, F) if b[1] and not a[1])
        results.append(dict(
            region=name,
            default=summarize(fixed[r][DEFAULT]) | dict(d=DEFAULT[0], T=DEFAULT[1]),
            fixed_tuned=summarize(F) | dict(d=c_tuned[0], T=c_tuned[1]),
            fixed_oracle=summarize(fixed[r][c_oracle]) | dict(d=c_oracle[0], T=c_oracle[1]),
            learned=summarize(L) | dict(tau=0.5),
            learned_tuned=summarize(learned[r][tau_tuned]) | dict(tau=tau_tuned),
            only_learned=lw, only_fixed=fw))
        print(f"{name:26s} fires={results[-1]['learned']['n_fires']:4d}  default={results[-1]['default']['recovered']:.3f}"
              f"  fixed(tuned {c_tuned})={results[-1]['fixed_tuned']['recovered']:.3f}"
              f"  oracle {c_oracle}={results[-1]['fixed_oracle']['recovered']:.3f}"
              f"  learned={results[-1]['learned']['recovered']:.3f}  learned(tau {tau_tuned})={results[-1]['learned_tuned']['recovered']:.3f}"
              f"  only-learned={lw} only-fixed={fw}")

    allr = list(range(len(REGIONS)))
    def overall(get):
        rows = [row for r in allr for row in get(r)]
        return summarize(rows)
    tuned_by_region = {r: max(COMBOS, key=lambda c: pooled(fixed, [q for q in allr if q != r], c)) for r in allr}
    summary = dict(
        default=overall(lambda r: fixed[r][DEFAULT]),
        fixed_tuned=overall(lambda r: fixed[r][tuned_by_region[r]]),
        fixed_oracle=overall(lambda r: fixed[r][max(COMBOS, key=lambda c: pooled(fixed, [r], c))]),
        learned=overall(lambda r: learned[r][0.5]),
    )
    print("overall", json.dumps(summary))

    # 4. final model on all regions, and which features it relies on
    X, yv = training_rows(None)
    final = model().fit(X, yv)
    joblib.dump(final, MOD / "linkage_all_us.joblib")
    s = RNG.choice(len(yv), size=min(300_000, len(yv)), replace=False)
    imp = permutation_importance(final, X[s], yv[s], scoring="balanced_accuracy", n_repeats=3, random_state=0)
    importance = sorted(({"feature": f, "drop": round(float(v), 4)} for f, v in zip(FEATURES, imp.importances_mean)),
                        key=lambda q: -q["drop"])
    print("importance", importance[:6])

    WEB.joinpath("learned.json").write_text(json.dumps(dict(
        regions=results, overall=summary, importance=importance, taus=TAUS,
        n_fires=sum(r["learned"]["n_fires"] for r in results), years=YEARS,
        n_detections=int(sum(len(D[y]["t"]) for y in YEARS)),
        n_pairs=int(sum(len(P[y]["i"]) for y in YEARS))), indent=1))
    print(f"done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
