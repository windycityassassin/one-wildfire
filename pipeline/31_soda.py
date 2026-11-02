"""From orbit: the 2015 Soda Fire as MODIS saw it, and what the 2016 grouping rule makes of it.

  * detections: NASA FIRMS MODIS C6.1 (Terra + Aqua), vegetation fires, confidence >= 30, inside the
    official perimeter (NIFC Interagency Fire Perimeter History, 2015-IDOYD-000889, 279,144 acres)
  * events: the space-time rule of Cattau et al. (2016) at its published default (1.5 km, 4 days) and at
    the wider window that worked best on 2020-2024 US fires (4 km, 14 days)
  * wind: ERA5 10 m hourly wind on a small grid (Open-Meteo archive), for the spread animation
  * the drone site (pipeline/30_drone_scene.py), so the map can fly down to it

Output: web/data/soda/soda.json
"""
import importlib
import json
import pathlib
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from shapely.geometry import Point, mapping, shape
from shapely import prepared

import cluster

st = importlib.import_module("18_fire_stories")
ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw"
OUT = ROOT / "web/data/soda"
FIRE_ID = "2015-IDOYD-000889"
WIDE = (4.0, 14.0)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    feats = json.loads((RAW / "soda_perim_2015.geojson").read_text())["features"]
    perim = shape(next(f for f in feats if f["properties"].get("UNQE_FIRE_ID") == FIRE_ID)["geometry"])
    w, s, e, n = perim.bounds

    df = pd.read_csv(RAW / "modis_2015_United_States.csv")
    df = df[df.longitude.between(w - 0.3, e + 0.3) & df.latitude.between(s - 0.3, n + 0.3)
            & (df.acq_date >= "2015-08-01") & (df.acq_date <= "2015-09-30") & (df.type == 0) & (df.confidence >= 30)]
    inside = prepared.prep(perim.buffer(0.02))
    df = df[[inside.contains(Point(x, y)) for x, y in zip(df.longitude, df.latitude)]].copy()
    t = pd.to_datetime(df.acq_date + " " + df.acq_time.astype(str).str.zfill(4), format="%Y-%m-%d %H%M", utc=True)
    df["ms"] = (t - pd.Timestamp("1970-01-01", tz="UTC")) // pd.Timedelta(milliseconds=1)
    df = df.sort_values("ms").reset_index(drop=True)
    t0 = int(df.ms.iloc[0])
    days = (df.ms.values - t0) / 86400000

    x, y = cluster.project(df.longitude.values, df.latitude.values, w, s)
    C = cluster.Clusterer(x, y, days)

    def ranked(lab):
        order = pd.Series(lab).value_counts().index          # biggest event first
        rank = {v: i for i, v in enumerate(order)}
        return np.array([rank[v] for v in lab]), len(order)

    lab16, n16 = ranked(C.labels(*cluster.CATTAU_DEFAULT))
    labw, nw = ranked(C.labels(*WIDE))
    print(f"{len(df)} detections; 2016 rule: {n16} events; wide window: {nw} events "
          f"(largest holds {np.mean(labw == 0):.0%})")

    # wind over the fire, a day either side
    d0 = datetime.fromtimestamp(t0 / 1000, timezone.utc).date()
    d1 = datetime.fromtimestamp(int(df.ms.iloc[-1]) / 1000, timezone.utc).date()
    glons, glats = np.linspace(w - 0.3, e + 0.3, 5), np.linspace(s - 0.3, n + 0.3, 5)
    LL = [(la, lo) for la in glats for lo in glons]
    start = (pd.Timestamp(d0) - pd.Timedelta(days=1)).date().isoformat()
    end = (pd.Timestamp(d1) + pd.Timedelta(days=1)).date().isoformat()
    grid = st.wind_fetch([q[0] for q in LL], [q[1] for q in LL], start, end, "wind_speed_10m,wind_direction_10m")
    nh = len(grid[0]["hourly"]["time"])
    U = np.zeros((nh, len(LL)), np.int16)
    V = np.zeros((nh, len(LL)), np.int16)
    for j, g in enumerate(grid):
        for h, (sp, dr) in enumerate(zip(g["hourly"]["wind_speed_10m"], g["hourly"]["wind_direction_10m"])):
            if sp is not None and dr is not None:
                u_, v_ = st.uv(sp, dr)
                U[h, j], V[h, j] = round(u_ * 10), round(v_ * 10)
    wt0 = int(pd.Timestamp(grid[0]["hourly"]["time"][0], tz="UTC").timestamp() * 1000)

    site = json.loads((ROOT / "web/data/drone/soda2/site.json").read_text())
    nat = json.loads((ROOT / "web/data/national.json").read_text())

    out = dict(
        fire=dict(name="Soda Fire", id=FIRE_ID, acres=279144, year=2015, tz="America/Boise"),
        perimeter=mapping(perim.simplify(0.0015, preserve_topology=True)),
        bounds=[round(v, 4) for v in (w, s, e, n)],
        t0=t0,
        # lon, lat, hours since first detection, night (1/0), FRP (MW), 2016-rule event, wide-window event
        dets=[[round(a, 4), round(b, 4), round((m - t0) / 3600000, 2), int(dn == "N"), round(float(f), 1), int(p), int(q)]
              for a, b, m, dn, f, p, q in zip(df.longitude, df.latitude, df.ms, df.daynight, df.frp, lab16, labw)],
        events=dict(rule2016=n16, wide=nw, rule2016_dt=list(cluster.CATTAU_DEFAULT), wide_dt=list(WIDE),
                    wide_largest_share=round(float(np.mean(labw == 0)), 3)),
        wind=dict(lons=np.round(glons, 3).tolist(), lats=np.round(glats, 3).tolist(), t0=wt0, n=nh,
                  u=U.ravel().tolist(), v=V.ravel().tolist(), scale=0.1,
                  source="ERA5 (ECMWF) via Open-Meteo archive API, 10 m wind, hourly"),
        drone=dict(lonlat=site["center_lonlat"], size=site["size"]),
        national=nat,
    )
    (OUT / "soda.json").write_text(json.dumps(out, separators=(",", ":")))
    print("wrote", OUT / "soda.json", f"{(OUT / 'soda.json').stat().st_size / 1e3:.0f} kB")


if __name__ == "__main__":
    main()
