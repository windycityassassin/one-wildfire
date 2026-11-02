"""The ground up close: the drone site cut into 20 m tiles at full quality, for the game and AR.

The whole-site texture (ortho.jpg, about 4.4 cm a pixel) and terrain (25 or 50 cm a point) from 30_drone_scene.py
are what the page shows from a distance. Close in, the page swaps in these tiles around the circle being looked at:

  * tiles/<i>_<j>.jpg   the orthophoto at its own 1 cm, north up
  * tiles/<i>_<j>.bin   heights every 10 cm, uint16 millimetres above site zmin, rows from north to south, like
                        terrain_<res>.bin: the bare ground, with shrubs kept at 15% of their height. The photo is
                        taken from straight above, so a full-height shrub stretches its picture down its sides
                        (a smeared cone); low, the photo lies almost flat and reads like a sharp print
  * tiles/index.json    the grid: tile size, resolutions, and each tile's corner and size in site metres

Tile (i, j) covers x from i * 20 m and y from j * 20 m in the site's own frame (x east, y north from the site's
south-west corner, as in site.json); the last row and column are cut at the site's edge.
Run after 30_drone_scene.py (it reads site.json for the frame and zmin).
"""
import json
import pathlib

import numpy as np
import rasterio
from PIL import Image, ImageFilter
from rasterio.enums import Resampling
from rasterio.windows import from_bounds
from scipy import ndimage

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw/uas/soda2"
OUT = ROOT / "web/data/drone/soda2"
ORTHO = RAW / "20220630_SODA2_rgbOrthophoto.tif"
DSM = RAW / "20220630_SODA2_dsm.tif"
CHM = RAW / "SodaNaturalArea2_20220630_chm_wgs84utm11n.tif"     # DSM minus bare ground (DTM), same grid as the DSM
TILE = 20.0         # m
PX = 0.01           # m a pixel: the orthophoto's own resolution
STEP = 0.10         # m between height points: a young shrub (10–25 cm) gets a few points, a big one dozens
SOFT = 1.0          # height points of gaussian softening
SHRUB = 0.15        # how much of each shrub's height to keep
QUALITY = 88


def read(path, bounds, shape_, bands=1):
    with rasterio.open(path) as r:
        w = from_bounds(*bounds, transform=r.transform)
        a = r.read(bands, window=w, out_shape=shape_ if bands == 1 else (len(bands),) + shape_,
                   resampling=Resampling.average, boundless=True, fill_value=0 if bands != 1 else np.nan)
        nod = r.nodata
    if bands == 1:
        a = a.astype("float32")
        if nod is not None:
            a[a == nod] = np.nan
    return a


def fill_nan(a):
    m = np.isnan(a)
    if not m.any():
        return a
    idx = ndimage.distance_transform_edt(m, return_distances=False, return_indices=True)
    return a[tuple(idx)]


def main():
    site = json.loads((OUT / "site.json").read_text())
    (x0, y0), (W, H), zmin = site["origin"], site["size"], site["zmin"]
    (OUT / "tiles").mkdir(exist_ok=True)
    # heights for the whole site at once, so neighbouring tiles share their edge points exactly (no cracks)
    NX, NY = int(round(W / STEP)) + 1, int(round(H / STEP)) + 1
    grid = (x0 - STEP / 2, y0 - STEP / 2, x0 + (NX - 0.5) * STEP, y0 + (NY - 0.5) * STEP)
    Z = fill_nan(read(DSM, grid, (NY, NX)))
    Z -= (1 - SHRUB) * np.clip(np.nan_to_num(read(CHM, grid, (NY, NX)), nan=0.0), 0, None)
    Z = ndimage.gaussian_filter(Z, SOFT)          # rows run north to south: row r is y = (NY - 1 - r) * STEP
    tiles, total = [], 0
    for i in range(int(np.ceil(W / TILE))):
        for j in range(int(np.ceil(H / TILE))):
            tx, ty = i * TILE, j * TILE
            w, h = min(TILE, W - tx), min(TILE, H - ty)
            b = (x0 + tx, y0 + ty, x0 + tx + w, y0 + ty + h)
            # the photo, at 1 cm
            rgb = read(ORTHO, b, (int(round(h / PX)), int(round(w / PX))), bands=[1, 2, 3])
            f = OUT / "tiles" / f"{i}_{j}.jpg"
            im = Image.fromarray(np.moveaxis(rgb, 0, -1).astype("uint8"))
            # a light unsharp mask: the mosaic is a little soft; colours are left as they are
            im = im.filter(ImageFilter.UnsharpMask(radius=1.2, percent=70, threshold=2))
            im.save(f, quality=QUALITY, optimize=True, progressive=True)
            # heights every 10 cm: this tile's part of the whole-site grid, edges included (shared with the neighbours)
            c0, c1 = int(round(tx / STEP)), min(NX - 1, int(round((tx + w) / STEP)))
            r0, r1 = NY - 1 - min(NY - 1, int(round((ty + h) / STEP))), NY - 1 - int(round(ty / STEP))
            z = Z[r0:r1 + 1, c0:c1 + 1]
            ny, nx = z.shape
            (OUT / "tiles" / f"{i}_{j}.bin").write_bytes(np.clip((z - zmin) * 1000, 0, 65535).astype("<u2").tobytes())
            tiles.append(dict(i=i, j=j, x=round(tx, 2), y=round(ty, 2), w=round(w, 2), h=round(h, 2), nx=nx, ny=ny))
            total += f.stat().st_size
            print(f"{i}_{j}  {w:.1f} x {h:.1f} m  {f.stat().st_size / 1e6:.2f} MB")
    (OUT / "tiles" / "index.json").write_text(json.dumps(dict(tile=TILE, px=PX, step=STEP, tiles=tiles)))
    print(f"{len(tiles)} tiles, photos {total / 1e6:.0f} MB")


if __name__ == "__main__":
    main()
