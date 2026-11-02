"""Human-started vs lightning-started fires, 2020-2024, from the same WFIGS perimeters (>= 100 acres).

Echoes Cattau et al. (2020, Global Ecology and Biogeography): areas dominated by lightning ignitions
had larger fires; areas dominated by human ignitions had longer fire seasons. That study used >1.8
million records, 1984-2016, on a 50 km grid; this is a simpler check on recent perimeters only.

Season length here = the span of discovery dates holding the middle 90% of fires of that cause.
Output: web/data/causes.json
"""
import json
import pathlib
from datetime import datetime, timezone

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW, WEB = ROOT / "data/raw", ROOT / "web/data"
NAMES = {"Human": "human", "Natural": "lightning", "Undetermined": "undetermined"}


def main():
    rows = []
    for y in range(2020, 2025):
        for f in json.loads((RAW / f"perims_conus_{y}.geojson").read_text())["features"]:
            p = f["properties"]
            if not p["attr_FireDiscoveryDateTime"] or p["attr_FireCause"] not in NAMES:
                continue
            d = datetime.fromtimestamp(p["attr_FireDiscoveryDateTime"] / 1000, tz=timezone.utc)
            rows.append((NAMES[p["attr_FireCause"]], float(p["poly_GISAcres"] or 0), d.month, d.timetuple().tm_yday))
    out: dict = dict(years=[2020, 2024], min_acres=100, causes={})
    for c in NAMES.values():
        R = [r for r in rows if r[0] == c]
        acres = np.array([r[1] for r in R])
        doy = np.array([r[3] for r in R])
        lo, hi = np.percentile(doy, [5, 95])
        out["causes"][c] = dict(
            n=len(R), median_acres=round(float(np.median(acres))), mean_acres=round(float(acres.mean())),
            season_days=int(round(hi - lo)), season_from=int(lo), season_to=int(hi),
            by_month=[int(sum(1 for r in R if r[2] == m)) for m in range(1, 13)])
        print(c, out["causes"][c])
    out["n_total"] = len(rows)
    (WEB / "causes.json").write_text(json.dumps(out, separators=(",", ":")))


if __name__ == "__main__":
    main()
