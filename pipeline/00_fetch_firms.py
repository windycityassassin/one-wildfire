"""Download the NASA FIRMS MODIS C6.1 yearly country archives used by the regions (no API key needed)."""
import pathlib
import requests
from regions import REGIONS

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw"
RAW.mkdir(parents=True, exist_ok=True)

names = {r["firms"] for r in REGIONS.values()} | {f"modis_{y}_United_States.csv" for y in range(2020, 2025)}
for name in sorted(names):
    out = RAW / name
    if out.exists():
        print(f"have {name}")
        continue
    _, year, country = name.removesuffix(".csv").split("_", 2)
    url = f"https://firms.modaps.eosdis.nasa.gov/data/country/modis/{year}/{name}"
    print(f"downloading {url}")
    r = requests.get(url, timeout=600)
    r.raise_for_status()
    out.write_bytes(r.content)
