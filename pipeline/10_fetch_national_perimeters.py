"""National training labels: WFIGS wildfire perimeters >= 100 acres in the contiguous US, 2020-2024,
with discovery time, point of origin and cause. Output: data/raw/perims_conus_<year>.geojson"""
import json
import pathlib
import time

import requests

ROOT = pathlib.Path(__file__).resolve().parents[1]
URL = ("https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/"
       "WFIGS_Interagency_Perimeters/FeatureServer/0/query")
FIELDS = ",".join([
    "poly_IncidentName", "attr_IncidentName", "attr_UniqueFireIdentifier", "attr_FireDiscoveryDateTime",
    "attr_ContainmentDateTime", "attr_FireOutDateTime", "attr_InitialLatitude", "attr_InitialLongitude",
    "attr_FireCauseGeneral", "attr_FireCause", "poly_GISAcres", "attr_IsCpxChild", "attr_CpxName",
    "attr_POOState", "attr_GACC", "attr_PredominantFuelGroup",
])


def fetch_year(y):
    out = ROOT / "data/raw" / f"perims_conus_{y}.geojson"
    if out.exists():
        print(f"have {out.name}")
        return
    feats, offset = [], 0
    while True:
        params = dict(
            where=(f"attr_IncidentTypeCategory='WF' AND attr_FireDiscoveryDateTime >= DATE '{y}-01-01' "
                   f"AND attr_FireDiscoveryDateTime < DATE '{y + 1}-01-01' AND poly_GISAcres >= 100 "
                   "AND attr_POOState NOT IN ('US-AK','US-HI')"),
            outFields=FIELDS, outSR=4326, maxAllowableOffset=0.0005, geometryPrecision=5,
            resultOffset=offset, resultRecordCount=200, orderByFields="OBJECTID", f="geojson")
        for attempt in range(4):
            try:
                d = requests.post(URL, data=params, timeout=180).json()
                break
            except Exception as e:  # transient ArcGIS errors
                print("retry", y, offset, e)
                time.sleep(3 * (attempt + 1))
        batch = d.get("features", [])
        feats += batch
        if len(batch) < 200:
            break
        offset += len(batch)
    out.write_text(json.dumps(dict(type="FeatureCollection", features=feats)))
    print(f"{y}: {len(feats)} perimeters")


if __name__ == "__main__":
    for y in range(2020, 2025):
        fetch_year(y)
