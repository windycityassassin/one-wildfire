"""Where should a person look? Event-level flagging and a simulated review budget.

Automatic rules plateau at ~75% of official fires recovered, and the remaining failures are mostly
separate fires that burned into each other. This script asks whether a model can rank fire events by
how likely they are to hide several fires, so that a small amount of human review (someone who knows
the place, or the incident records) recovers as many fires as possible.

1. Events = fixed window (4 km, 14 days), the best automatic rule found leave-one-region-out.
2. Event features: size, duration, extent, the number of separate ignition cores found by
   ignition-aware growth (growth.py), how far apart and how far apart in time those cores started,
   and the weakest learned link holding the event together (from out-of-fold linkage probabilities).
3. A classifier (trained leave-one-region-out) scores P(event contains 2+ official fires).
4. Simulated review: in each held-out region, events are reviewed in score order; a reviewed merged
   event is split into its official fires. Compared with reviewing at random and biggest-first.

Output: web/data/review.json
"""
import importlib
import json
import pathlib

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import minimum_spanning_tree
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import average_precision_score, roc_auc_score

from growth import grow

te = importlib.import_module("13_train_eval")
ROOT = pathlib.Path(__file__).resolve().parents[1]
WEB = ROOT / "web/data"
D_EV, T_EV = 4.0, 14.0
EV_FEATURES = ["log_size", "duration_days", "extent_km", "n_cores", "core_gap_km", "core_gap_days",
               "weakest_link", "n_weak_links", "peak_daily", "night_share"]
RNG = np.random.default_rng(11)


def event_table(y, r, oof):
    det = te.D[y]
    idx, i, j, d, dt, m = te.region_view(y, r)
    n = len(idx)
    if n == 0:
        return None
    t, x, yy = det["t"][idx], det["x"][idx], det["y"][idx]
    tr = det["truth"][idx]
    k = (d <= D_EV) & (dt <= T_EV)
    ev = te.components(n, i[k], j[k])
    core = grow(n, i, j, d, dt, t, D_EV, T_EV, 0.5)
    p = oof[y][m]
    # maximum spanning forest of linkage probability over the event's own links
    w = 1.0 - p[k] + 1e-6
    msf = minimum_spanning_tree(coo_matrix((w, (i[k], j[k])), shape=(n, n)).tocsr()).tocoo()
    msf_p = 1.0 - (msf.data - 1e-6)
    msf_ev = ev[msf.row]
    rows = []
    order = np.argsort(ev, kind="stable")
    bounds = np.flatnonzero(np.diff(ev[order])) + 1
    for members in np.split(order, bounds):
        if len(members) < 3:
            continue
        e = ev[members[0]]
        cores, ccount = np.unique(core[members], return_counts=True)
        big = cores[ccount >= 3]
        starts = sorted((t[members][core[members] == c].min(), c) for c in big)
        if len(starts) >= 2:
            (t1, c1), (t2, c2) = starts[0], starts[1]
            p1 = members[core[members] == c1][np.argmin(t[members][core[members] == c1])]
            p2 = members[core[members] == c2][np.argmin(t[members][core[members] == c2])]
            gap_km, gap_days = float(np.hypot(x[p1] - x[p2], yy[p1] - yy[p2])), float(t2 - t1)
        else:
            gap_km, gap_days = 0.0, 0.0
        pe = msf_p[msf_ev == e]
        days = np.floor(t[members])
        fires, fcnt = np.unique(tr[members][tr[members] >= 0], return_counts=True)
        labelled = (tr[members] >= 0).mean()
        rows.append(dict(
            region=r, year=y, event=int(e), members=members, idx=idx,
            feat=[np.log(len(members)), float(np.ptp(t[members])),
                  float(max(np.ptp(x[members]), np.ptp(yy[members]))), len(big), gap_km, gap_days,
                  float(pe.min()) if len(pe) else 1.0, int((pe < 0.5).sum()),
                  int(np.bincount((days - days.min()).astype(int)).max()), float(det["night"][idx][members].mean())],
            merged=int((fcnt >= 3).sum() >= 2), has_fire=bool(len(fires)), labelled=float(labelled)))
    return dict(ev=ev, rows=rows, tr=tr, t=t, x=x, y=yy)


def recovered_after_review(tab, reviewed):
    """Recovered fires in one region-year after splitting the reviewed events by official fire."""
    ev = tab["ev"].copy()
    nxt = ev.max() + 1
    for row in tab["rows"]:
        if row["event"] in reviewed:
            mem = row["members"]
            for f in np.unique(tab["tr"][mem]):
                if f >= 0:
                    ev[mem[tab["tr"][mem] == f]] = nxt
                    nxt += 1
    return te.fire_metrics(ev, tab["tr"], tab["t"], tab["x"], tab["y"])


def main():
    oof = {y: np.load(te.NAT / f"oof_{y}.npy") for y in te.YEARS}
    tabs = {(y, r): event_table(y, r, oof) for y in te.YEARS for r in range(len(te.REGIONS))}
    tabs = {k: v for k, v in tabs.items() if v and v["rows"]}
    allrows = [row for v in tabs.values() for row in v["rows"]]
    X = np.array([row["feat"] for row in allrows], float)
    yv = np.array([row["merged"] for row in allrows])
    reg = np.array([row["region"] for row in allrows])
    fire_ev = np.array([row["has_fire"] for row in allrows])
    print(f"events: {len(allrows):,}, with an official fire: {fire_ev.sum():,}, merged: {yv.sum():,}")

    # leave-one-region-out event scores; train only on events that contain an official fire
    score = np.zeros(len(allrows))
    for r in range(len(te.REGIONS)):
        tr_mask = (reg != r) & fire_ev
        clf = HistGradientBoostingClassifier(max_iter=200, learning_rate=0.05, max_leaf_nodes=15,
                                             class_weight="balanced", random_state=0)
        clf.fit(X[tr_mask], yv[tr_mask])
        score[reg == r] = clf.predict_proba(X[reg == r])[:, 1]
    ev_mask = fire_ev
    auc = roc_auc_score(yv[ev_mask], score[ev_mask])
    ap = average_precision_score(yv[ev_mask], score[ev_mask])
    print(f"held-out AUC {auc:.3f}, average precision {ap:.3f} (base rate {yv[ev_mask].mean():.3f})")

    # simulated review: budgets as a share of all events with 3+ detections in each held-out region
    for k, row in enumerate(allrows):
        row["score"] = score[k]
        row["size"] = len(row["members"])
        row["rand"] = RNG.random()
    budgets = [0, 0.01, 0.02, 0.05, 0.1, 0.2]
    curves = {name: [] for name in ("model", "largest", "random")}
    base_rows = [fm for v in tabs.values() for fm in te.fire_metrics(v["ev"], v["tr"], v["t"], v["x"], v["y"])]
    n_fires = len(base_rows)
    for b in budgets:
        for name, key in (("model", "score"), ("largest", "size"), ("random", "rand")):
            rec = 0
            for r in range(len(te.REGIONS)):
                rr = [row for row in allrows if row["region"] == r]
                nrev = int(round(b * len(rr)))
                chosen = sorted(rr, key=lambda q: -q[key])[:nrev]
                picked = {(q["year"], q["event"]) for q in chosen}
                for (y, rg), v in tabs.items():
                    if rg != r:
                        continue
                    revd = {e for (yy, e) in picked if yy == y}
                    rec += sum(fm[1] for fm in recovered_after_review(v, revd))
            curves[name].append(round(rec / n_fires, 4))
        print(f"review {b:>4.0%} of events: model={curves['model'][-1]:.3f} largest={curves['largest'][-1]:.3f} random={curves['random'][-1]:.3f}")

    clf_all = HistGradientBoostingClassifier(max_iter=200, learning_rate=0.05, max_leaf_nodes=15,
                                             class_weight="balanced", random_state=0).fit(X[fire_ev], yv[fire_ev])
    import joblib
    joblib.dump(clf_all, te.MOD / "merged_event_all_us.joblib")
    WEB.joinpath("review.json").write_text(json.dumps(dict(
        budgets=budgets, curves=curves, n_fires=n_fires, n_events=len(allrows),
        n_events_with_fire=int(fire_ev.sum()), n_merged=int(yv.sum()),
        auc=round(auc, 3), ap=round(ap, 3), base_rate=round(float(yv[ev_mask].mean()), 3),
        features=EV_FEATURES), indent=1))


if __name__ == "__main__":
    main()
