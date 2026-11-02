"""'Fires like this one': an analog library of past US wildfires, described by how they behaved in
their first hours of satellite detections, with what happened next (final size, days to containment).

For a new fire, the app finds the most similar past fires from OTHER years and shows their outcomes.
This script also tests whether that is informative, leave-one-year-out: for each fire, take the median
outcome of its 10 nearest analogs from other years and compare with what actually happened.

Output: web/data/analogs.json
"""
import json
import pathlib

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW, NAT, WEB = ROOT / "data/raw", ROOT / "data/national", ROOT / "web/data"
EPOCH = pd.Timestamp("2020-01-01", tz="UTC")
MS_DAY = 86400000
HORIZONS = [0.5, 1.0, 2.0, 3.0]            # days after the first satellite detection
FEATURES = ["log_detections", "log_extent_km", "log_frp", "night_share", "late_share", "doy_sin", "doy_cos", "lat", "lon"]
WEIGHTS = np.array([1.5, 1.5, 1.0, 0.5, 0.75, 0.75, 0.75, 1.0, 1.0])
K = 10


def perimeter_outcomes():
    """Same filtering and order as 11_national_dataset.load_perimeters, plus containment and fuel."""
    rows = []
    for y in range(2020, 2025):
        for f in json.loads((RAW / f"perims_conus_{y}.geojson").read_text())["features"]:
            p = f["properties"]
            if f["geometry"] is None or p["attr_FireDiscoveryDateTime"] is None:
                continue
            disc = (p["attr_FireDiscoveryDateTime"] - EPOCH.value // 10**6) / MS_DAY
            cont = p["attr_ContainmentDateTime"]
            rows.append(dict(
                name=(p["poly_IncidentName"] or p["attr_IncidentName"] or "Unnamed").strip().title(),
                year=y, state=(p["attr_POOState"] or "").replace("US-", ""), acres=p["poly_GISAcres"],
                disc=disc, contain_days=(cont - p["attr_FireDiscoveryDateTime"]) / MS_DAY if cont else None,
                fuel=p["attr_PredominantFuelGroup"], cause=p["attr_FireCauseGeneral"] or p["attr_FireCause"],
                complex=p["attr_CpxName"]))
    return rows


def early_features(t, frp, night, x, y, lat, lon, h):
    """Features of a fire's detections within h days of its first detection."""
    t0 = t.min()
    m = t <= t0 + h
    tt = t[m]
    ext = max(np.ptp(x[m]), np.ptp(y[m])) if m.sum() > 1 else 0.0
    doy = (pd.Timestamp(EPOCH) + pd.Timedelta(days=float(t0))).dayofyear
    return [np.log1p(m.sum()), np.log1p(ext), np.log1p(frp[m].sum()), float(night[m].mean()),
            float((tt > t0 + h / 2).mean()), np.sin(2 * np.pi * doy / 365.25), np.cos(2 * np.pi * doy / 365.25),
            float(lat[m][0]), float(lon[m][0])]


def main():
    meta = perimeter_outcomes()
    lib = []
    for year in range(2020, 2025):
        d = np.load(NAT / f"dets_{year}.npz")
        truth = d["truth"]
        for k in np.unique(truth[truth >= 0]):
            idx = np.flatnonzero(truth == k)
            if len(idx) < 3:
                continue
            m = meta[k]
            if m["acres"] is None:
                continue
            feats = {str(h): early_features(d["t"][idx], d["frp"][idx], d["night"][idx], d["x"][idx], d["y"][idx],
                                            d["lat"][idx], d["lon"][idx], h) for h in HORIZONS}
            lib.append(dict(name=m["name"], year=int(m["year"]), state=m["state"], acres=round(float(m["acres"])),
                            contain_days=None if m["contain_days"] is None else round(float(m["contain_days"]), 1),
                            fuel=m["fuel"], cause=m["cause"], complex=m["complex"],
                            first_seen=round(float(d["t"][idx].min()), 3),
                            lag_hours=round(float((d["t"][idx].min() - m["disc"]) * 24), 1),
                            n_det=int(len(idx)), feats=feats))
    print(f"library: {len(lib)} fires")

    # standardise each horizon's features, then test leave-one-year-out
    scale, skill = {}, {}
    years = np.array([f["year"] for f in lib])
    log_acres = np.log10([max(f["acres"], 1) for f in lib])
    cdays = np.array([np.nan if f["contain_days"] is None else f["contain_days"] for f in lib])
    for h in HORIZONS:
        X = np.array([f["feats"][str(h)] for f in lib])
        mu, sd = X.mean(0), X.std(0) + 1e-9
        scale[str(h)] = dict(mean=mu.round(5).tolist(), std=sd.round(5).tolist())
        Z = (X - mu) / sd * WEIGHTS
        pred_a, pred_c, base_a, base_c = [], [], [], []
        for i in range(len(lib)):
            other = np.flatnonzero(years != years[i])
            dist = np.sqrt(((Z[other] - Z[i]) ** 2).sum(1))
            nn = other[np.argsort(dist)[:K]]
            pred_a.append(np.median(log_acres[nn]))
            pred_c.append(np.nanmedian(cdays[nn]))
            base_a.append(np.median(log_acres[other]))
            base_c.append(np.nanmedian(cdays[other]))
        pred_a, pred_c = np.array(pred_a), np.array(pred_c)
        ok = ~np.isnan(cdays)
        rho_a = spearmanr(pred_a, log_acres).statistic
        rho_c = spearmanr(pred_c[ok], cdays[ok]).statistic
        err_a = np.median(np.abs(pred_a - log_acres))
        err_base = np.median(np.abs(np.array(base_a) - log_acres))
        # how often is the true size within the analogs' middle range (25th-75th percentile)?
        skill[str(h)] = dict(rho_acres=round(float(rho_a), 3), rho_contain=round(float(rho_c), 3),
                             median_factor_error=round(float(10 ** err_a), 2),
                             median_factor_error_baseline=round(float(10 ** err_base), 2))
        print(f"horizon {h:>4} d: size rank corr {rho_a:.2f}, containment rank corr {rho_c:.2f}, "
              f"typical size error x{10 ** err_a:.1f} (vs x{10 ** err_base:.1f} guessing the median fire)")

    for f in lib:
        f["feats"] = {h: np.round(v, 4).tolist() for h, v in f["feats"].items()}
    WEB.joinpath("analogs.json").write_text(json.dumps(dict(
        horizons=HORIZONS, features=FEATURES, weights=WEIGHTS.tolist(), k=K, scale=scale, skill=skill,
        library=lib), separators=(",", ":")))


if __name__ == "__main__":
    main()
