"""National dataset for the learned linkage model.

For each year 2020-2024: MODIS detections in the contiguous US, labelled with the WFIGS perimeter
that contains them (same rules as 02_build.py), assigned to one of six regions used for
leave-one-region-out testing, plus every candidate pair of detections within 10 km and 14 days.

Outputs data/national/dets_<year>.npz and pairs_<year>.npz
"""
import json
import pathlib

import numpy as np
import pandas as pd
import shapely
from pyproj import Transformer
from scipy.spatial import cKDTree
from shapely.geometry import shape

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW, OUT = ROOT / "data/raw", ROOT / "data/national"
OUT.mkdir(parents=True, exist_ok=True)
EPOCH = pd.Timestamp("2020-01-01", tz="UTC")
MS_DAY = 86400000
EDGE_DEG = 0.03
DMAX, TMAX = 10.0, 14.0
REGIONS = ["Pacific Northwest", "California", "Southwest", "Great Basin & N. Rockies", "Plains", "East"]
TO_ALBERS = Transformer.from_crs(4326, 5070, always_xy=True)   # CONUS Albers equal-area, metres


def region_of(lon, lat):
    r = np.full(len(lon), 5)                                    # East
    r[lon < -94] = 4                                            # Plains
    r[(lon < -104) & (lat >= 37)] = 3                           # Great Basin & Northern Rockies
    r[(lon < -103) & (lat < 37)] = 2                            # Southwest
    r[(lon < -117.5) & (lat < 42)] = 1                          # California
    r[(lon < -116.5) & (lat >= 42)] = 0                         # Pacific Northwest
    return r


def load_detections(year):
    df = pd.read_csv(RAW / f"modis_{year}_United_States.csv")
    df = df[(df.type == 0) & (df.confidence >= 30)
            & df.longitude.between(-125, -66) & df.latitude.between(24, 50)]
    ts = pd.to_datetime(df.acq_date + df.acq_time.astype(str).str.zfill(4), format="%Y-%m-%d%H%M", utc=True)
    df = df.assign(t=((ts - EPOCH).dt.total_seconds() / 86400).round(3),
                   longitude=df.longitude.round(4), latitude=df.latitude.round(4))
    return df.sort_values(["t", "longitude", "latitude"]).reset_index(drop=True)


def load_perimeters():
    perims = []
    for y in range(2020, 2025):
        for f in json.loads((RAW / f"perims_conus_{y}.geojson").read_text())["features"]:
            p, g = f["properties"], f["geometry"]
            if g is None or p["attr_FireDiscoveryDateTime"] is None:
                continue
            disc = (p["attr_FireDiscoveryDateTime"] - EPOCH.value // 10**6) / MS_DAY
            out = p["attr_FireOutDateTime"] or p["attr_ContainmentDateTime"]
            end = (out - EPOCH.value // 10**6) / MS_DAY + 3 if out else disc + 150
            end = min(max(end, disc + 10), disc + 200)
            geom = shape(g)
            perims.append(dict(
                uid=p["attr_UniqueFireIdentifier"], name=(p["poly_IncidentName"] or "").strip().title(),
                acres=p["poly_GISAcres"], disc=disc, end=end, geom=geom, area=geom.area,
                olon=p["attr_InitialLongitude"], olat=p["attr_InitialLatitude"],
                cause=p["attr_FireCauseGeneral"] or p["attr_FireCause"], fuel=p["attr_PredominantFuelGroup"],
                complex=p["attr_CpxName"]))
    return perims


def label(df, perims):
    """>= 0: perimeter index; -1: background; -2: just outside a burning perimeter (ignored)."""
    n = len(df)
    lab = np.full(n, -1)
    best = np.full(n, np.inf)
    near = np.zeros(n, bool)
    t = df.t.values
    lon, lat = df.longitude.values, df.latitude.values
    for k, p in enumerate(perims):
        a, b = np.searchsorted(t, p["disc"] - 2), np.searchsorted(t, p["end"], side="right")
        if a >= b:
            continue
        w, s, e, nn = p["geom"].bounds
        sl = np.arange(a, b)
        box = (lon[sl] >= w - EDGE_DEG) & (lon[sl] <= e + EDGE_DEG) & (lat[sl] >= s - EDGE_DEG) & (lat[sl] <= nn + EDGE_DEG)
        sl = sl[box]
        if len(sl) == 0:
            continue
        inside = shapely.contains_xy(p["geom"], lon[sl], lat[sl])
        near[sl[shapely.contains_xy(p["geom"].buffer(EDGE_DEG), lon[sl], lat[sl])]] = True
        idx = sl[inside & (p["area"] < best[sl])]
        lab[idx], best[idx] = k, p["area"]
    lab[(lab == -1) & near] = -2
    return lab


def candidate_pairs(x, y, t):
    """All pairs within DMAX km and TMAX days (Chebyshev box in scaled space-time, then Euclidean)."""
    k = DMAX / TMAX
    tree = cKDTree(np.column_stack([x, y, t * k]))
    pr = tree.query_pairs(DMAX, p=np.inf, output_type="ndarray")
    i, j = pr[:, 0], pr[:, 1]
    d = np.hypot(x[i] - x[j], y[i] - y[j])
    keep = d <= DMAX
    i, j, d = i[keep], j[keep], d[keep]
    swap = i > j
    i[swap], j[swap] = j[swap], i[swap]
    return i.astype(np.int32), j.astype(np.int32), d.astype(np.float32), np.abs(t[i] - t[j]).astype(np.float32)


def main():
    perims = load_perimeters()
    meta = [{k: p[k] for k in ("uid", "name", "acres", "disc", "end", "olon", "olat", "cause", "fuel", "complex")}
            for p in perims]
    (OUT / "perimeters.json").write_text(json.dumps(meta))
    for year in range(2020, 2025):
        df = load_detections(year)
        lon, lat = df.longitude.values, df.latitude.values
        ax, ay = TO_ALBERS.transform(lon, lat)
        x, y = ax / 1000, ay / 1000
        truth = label(df, perims)
        reg = region_of(lon, lat)
        i, j, d, dt = candidate_pairs(x, y, df.t.values)
        np.savez_compressed(
            OUT / f"dets_{year}.npz", lon=lon, lat=lat, x=x, y=y, t=df.t.values, frp=df.frp.values,
            scan=df.scan.values, track=df.track.values, night=(df.daynight.values == "N"),
            aqua=(df.satellite.values == "Aqua"), conf=df.confidence.values, truth=truth, region=reg)
        np.savez_compressed(OUT / f"pairs_{year}.npz", i=i, j=j, d=d, dt=dt)
        print(f"{year}: {len(df):,} detections, {(truth >= 0).mean():.1%} in a perimeter, "
              f"{len(np.unique(truth[truth >= 0])):,} fires, {len(i):,} candidate pairs")


if __name__ == "__main__":
    main()
