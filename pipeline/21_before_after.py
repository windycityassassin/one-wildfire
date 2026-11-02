"""Before and after each fire story, from public records only.

BEFORE
  * Fire danger in the run-up: gridMET daily Energy Release Component (ERC; NFDRS fuel model G), the
    index fire managers use for seasonal fire danger, at the recorded origin for the 60 days before
    discovery. Each day is ranked against the same calendar day in 2000-2019 (percentile). Also the
    2020 100-hour dead fuel moisture for the same days.
  * Had it burned before? Older perimeters from the NIFC Interagency Fire Perimeter History that
    overlap this fire's final perimeter, and the share of its area they cover.

AFTER
  * Greenness: MODIS NDVI (MOD13Q1, 250 m, 16-day composites from mid-July), 2017-2024, averaged over
    pixels inside the final perimeter and over a 1-5 km ring of land outside it, from the ORNL DAAC
    MODIS web service.

Every request is cached in data/raw/before_after/. Output: web/data/stories/ba_<region>.json
"""
import concurrent.futures as cf
import hashlib
import io
import json
import math
import pathlib
import time
from datetime import datetime, timedelta, timezone

import numpy as np
import requests
from pyproj import Transformer
from shapely.geometry import mapping, shape
from shapely.ops import transform, unary_union
import shapely

ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = ROOT / "data/raw/before_after"
WEB = ROOT / "web/data"
REGIONS = ["colorado_2020", "ncal_2020", "oregon_2020", "arizona_2020", "idaho_2020"]
NCSS = "http://thredds.northwestknowledge.net:8080/thredds/ncss/"
HIST = ("https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/"
        "InterAgencyFirePerimeterHistory_All_Years_View/FeatureServer/0/query")
ORNL = "https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset"
PRE_DAYS = 60
CLIM_YEARS = range(2000, 2020)
NDVI_YEARS = range(2017, 2025)
R_SIN = 6371007.181
to_aea = Transformer.from_crs(4326, 5070, always_xy=True).transform


def cached(kind, url, params=None, headers=None, method="get", parse="text"):
    key = hashlib.sha1((url + json.dumps(params, sort_keys=True)).encode()).hexdigest()[:20]
    path = CACHE / f"{kind}_{key}.{'json' if parse == 'json' else 'txt'}"
    if path.exists():
        return json.loads(path.read_text()) if parse == "json" else path.read_text()
    for attempt in range(6):
        try:
            r = (requests.post if method == "post" else requests.get)(url, params=params if method == "get" else None,
                                                                     data=params if method == "post" else None, headers=headers, timeout=180)
            if r.status_code in (429, 500, 502, 503, 504):
                raise requests.HTTPError(str(r.status_code))
            r.raise_for_status()
            body = r.json() if parse == "json" else r.text
            path.write_text(json.dumps(body) if parse == "json" else body)
            return body
        except Exception as e:  # noqa: BLE001
            wait = 5 * (attempt + 1)
            print(f"    retry {kind} in {wait}s ({e})")
            time.sleep(wait)
    raise RuntimeError(f"{kind} request kept failing")


def gridmet(var_file, var, lon, lat, d0, d1):
    """daily values at a point between two dates (inclusive), as {date: value}"""
    txt = cached("gm", NCSS + var_file, dict(var=var, latitude=f"{lat:.4f}", longitude=f"{lon:.4f}",
                                            time_start=f"{d0}T00:00:00Z", time_end=f"{d1}T00:00:00Z", accept="csv"))
    out = {}
    for line in txt.strip().splitlines()[1:]:
        parts = line.split(",")
        if len(parts) >= 4 and parts[3] not in ("", "NaN"):
            out[parts[0][:10]] = float(parts[3])
    return out


ERC = ("agg_met_erc_1979_CurrentYear_CONUS.nc", "daily_mean_energy_release_component-g")
FM100 = ("agg_met_fm100_1979_CurrentYear_CONUS.nc", "dead_fuel_moisture_100hr")


def fire_danger(lon, lat, disc_date):
    start = disc_date - timedelta(days=PRE_DAYS)
    days = [start + timedelta(days=k) for k in range(PRE_DAYS + 1)]
    erc_now = gridmet(*ERC, lon, lat, start.isoformat(), disc_date.isoformat())
    fm_now = gridmet(*FM100, lon, lat, start.isoformat(), disc_date.isoformat())
    clim = {}
    for y in CLIM_YEARS:
        try:
            s, e = start.replace(year=y), disc_date.replace(year=y)
        except ValueError:                                   # Feb 29
            s, e = (start - timedelta(days=1)).replace(year=y), (disc_date - timedelta(days=1)).replace(year=y)
        vals = gridmet(*ERC, lon, lat, s.isoformat(), e.isoformat())
        for k, d in enumerate(sorted(vals)):
            clim.setdefault(k, []).append(vals[d])
    erc, pct, p10, p50, p90 = [], [], [], [], []
    for k, d in enumerate(days):
        v = erc_now.get(d.isoformat())
        c = np.array(clim.get(k, []))
        erc.append(v)
        p10.append(float(np.percentile(c, 10)) if len(c) else None)
        p50.append(float(np.percentile(c, 50)) if len(c) else None)
        p90.append(float(np.percentile(c, 90)) if len(c) else None)
        pct.append(round(float((c < v).mean() * 100 + (c == v).mean() * 50)) if (v is not None and len(c)) else None)
    return dict(dates=[d.isoformat() for d in days], erc=erc, erc_pct=pct,
                erc_p10=p10, erc_p50=p50, erc_p90=p90,
                # the NCSS CSV returns fm100 as stored (tenths of a percent; scale_factor 0.1 in the dataset)
                fm100=[None if fm_now.get(d.isoformat()) is None else round(fm_now[d.isoformat()] * 0.1, 1) for d in days],
                clim_years=[CLIM_YEARS[0], CLIM_YEARS[-1]])


def history(geom, year):
    w, s, e, n = geom.bounds
    q = dict(where=f"FIRE_YEAR_INT < {year}", geometry=json.dumps(dict(xmin=w, ymin=s, xmax=e, ymax=n, spatialReference=dict(wkid=4326))),
             geometryType="esriGeometryEnvelope", inSR=4326, spatialRel="esriSpatialRelIntersects",
             outFields="INCIDENT,FIRE_YEAR_INT,GIS_ACRES", outSR=4326, maxAllowableOffset=0.0005, f="geojson")
    feats, offset = [], 0
    while True:
        d = cached("hist", HIST, dict(q, resultOffset=offset, resultRecordCount=1000), method="post", parse="json")
        batch = d.get("features", [])
        feats += batch
        if len(batch) < 1000:
            break
        offset += len(batch)
    me = transform(to_aea, geom)
    past, polys = [], []
    for f in feats:
        if not f.get("geometry"):
            continue
        g = transform(to_aea, shape(f["geometry"]).buffer(0))
        ov = g.intersection(me).area
        if ov <= 0:
            continue
        p = f["properties"]
        polys.append(g)
        past.append(dict(name=(p.get("INCIDENT") or "Unnamed").strip().title(), year=p.get("FIRE_YEAR_INT"),
                         acres=round(p.get("GIS_ACRES") or 0), overlap_pct=round(100 * ov / me.area, 1),
                         geom=shape(f["geometry"]).buffer(0).simplify(0.002)))
    covered = unary_union(polys).intersection(me).area / me.area if polys else 0.0
    # one row per fire (a fire can have several polygons), largest overlap first
    best = {}
    for p in past:
        k = (p["name"], p["year"])
        if k not in best or p["overlap_pct"] > best[k]["overlap_pct"]:
            best[k] = p
    past = sorted(best.values(), key=lambda p: -p["overlap_pct"])
    # outlines of the 12 most overlapping older fires, for the map
    shapes = [dict(type="Feature", properties=dict(name=p["name"], year=p["year"]), geometry=mapping_round(p["geom"]))
              for p in past[:12] if p["overlap_pct"] > 0 and not p["geom"].is_empty]
    for p in past:
        p.pop("geom", None)
    return dict(burned_before_pct=round(100 * covered, 1), n_fires=len(past), fires=past[:8],
                first_year=min((p["year"] for p in past if p["year"]), default=None), shapes=shapes)


def mapping_round(g):
    gj = mapping(g)
    def rnd(c):
        return [rnd(q) for q in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 4), round(c[1], 4)]
    return dict(type=gj["type"], coordinates=rnd(gj["coordinates"]))


def ndvi(geom):
    """mean mid-July NDVI inside the perimeter and in a 1-5 km ring outside, per year"""
    me = transform(to_aea, geom)
    ring = me.buffer(5000).difference(me.buffer(1000))
    c = geom.centroid
    w, s, e, n = transform(to_aea, geom).bounds
    half = min(100, math.ceil(max(e - w, n - s) / 2000 + 6))
    mask, grid = None, None
    years, inside, outside = [], [], []
    for y in NDVI_YEARS:
        d = cached("ndvi", ORNL, dict(latitude=f"{c.y:.4f}", longitude=f"{c.x:.4f}", startDate=f"A{y}193", endDate=f"A{y}209",
                                      kmAboveBelow=half, kmLeftRight=half, band="250m_16_days_NDVI"),
                   headers={"Accept": "application/json"}, parse="json")
        d = dict(d)
        nr, nc, cs = int(d["nrows"]), int(d["ncols"]), float(d["cellsize"])
        x0, y0 = float(d["xllcorner"]), float(d["yllcorner"])
        if mask is None or grid != (x0, y0, nr, nc):
            # classify each pixel centre once per fire: 1 inside, 2 in the ring, 0 neither
            rows = np.repeat(np.arange(nr), nc)
            cols = np.tile(np.arange(nc), nr)
            lat = np.degrees((y0 + (nr - rows - 0.5) * cs) / R_SIN)
            lon = np.degrees((x0 + (cols + 0.5) * cs) / (R_SIN * np.cos(np.radians(lat))))
            ax, ay = to_aea(lon, lat)
            mask = np.where(shapely.contains_xy(me, ax, ay), 1, np.where(shapely.contains_xy(ring, ax, ay), 2, 0))
            grid = (x0, y0, nr, nc)
        m = mask
        vin, vout = [], []
        for sub in d["subset"]:
            v = np.array(sub["data"], float)
            ok = v > -2000
            vin.append(v[(m == 1) & ok].mean() * 0.0001 if ((m == 1) & ok).any() else np.nan)
            vout.append(v[(m == 2) & ok].mean() * 0.0001 if ((m == 2) & ok).any() else np.nan)
        years.append(y)
        inside.append(round(float(np.nanmean(vin)), 3))
        outside.append(round(float(np.nanmean(vout)), 3))
    return dict(years=years, inside=inside, outside=outside, product="MOD13Q1 NDVI, 250 m, composites starting Jul 11-12 and Jul 27-28")


def one_fire(key, f, R):
    feat = R["perimeters"]["features"][f["id"]]
    geom = shape(feat["geometry"]).buffer(0)
    lon, lat = (f["origin"] or f["first_det_lonlat"])
    epoch = datetime(2020, 1, 1, tzinfo=timezone.utc)
    disc_date = (epoch + timedelta(days=f["disc"])).date()
    out = dict(id=f["id"])
    out["danger"] = fire_danger(lon, lat, disc_date)
    out["history"] = history(geom, 2020)
    out["ndvi"] = ndvi(geom)
    d = out["danger"]
    print(f"  {key} {f['name']:<20} ERC pct at start {d['erc_pct'][-1]}, burned before {out['history']['burned_before_pct']}%, "
          f"NDVI in 2019 {out['ndvi']['inside'][2]} -> 2021 {out['ndvi']['inside'][4]}")
    return out


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    for key in REGIONS:
        D = json.loads((WEB / f"stories/{key}.json").read_text())
        R = json.loads((WEB / f"{key}.json").read_text())
        with cf.ThreadPoolExecutor(max_workers=4) as ex:
            res = list(ex.map(lambda f: one_fire(key, f, R), D["fires"]))
        (WEB / f"stories/ba_{key}.json").write_text(json.dumps(
            dict(region=key, sources=dict(
                danger="gridMET (Abatzoglou 2013): ERC (NFDRS fuel model G) and 100-hour dead fuel moisture",
                history="NIFC Interagency Fire Perimeter History (all years)",
                ndvi="MODIS MOD13Q1 via ORNL DAAC MODIS web service"),
                 fires={str(r["id"]): r for r in res}), separators=(",", ":")))


if __name__ == "__main__":
    main()
