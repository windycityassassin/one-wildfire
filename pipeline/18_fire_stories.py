"""Fire stories: one factual profile per official fire in the 2020 map regions.

For every WFIGS fire with at least 10 labelled MODIS detections:
  * the record: name, reported discovery time, recorded point of origin, cause, fuel, size, containment
  * how it spread: its satellite detections, grouped by local calendar day; each day's spread is the
    bearing and distance from the centre of everything detected before that day to the centre of that
    day's new detections (day one starts from the recorded origin, when there is one)
  * the wind: ERA5 reanalysis (ECMWF), hourly, 10 m above ground, from the Open-Meteo archive API,
    on a small grid around the fire (for the animation) and at the fire's starting point (for readouts)
  * how they line up: for each day with real spread, the angle between the spread direction and the
    downwind direction (the direction the wind blows toward), averaged over that day

Nothing is modelled or interpolated beyond bilinear interpolation of the wind grid in the browser.

Outputs: web/data/stories/<region>.json and web/data/stories/wind_<region>_<id>.json
Wind responses are cached in data/raw/wind/ so re-runs don't call the API again.
"""
import hashlib
import json
import math
import pathlib
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np
import requests

from regions import REGIONS

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW, WEB = ROOT / "data/raw", ROOT / "web/data"
CACHE = RAW / "wind"
OUT = WEB / "stories"
API = "https://archive-api.open-meteo.com/v1/archive"
MS_DAY = 86400000
TZ = {"colorado_2020": "America/Denver", "ncal_2020": "America/Los_Angeles", "oregon_2020": "America/Los_Angeles",
      "arizona_2020": "America/Phoenix", "idaho_2020": "America/Boise"}
MIN_DETS = 10
MAX_DAYS = 75          # wind is fetched for at most this many days of a fire's detections
GRID_STEP = 0.25       # ERA5's native grid spacing, degrees
GRID_MAX = 5           # at most 5 x 5 wind points per fire
MIN_SPREAD_KM = 2.0    # a day's centre has to move this far to count as spread with a direction
MIN_NEW = 5            # ...and the day needs this many new detections
LIGHT_WIND = 10.0      # km/h; below this a day's wind direction is not used to classify spread
BURN_HOURS = (10, 18)  # local "burning period" (NWCG): each day's wind is averaged over these hours


def load_perimeters(key, year):
    """Same filtering and order as 02_build.load_perimeters, so index k matches the region JSON."""
    y0 = datetime(year, 1, 1, tzinfo=timezone.utc).timestamp() * 1000
    conus = {f["properties"]["attr_UniqueFireIdentifier"]: f["properties"]
             for f in json.loads((RAW / f"perims_conus_{year}.geojson").read_text())["features"]}
    out = []
    for f in json.loads((RAW / f"perims_{key}.geojson").read_text())["features"]:
        p = f["properties"]
        if f["geometry"] is None or p["attr_FireDiscoveryDateTime"] is None:
            continue
        c = conus.get(p["attr_UniqueFireIdentifier"], {})
        out.append(dict(
            name=(p["poly_IncidentName"] or p["attr_IncidentName"] or "Unnamed").strip().title(),
            uid=p["attr_UniqueFireIdentifier"], acres=round(p["poly_GISAcres"] or 0),
            disc=(p["attr_FireDiscoveryDateTime"] - y0) / MS_DAY,
            contain=(p["attr_ContainmentDateTime"] - y0) / MS_DAY if p["attr_ContainmentDateTime"] else None,
            origin=[p["attr_InitialLongitude"], p["attr_InitialLatitude"]] if p["attr_InitialLongitude"] and p["attr_InitialLatitude"] else None,
            cause=p["attr_FireCauseGeneral"] or p["attr_FireCause"] or "Unknown",
            cause_class=p["attr_FireCause"] or "Unknown",
            fuel=c.get("attr_PredominantFuelGroup"), state=(c.get("attr_POOState") or "").replace("US-", "") or None,
            complex=(p["attr_CpxName"] or "").title() or None))
    out.sort(key=lambda q: -q["acres"])
    return out


def km_xy(lon, lat, lon0, lat0):
    return (np.asarray(lon) - lon0) * 111.32 * math.cos(math.radians(lat0)), (np.asarray(lat) - lat0) * 110.57


def bearing(dx, dy):
    return (math.degrees(math.atan2(dx, dy)) + 360) % 360


def angle_diff(a, b):
    d = abs(a - b) % 360
    return 360 - d if d > 180 else d


def wind_fetch(lats, lons, start, end, hourly):
    """Open-Meteo ERA5 archive, several points in one call, cached on disk."""
    params = dict(latitude=",".join(f"{v:.3f}" for v in lats), longitude=",".join(f"{v:.3f}" for v in lons),
                  start_date=start, end_date=end, hourly=hourly, models="era5", timezone="GMT",
                  wind_speed_unit="kmh")
    key = hashlib.sha1(json.dumps(params, sort_keys=True).encode()).hexdigest()[:16]
    path = CACHE / f"{key}.json"
    if path.exists():
        return json.loads(path.read_text())
    for attempt in range(8):
        r = requests.get(API, params=params, timeout=120)
        if r.status_code == 429:
            wait = 30 * (attempt + 1)
            print(f"    rate limited, waiting {wait}s")
            time.sleep(wait)
            continue
        r.raise_for_status()
        data = r.json()
        data = data if isinstance(data, list) else [data]
        path.write_text(json.dumps(data))
        time.sleep(1.0)
        return data
    raise RuntimeError("Open-Meteo kept rate limiting")


def uv(speed, direction_from):
    """Wind blowing FROM `direction_from` degrees -> vector pointing where it blows TO (east, north)."""
    rad = math.radians(direction_from)
    return -speed * math.sin(rad), -speed * math.cos(rad)


def build_region(key):
    r = REGIONS[key]
    year = int(r["year"])
    tz = ZoneInfo(TZ[key])
    epoch = datetime(year, 1, 1, tzinfo=timezone.utc)
    R = json.loads((WEB / f"{key}.json").read_text())
    det = R["det"]
    lon, lat, t = np.array(det["lon"]), np.array(det["lat"]), np.array(det["t"])
    frp, night, truth = np.array(det["frp"]), np.array(det["night"]), np.array(det["truth"])
    perims = load_perimeters(key, year)
    assert [p["name"] for p in perims] == [f["properties"]["name"] for f in R["perimeters"]["features"]], "perimeter order mismatch"
    to_dt = lambda d: epoch + timedelta(days=float(d))
    fires = []
    for k, p in enumerate(perims):
        idx = np.flatnonzero(truth == k)
        if len(idx) < MIN_DETS:
            continue
        idx = idx[np.argsort(t[idx], kind="stable")]
        lon0, lat0 = float(lon[idx].mean()), float(lat[idx].mean())
        x, y = km_xy(lon[idx], lat[idx], lon0, lat0)
        start_pt = p["origin"] or [float(lon[idx[0]]), float(lat[idx[0]])]

        # ---- wind: point series at the starting point, and a small grid for the animation ----
        t_first, t_last = float(t[idx[0]]), float(t[idx[-1]])
        w_start = to_dt(min(p["disc"], t_first) - 0.5).date()
        w_end = min(to_dt(t_last + 0.5), to_dt(min(p["disc"], t_first) + MAX_DAYS)).date()
        pt = wind_fetch([start_pt[1]], [start_pt[0]], w_start.isoformat(), w_end.isoformat(),
                        "wind_speed_10m,wind_direction_10m,wind_gusts_10m")[0]["hourly"]
        hours0 = (datetime.fromisoformat(pt["time"][0]).replace(tzinfo=timezone.utc) - epoch).total_seconds() / 86400
        spd = np.array([np.nan if v is None else v for v in pt["wind_speed_10m"]], float)
        dirn = np.array([np.nan if v is None else v for v in pt["wind_direction_10m"]], float)
        gust = np.array([np.nan if v is None else v for v in pt["wind_gusts_10m"]], float)
        pu, pv = np.array([uv(s, d) if not (np.isnan(s) or np.isnan(d)) else (np.nan, np.nan) for s, d in zip(spd, dirn)]).T

        w, e = float(lon[idx].min()) - 0.3, float(lon[idx].max()) + 0.3
        s, n = float(lat[idx].min()) - 0.3, float(lat[idx].max()) + 0.3
        nx = min(GRID_MAX, max(2, math.ceil((e - w) / GRID_STEP) + 1))
        ny = min(GRID_MAX, max(2, math.ceil((n - s) / GRID_STEP) + 1))
        glons, glats = np.linspace(w, e, nx), np.linspace(s, n, ny)
        LL = [(la, lo) for la in glats for lo in glons]          # row-major: south to north, west to east
        grid = wind_fetch([q[0] for q in LL], [q[1] for q in LL], w_start.isoformat(), w_end.isoformat(),
                          "wind_speed_10m,wind_direction_10m")
        nh = len(grid[0]["hourly"]["time"])
        U = np.zeros((nh, len(LL)), np.int16)
        V = np.zeros((nh, len(LL)), np.int16)
        for j, g in enumerate(grid):
            for h, (sp, dr) in enumerate(zip(g["hourly"]["wind_speed_10m"], g["hourly"]["wind_direction_10m"])):
                if sp is None or dr is None:
                    continue
                u_, v_ = uv(sp, dr)
                U[h, j], V[h, j] = round(u_ * 10), round(v_ * 10)      # 0.1 km/h units
        (OUT / f"wind_{key}_{k}.json").write_text(json.dumps(dict(
            source="ERA5 (ECMWF) via Open-Meteo archive API, 10 m wind, hourly",
            lons=np.round(glons, 3).tolist(), lats=np.round(glats, 3).tolist(), t0=round(hours0, 4), n=nh,
            u=U.ravel().tolist(), v=V.ravel().tolist(), scale=0.1,
            # hourly series at the fire's starting point (same hours): speed and gust in km/h, direction it blows from
            point=start_pt, pt0=round(hours0, 4),
            speed=[None if np.isnan(q) else round(float(q)) for q in spd],
            dir=[None if np.isnan(q) else round(float(q)) for q in dirn],
            gust=[None if np.isnan(q) else round(float(q)) for q in gust]), separators=(",", ":")))

        def wind_at(day_from, day_to):
            """vector-mean wind at the starting point between two times, and the strongest gust"""
            a = max(0, int(math.floor((day_from - hours0) * 24)))
            b = min(len(spd), int(math.ceil((day_to - hours0) * 24)))
            if b <= a:
                return None
            mu, mv = np.nanmean(pu[a:b]), np.nanmean(pv[a:b])
            if np.isnan(mu):
                return None
            return dict(from_deg=round((bearing(mu, mv) + 180) % 360), to_deg=round(bearing(mu, mv)),
                        speed=round(float(np.nanmean(spd[a:b])), 1), steady=round(float(math.hypot(mu, mv)), 1),
                        gust=round(float(np.nanmax(gust[a:b])), 1))

        def wind_hour(dd):
            h = int(round((dd - hours0) * 24))
            if 0 <= h < len(spd) and not np.isnan(spd[h]):
                return dict(from_deg=round(float(dirn[h])), speed=round(float(spd[h]), 1), gust=round(float(gust[h]), 1))
            return None

        # ---- daily spread, by local calendar day ----
        local = [to_dt(v).astimezone(tz) for v in t[idx]]
        days, order = {}, []
        for j, d in enumerate(local):
            key_d = d.date()
            if key_d not in days:
                days[key_d] = []
                order.append(key_d)
            days[key_d].append(j)
        daily = []
        seen = []
        if p["origin"]:
            ox, oy = km_xy([p["origin"][0]], [p["origin"][1]], lon0, lat0)
            prev_c = (float(ox[0]), float(oy[0]))
        else:
            prev_c = None
        for key_d in order:
            js = days[key_d]
            day_start = (datetime(key_d.year, key_d.month, key_d.day, tzinfo=tz).astimezone(timezone.utc) - epoch).total_seconds() / 86400
            cx, cy = float(x[js].mean()), float(y[js].mean())
            rec: dict = dict(date=key_d.isoformat(), start=round(day_start, 4), end=round(day_start + 1, 4), new=len(js),
                       frp=round(float(frp[idx[js]].sum()), 1), centre=[round(float(lon[idx[js]].mean()), 4), round(float(lat[idx[js]].mean()), 4)])
            if prev_c is not None:
                dx, dy = cx - prev_c[0], cy - prev_c[1]
                dist = math.hypot(dx, dy)
                rec["from"] = [round(prev_c[0] / (111.32 * math.cos(math.radians(lat0))) + lon0, 4), round(prev_c[1] / 110.57 + lat0, 4)]
                rec["spread_km"] = round(dist, 1)
                rec["spread_to_deg"] = round(bearing(dx, dy)) if dist > 0 else None
            wd = wind_at(day_start + BURN_HOURS[0] / 24, day_start + BURN_HOURS[1] / 24)
            rec["wind"] = wd
            cls = None
            if rec.get("spread_km") is not None and rec["spread_km"] >= MIN_SPREAD_KM and len(js) >= MIN_NEW and wd:
                if wd["speed"] < LIGHT_WIND:
                    cls = "light"
                else:
                    diff = angle_diff(rec["spread_to_deg"], wd["to_deg"])
                    rec["angle_to_wind"] = round(diff)
                    cls = "with" if diff <= 45 else "across" if diff <= 135 else "against"
            rec["class"] = cls
            daily.append(rec)
            seen += js
            prev_c = (float(x[seen].mean()), float(y[seen].mean()))

        big = max(daily, key=lambda q: q["new"])
        classified = [q for q in daily if q["class"] in ("with", "across", "against")]
        share_with = (sum(q["new"] for q in classified if q["class"] == "with") / sum(q["new"] for q in classified)) if classified else None
        fires.append(dict(
            id=k, name=p["name"], uid=p["uid"], acres=p["acres"], cause=p["cause"], cause_class=p["cause_class"],
            fuel=p["fuel"], state=p["state"], complex=p["complex"],
            disc=round(p["disc"], 4), contain=round(p["contain"], 4) if p["contain"] else None,
            origin=[round(v, 5) for v in p["origin"]] if p["origin"] else None,
            first_det=round(t_first, 4), last_det=round(t_last, 4), first_det_lonlat=[float(lon[idx[0]]), float(lat[idx[0]])],
            n_det=int(len(idx)), det=idx.tolist(),
            wind_at_start=wind_hour(p["disc"]),
            biggest_day=dict(date=big["date"], new=big["new"], cls=big["class"], spread_to_deg=big.get("spread_to_deg"),
                             spread_km=big.get("spread_km"), wind=big["wind"], angle=big.get("angle_to_wind")),
            share_with_wind=round(share_with, 2) if share_with is not None else None,
            daily=daily, bbox=[round(float(lon[idx].min()), 4), round(float(lat[idx].min()), 4), round(float(lon[idx].max()), 4), round(float(lat[idx].max()), 4)]))
        bd = fires[-1]["biggest_day"]
        print(f"  {p['name']:<24} {len(idx):>5} dets  biggest {bd['date']} ({bd['new']}): {bd['cls']}")
    (OUT / f"{key}.json").write_text(json.dumps(dict(
        region=key, tz=TZ[key], year=year,
        method=dict(burn_hours=list(BURN_HOURS), min_dets=MIN_DETS, min_spread_km=MIN_SPREAD_KM, min_new=MIN_NEW, light_wind_kmh=LIGHT_WIND),
        fires=fires), separators=(",", ":")))
    return fires


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for key in TZ:
        print(key)
        total += len(build_region(key))
    print(f"{total} fire stories")


if __name__ == "__main__":
    main()
