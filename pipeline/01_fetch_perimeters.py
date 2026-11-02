"""Download WFIGS wildfire perimeters (with discovery time and point of origin) for each
region that has ground truth. Output: data/raw/perims_<region>.geojson"""
import json
import pathlib
import requests
from regions import REGIONS

ROOT = pathlib.Path(__file__).resolve().parents[1]
URL = ("https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/"
       "WFIGS_Interagency_Perimeters/FeatureServer/0/query")
FIELDS = ",".join([
    "poly_IncidentName", "attr_IncidentName", "attr_UniqueFireIdentifier", "attr_IrwinID",
    "attr_FireDiscoveryDateTime", "attr_ContainmentDateTime", "attr_FireOutDateTime",
    "attr_InitialLatitude", "attr_InitialLongitude", "attr_FireCauseGeneral", "attr_FireCause",
    "attr_IncidentSize", "poly_GISAcres", "attr_IsCpxChild", "attr_CpxName", "attr_IncidentTypeKind",
])


def fetch(region):
    r = REGIONS[region]
    w, s, e, n = r["bbox"]
    y = r["year"]
    feats, offset = [], 0
    while True:
        params = dict(
            where=(f"attr_IncidentTypeCategory='WF' AND attr_FireDiscoveryDateTime >= DATE '{y}-01-01' "
                   f"AND attr_FireDiscoveryDateTime < DATE '{y + 1}-01-01' AND poly_GISAcres >= 50"),
            geometry=f"{w},{s},{e},{n}", geometryType="esriGeometryEnvelope", inSR=4326,
            spatialRel="esriSpatialRelIntersects", outFields=FIELDS, outSR=4326,
            maxAllowableOffset=0.0005, geometryPrecision=5, resultOffset=offset,
            resultRecordCount=200, f="geojson")
        d = requests.post(URL, data=params, timeout=120).json()
        batch = d.get("features", [])
        feats += batch
        if len(batch) < 200:
            break
        offset += len(batch)
    out = ROOT / "data/raw" / f"perims_{region}.geojson"
    out.write_text(json.dumps(dict(type="FeatureCollection", features=feats)))
    print(f"{region}: {len(feats)} perimeters -> {out.name}")


if __name__ == "__main__":
    for k, v in REGIONS.items():
        if v["truth"]:
            fetch(k)
