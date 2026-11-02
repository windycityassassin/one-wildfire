"""Add each detection's real pixel footprint to the region files, so the map can draw it at true size.

FIRMS reports, for every MODIS detection, the pixel's size on the ground: `scan` (across the satellite's
path, roughly east-west) and `track` (along it, roughly north-south), in km. Pixels are about 1 x 1 km
under the satellite and grow to about 4.8 x 2 km at the edge of the swath.

Detections are matched to the raw archive on the same rounded keys 02_build uses (lon and lat to
4 decimals, time to 0.001 day). Adds det.scan and det.track to web/data/<region>.json.
"""
import json
import pathlib

import pandas as pd

from regions import REGIONS

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW, WEB = ROOT / "data/raw", ROOT / "web/data"


def main():
    for key, r in REGIONS.items():
        path = WEB / f"{key}.json"
        R = json.loads(path.read_text())
        df = pd.read_csv(RAW / r["firms"], usecols=["latitude", "longitude", "scan", "track", "acq_date", "acq_time"])
        ts = pd.to_datetime(df.acq_date + df.acq_time.astype(str).str.zfill(4), format="%Y-%m-%d%H%M", utc=True)
        t = ((ts - pd.Timestamp(f"{r['year']}-01-01", tz="UTC")).dt.total_seconds() / 86400).round(3)
        keys = pd.DataFrame(dict(lon=df.longitude.round(4), lat=df.latitude.round(4), t=t, scan=df.scan, track=df.track))
        keys = keys.groupby(["lon", "lat", "t"], as_index=False)[["scan", "track"]].mean()
        lut = {(a, b, c): (s, k) for a, b, c, s, k in keys.itertuples(index=False)}
        d = R["det"]
        scan, track, miss = [], [], 0
        for lon, lat, tt in zip(d["lon"], d["lat"], d["t"]):
            hit = lut.get((round(lon, 4), round(lat, 4), round(tt, 3)))
            if hit is None:
                miss += 1
                hit = (1.0, 1.0)
            scan.append(round(float(hit[0]), 2))
            track.append(round(float(hit[1]), 2))
        d["scan"], d["track"] = scan, track
        path.write_text(json.dumps(R, separators=(",", ":")))
        print(f"{key}: {len(scan)} detections, {miss} unmatched, median pixel {pd.Series(scan).median():.2f} x {pd.Series(track).median():.2f} km")


if __name__ == "__main__":
    main()
