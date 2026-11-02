"""What a young sagebrush looks like: three close-ups for the game's "what you are looking for" (AR card and AR guide).

Each picture is cut from the drone's own orthophoto at its full 1 cm a pixel (not the 4.4 cm whole-site texture),
centred on a young sagebrush (shorter than 25 cm) that the field crew mapped on the burned side. The crew's point
sits a few centimetres from the tuft it marks, so each crop is centred on the tuft itself, by the offset below.

The only processing: Lanczos enlargement to OUT pixels (for sharp display on high-density screens), a light unsharp
mask and a slight contrast lift. No colour change and no invented detail, so the pictures match what the game shows.

  * web/data/drone/soda2/examples/young-<n>.jpg

Run after 30_drone_scene.py (it reads site.json for the frame and the crew's points).
"""
import json
import pathlib

import numpy as np
import rasterio
from PIL import Image, ImageEnhance, ImageFilter
from rasterio.enums import Resampling
from rasterio.windows import from_bounds

ROOT = pathlib.Path(__file__).resolve().parents[1]
ORTHO = ROOT / "data/raw/uas/soda2/20220630_SODA2_rgbOrthophoto.tif"
OUT_DIR = ROOT / "web/data/drone/soda2/examples"
HALF = 0.26         # m: each picture is 52 cm across
OUT = 384           # px
QUALITY = 92
# (circle, crew point in site metres, offset in metres from the crew point to the middle of the tuft)
PICKS = [
    (81, (157.52, 121.03), (0.15, -0.06)),
    (212, (135.34, 96.47), (0.05, 0.04)),
    (105, (138.14, 110.85), (0.02, 0.02)),
]


def main():
    site = json.loads((ROOT / "web/data/drone/soda2/site.json").read_text())
    ox, oy = site["origin"]
    young = {(s["cid"], tuple(s["xy"])) for s in site["shrubs"] if s["burnt"] and not s["tall"]}
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    n = int(round(2 * HALF / 0.01))
    with rasterio.open(ORTHO) as r:
        for k, (cid, xy, (dx, dy)) in enumerate(PICKS, 1):
            assert (cid, xy) in young, f"not a young shrub on the burned side: circle {cid} {xy}"
            x, y = ox + xy[0] + dx, oy + xy[1] + dy
            a = r.read((1, 2, 3), window=from_bounds(x - HALF, y - HALF, x + HALF, y + HALF, r.transform),
                       out_shape=(3, n, n), resampling=Resampling.nearest, boundless=True)
            im = Image.fromarray(np.moveaxis(a, 0, -1)).resize((OUT, OUT), Image.LANCZOS)
            im = im.filter(ImageFilter.UnsharpMask(radius=OUT / n * 0.9, percent=70, threshold=3))
            im = ImageEnhance.Contrast(im).enhance(1.08)
            im.save(OUT_DIR / f"young-{k}.jpg", quality=QUALITY, optimize=True, progressive=True)
            print(f"young-{k}.jpg  circle {cid}")


if __name__ == "__main__":
    main()
