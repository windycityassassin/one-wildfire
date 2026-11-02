"""Build the web app's data: detections, perimeter labels, the (d, T) calibration grid,
ignition-robustness ensemble, and ambiguous cases for the "one fire or several?" task.

Outputs web/data/<region>.json and web/data/regions.json
"""
import json
import pathlib

import numpy as np
import pandas as pd
import shapely
from shapely.geometry import shape

from cluster import CATTAU_DEFAULT, D_GRID, T_GRID, Clusterer, bcubed, project
from regions import REGIONS

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW, OUT = ROOT / "data/raw", ROOT / "web/data"
OUT.mkdir(parents=True, exist_ok=True)
COMBOS = [(d, T) for d in D_GRID for T in T_GRID]
TIGHT, LOOSE = (1.0, 1.0), (5.0, 7.0)
MS_DAY = 86400000


def load_detections(r):
    df = pd.read_csv(RAW / r["firms"])
    w, s, e, n = r["bbox"]
    df = df[df.longitude.between(w, e) & df.latitude.between(s, n)]
    df = df[(df.type == 0) & (df.confidence >= 30)]          # vegetation fires, nominal+high confidence
    ts = pd.to_datetime(df.acq_date + df.acq_time.astype(str).str.zfill(4), format="%Y-%m-%d%H%M", utc=True)
    df = df.assign(t=((ts - pd.Timestamp(f"{r['year']}-01-01", tz="UTC")).dt.total_seconds() / 86400).round(3),
                   longitude=df.longitude.round(4), latitude=df.latitude.round(4))
    # stable order so the browser (which reads the rounded values) reproduces the same events exactly
    return df.sort_values(["t", "longitude", "latitude"]).reset_index(drop=True)


def load_perimeters(key, r, lon0, lat0):
    path = RAW / f"perims_{key}.geojson"
    if not r["truth"] or not path.exists():
        return []
    y0 = pd.Timestamp(f"{r['year']}-01-01", tz="UTC").value // 10**6
    perims = []
    for f in json.loads(path.read_text())["features"]:
        p, g = f["properties"], f["geometry"]
        if g is None or p["attr_FireDiscoveryDateTime"] is None:
            continue
        geom = shape(g)
        disc = (p["attr_FireDiscoveryDateTime"] - y0) / MS_DAY
        out = p["attr_FireOutDateTime"] or p["attr_ContainmentDateTime"]
        end = (out - y0) / MS_DAY + 3 if out else disc + 150
        end = min(max(end, disc + 10), disc + 200)
        olon, olat = p["attr_InitialLongitude"], p["attr_InitialLatitude"]
        ox, oy = project(olon, olat, lon0, lat0) if olon and olat else (None, None)
        cont = p["attr_ContainmentDateTime"]
        perims.append(dict(
            contain_days=round((cont - p["attr_FireDiscoveryDateTime"]) / MS_DAY, 1) if cont else None,
            name=(p["poly_IncidentName"] or p["attr_IncidentName"] or "Unnamed").strip().title(),
            acres=round(p["poly_GISAcres"] or 0), disc=round(disc, 3), end=round(end, 3),
            cause=p["attr_FireCauseGeneral"] or p["attr_FireCause"] or "Unknown",
            complex=(p["attr_CpxName"] or "").title() or None,
            origin=[round(olon, 5), round(olat, 5)] if ox is not None else None,
            ox=ox, oy=oy, geom=geom, area=geom.area))
    perims.sort(key=lambda q: -q["acres"])
    return perims


EDGE_DEG = 0.03   # ~2.5 km: MODIS pixel centres of a fire can sit this far outside its mapped edge


def label_detections(df, perims):
    """Truth label = smallest perimeter that contains the detection and was burning at that time.
    -2 = within ~2.5 km outside a burning perimeter (ambiguous, ignored); -1 = background."""
    lab = np.full(len(df), -1)
    best_area = np.full(len(df), np.inf)
    near = np.zeros(len(df), bool)
    lon, lat, t = df.longitude.values, df.latitude.values, df.t.values
    for k, p in enumerate(perims):
        when = (t >= p["disc"] - 2) & (t <= p["end"])
        inside = shapely.contains_xy(p["geom"], lon, lat) & when
        near |= shapely.contains_xy(p["geom"].buffer(EDGE_DEG), lon, lat) & when
        better = inside & (p["area"] < best_area)
        lab[better], best_area[better] = k, p["area"]
    lab[(lab == -1) & near] = -2
    return lab


def evaluate(cl, lab_pred, truth, perims, x, y, t):
    prec, rec, f1 = bcubed(lab_pred, truth)
    ign = cl.ignitions(lab_pred)
    # earliest detection per predicted event
    first = {}
    for idx in np.flatnonzero(ign):
        first[lab_pred[idx]] = idx
    errs, lags, splits, recovered = [], [], [], []
    size_scored = np.bincount(lab_pred[truth != -2], minlength=lab_pred.max() + 1)
    for k, p in enumerate(perims):
        mine = np.flatnonzero(truth == k)
        if len(mine) < 3:
            continue
        ev, cnt = np.unique(lab_pred[mine], return_counts=True)
        splits.append(len(ev))
        # fire-weighted: is this fire one clean event? (>=90% of it in one event, >=90% of that event is it)
        j = np.argmax(cnt)
        recovered.append(cnt[j] / len(mine) >= 0.9 and cnt[j] / size_scored[ev[j]] >= 0.9)
        if p["ox"] is None:
            continue
        main = ev[np.argmax(cnt)]
        i0 = first[main]
        errs.append(float(np.hypot(x[i0] - p["ox"], y[i0] - p["oy"])))
        lags.append(float(t[i0] - p["disc"]))
    labelled_events = np.unique(lab_pred[truth >= 0])
    background = truth == -1
    merges = [len(np.unique(truth[(lab_pred == e) & (truth >= 0)])) for e in labelled_events]
    return dict(
        f1=round(f1, 4), precision=round(prec, 4), recall=round(rec, 4),
        recovered=round(float(np.mean(recovered)), 4) if recovered else None, n_fires=len(recovered),
        ign_err_km=round(float(np.median(errs)), 2) if errs else None,
        ign_lag_days=round(float(np.median(lags)), 2) if lags else None,
        mean_split=round(float(np.mean(splits)), 2) if splits else None,
        mean_merge=round(float(np.mean(merges)), 2) if merges else None,
        bg_absorbed=round(float(np.isin(lab_pred[background], labelled_events).mean()), 3) if background.any() else None,
        n_events=int(lab_pred.max() + 1),
        n_events_3plus=int((np.bincount(lab_pred) >= 3).sum()))


def make_items(df, x, y, t, truth, perims, labs, region_key, max_items=14):
    """Ambiguous cases: one event at a loose setting that splits into 2+ events at a tight setting."""
    loose, tight = labs[LOOSE], labs[TIGHT]
    rng = np.random.default_rng(42)
    cands = []
    for ev in np.unique(loose):
        idx = np.flatnonzero(loose == ev)
        if not 6 <= len(idx) <= 3000:
            continue
        if len(np.unique(tight[idx])) < 2:
            continue
        span_km = max(np.ptp(x[idx]), np.ptp(y[idx]))
        if span_km > 90 or np.ptp(t[idx]) > 120:
            continue
        tl = truth[idx]
        scored = tl[tl != -2]
        cover = float((scored >= 0).mean()) if len(scored) else 0.0
        n_true = len(np.unique(scored[scored >= 0])) if cover >= 0.7 else None
        cands.append(dict(idx=idx, n_true=n_true, cover=cover))
    if perims:
        # pairs of official fires burning close together in space and time: true answer "several"
        groups = {k: np.flatnonzero(truth == k) for k in range(len(perims))}
        groups = {k: g for k, g in groups.items() if 3 <= len(g) <= 900}
        keys = sorted(groups)
        for a_i, a in enumerate(keys):
            for b in keys[a_i + 1:]:
                ia, ib = groups[a], groups[b]
                dx = x[ia][:, None] - x[ib][None, :]
                dy = y[ia][:, None] - y[ib][None, :]
                dtt = np.abs(t[ia][:, None] - t[ib][None, :])
                close = (np.hypot(dx, dy) <= 8) & (dtt <= 7)
                if not close.any():
                    continue
                idx = np.concatenate([ia, ib])
                if max(np.ptp(x[idx]), np.ptp(y[idx])) > 90 or np.ptp(t[idx]) > 120:
                    continue
                cands.append(dict(idx=idx, n_true=2, cover=1.0))
        known = [c for c in cands if c["n_true"] is not None]
        one = [c for c in known if c["n_true"] == 1]
        sev = [c for c in known if c["n_true"] >= 2]
        rng.shuffle(one), rng.shuffle(sev)
        half = max_items // 2
        pick = sev[:half] + one[: max_items - min(half, len(sev))]
    else:
        rng.shuffle(cands)
        pick = cands[:max_items]
    items, seen = [], set()
    for c in pick:
        idx = np.sort(c["idx"])
        ncl = [int(len(np.unique(labs[combo][idx]))) for combo in COMBOS]
        names = sorted({perims[k]["name"] for k in truth[idx] if k >= 0}) if c["n_true"] else []
        if names and tuple(names) in seen:
            continue
        seen.add(tuple(names))
        n = len(items)
        items.append(dict(
            id=f"{region_key}-{n}", region=region_key, det=idx.tolist(), truth=c["n_true"], names=names,
            ncl=ncl, n=len(idx), t0=round(float(t[idx].min()), 3), t1=round(float(t[idx].max()), 3),
            lon=np.round(df.longitude.values[idx], 4).tolist(), lat=np.round(df.latitude.values[idx], 4).tolist(),
            t=np.round(t[idx], 3).tolist()))
    return items


def build(key):
    r = REGIONS[key]
    w, s, e, n = r["bbox"]
    lon0, lat0 = (w + e) / 2, (s + n) / 2
    df = load_detections(r)
    x, y = project(df.longitude.values, df.latitude.values, lon0, lat0)
    t = df.t.values
    perims = load_perimeters(key, r, lon0, lat0)
    truth = label_detections(df, perims) if perims else np.full(len(df), -1)

    cl = Clusterer(x, y, t)
    labs = {c: cl.labels(*c) for c in COMBOS}
    ign_freq = np.zeros(len(df), np.int32)
    for c in COMBOS:
        ign_freq += cl.ignitions(labs[c])

    grid = []
    for c in COMBOS:
        if perims:
            m = evaluate(cl, labs[c], truth, perims, x, y, t)
        else:
            lab = labs[c]
            m = dict(n_events=int(lab.max() + 1), n_events_3plus=int((np.bincount(lab) >= 3).sum()))
        grid.append(dict(d=c[0], T=c[1], **m))

    items = make_items(df, x, y, t, truth, perims, labs, key)

    # floor on ignition error: a perimeter's own earliest labelled detection vs. the official origin
    floor = []
    for k, p in enumerate(perims):
        mine = np.flatnonzero(truth == k)
        if len(mine) >= 3 and p["ox"] is not None:
            i0 = mine[np.argmin(t[mine])]
            floor.append(float(np.hypot(x[i0] - p["ox"], y[i0] - p["oy"])))

    data = dict(
        key=key, lon0=lon0, lat0=lat0, year=r["year"],
        det=dict(
            lon=np.round(df.longitude.values, 4).tolist(), lat=np.round(df.latitude.values, 4).tolist(),
            t=np.round(t, 3).tolist(), frp=np.round(df.frp.values, 1).tolist(),
            sat=df.satellite.str[0].tolist(), night=(df.daynight == "N").astype(int).tolist(),
            truth=truth.tolist(), ign=ign_freq.tolist()),
        perimeters=dict(type="FeatureCollection", features=[
            dict(type="Feature", id=k, geometry=shapely.geometry.mapping(p["geom"]),
                 properties={kk: p[kk] for kk in ("name", "acres", "disc", "cause", "complex", "origin", "contain_days")} | {"id": k})
            for k, p in enumerate(perims)]),
        grid=grid, combos=len(COMBOS), items=[it["id"] for it in items])
    (OUT / f"{key}.json").write_text(json.dumps(data, separators=(",", ":")))

    summary = dict(
        key=key, name=r["name"], year=r["year"], blurb=r["blurb"], truth=bool(perims),
        center=r["center"], zoom=r["zoom"], bbox=r["bbox"], n_det=len(df), n_perims=len(perims),
        n_items=len(items), grid=grid,
        label_cover=round(float((truth >= 0).mean()), 3) if perims else None,
        ign_floor_km=round(float(np.median(floor)), 2) if floor else None)
    if perims:
        best = max(grid, key=lambda g: (g["recovered"], g["f1"]))
        dflt = next(g for g in grid if (g["d"], g["T"]) == CATTAU_DEFAULT)
        summary |= dict(best=best, default=dflt)
    print(f"{key:18s} det={len(df):6d} perims={len(perims):3d} cover={summary['label_cover']} items={len(items)}"
          + (f" best d={best['d']} T={best['T']} rec={best['recovered']} F1={best['f1']} | default rec={dflt['recovered']} F1={dflt['f1']}" if perims else ""))
    return summary, items


if __name__ == "__main__":
    built = [build(k) for k in REGIONS]
    summaries = [b[0] for b in built]
    study_items = [it for b in built for it in b[1]]
    (OUT / "study.json").write_text(json.dumps(dict(items=study_items), separators=(",", ":")))
    truthy = [s for s in summaries if s["truth"]]
    # one national setting: the combo with the highest mean F1 across validated regions
    mean_rec = [np.mean([s["grid"][i]["recovered"] for s in truthy]) for i in range(len(COMBOS))]
    i_nat = int(np.argmax(mean_rec))
    national = dict(d=COMBOS[i_nat][0], T=COMBOS[i_nat][1], mean_recovered=round(float(mean_rec[i_nat]), 4))
    for s in truthy:
        s["national"] = s["grid"][i_nat]
    meta = dict(d_grid=D_GRID, t_grid=T_GRID, default=dict(d=CATTAU_DEFAULT[0], T=CATTAU_DEFAULT[1]),
                tight=dict(d=TIGHT[0], T=TIGHT[1]), loose=dict(d=LOOSE[0], T=LOOSE[1]),
                national=national, regions=summaries)
    (OUT / "regions.json").write_text(json.dumps(meta, separators=(",", ":")))
    print("national single setting:", national)
