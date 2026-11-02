"""The ground: one drone-mapped site on the edge of the 2015 Soda Fire, seven years later.

Data (CC BY 4.0, University of Idaho / Boise State, Caughlin lab):
  * Zaiats A, Caughlin TT (2023) Low-cost UAS platforms to quantify and predict post-fire recovery in
    arid shrublands. doi:10.7923/96mc-a063  -> burn lines, 78.5 m2 field plots, RTK-mapped plants, CHM
  * Marie V et al. (2023) Digital aerial imagery from the 2015-SODA wildfire boundary.
    doi:10.7923/59M8-5S68  -> 1 cm RGB orthophoto and DSM (OpenDroneMap), flown 30 June 2022

What this script makes, for web/data/drone/<site>/:
  * terrain_<res>.bin   surface heights (DSM, so shrubs stand up), uint16 millimetres above zmin
  * ortho.jpg           the photo draped on it
  * site.json           burn line, field plots, field-mapped shrubs, the drone's shrub detections,
                        and how many of the field shrubs the drone found (by burn side and size)
  * plots/<cid>.jpg     each field plot at 1 cm, for close-up viewing

The drone detection is a plain re-run of the usual canopy-height approach (local maxima on a lightly
smoothed canopy height model), not the authors' exact pipeline. Their published detection rates
(Zaiats et al. 2024, Methods Ecol Evol) are quoted next to ours in the page.
"""
import json
import pathlib

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.windows import from_bounds
from scipy import ndimage
from shapely.geometry import Point, shape
from shapely.ops import linemerge, transform as shp_transform, unary_union
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw/uas"
SITE, KEY = "SodaNaturalArea2", "soda2"
FILES = dict(
    ortho=RAW / KEY / "20220630_SODA2_rgbOrthophoto.tif",
    dsm=RAW / KEY / "20220630_SODA2_dsm.tif",
    chm=RAW / KEY / "SodaNaturalArea2_20220630_chm_wgs84utm11n.tif",
)
OUT = ROOT / "web/data/drone" / KEY
PAD = 3.0                   # metres around the burn-line polygons
RES = {"hi": 0.25, "lo": 0.5}
TEX = 4096                  # ortho texture, long side
PLOT_R = 5.0                # m; where the crew's mapped plants lie (the papers describe 25 m2 plots; unreconciled, so the page gives counts only)
DET_MIN_H = 0.20            # m; canopy maxima lower than this are ground noise (just under the 25 cm field split)
DET_WIN = 0.8               # m; one maximum per window
DET_SMOOTH = 0.04           # m; gaussian sigma before finding maxima
MATCH = 0.6                 # m; a field shrub counts as found if a detection is this close
TALL = 0.25                 # m; the field crew's size split (Ht_gt_25)
REFIT = 1.5                 # m; how far a circle may move to sit on the crew's own plants

to_utm = Transformer.from_crs(4326, 32611, always_xy=True).transform
to_ll = Transformer.from_crs(32611, 4326, always_xy=True).transform


def load():
    burn = [f for f in json.loads((RAW / "burn_lines.geojson").read_text())["features"]
            if f["properties"]["site"] == SITE]
    plots = [f for f in json.loads((RAW / "plot_data.geojson").read_text())["features"]
             if f["properties"]["site"] == SITE]
    plants = [f for f in json.loads((RAW / "plant_data.geojson").read_text())["features"]
              if f["properties"]["site"] == SITE]
    burnt = unary_union([shp_transform(to_utm, shape(f["geometry"])) for f in burn if f["properties"]["burn"] == 1])
    whole = unary_union([shp_transform(to_utm, shape(f["geometry"])) for f in burn])
    return burnt, whole, plots, plants


def read(path, bounds, shape_, resampling=Resampling.average, bands=1):
    with rasterio.open(path) as r:
        w = from_bounds(*bounds, transform=r.transform)
        a = r.read(bands, window=w, out_shape=shape_ if bands == 1 else (len(bands),) + shape_,
                   resampling=resampling, boundless=True, fill_value=0 if bands != 1 else np.nan)
        nod = r.nodata
    a = a.astype("float32") if bands == 1 else a
    if bands == 1 and nod is not None:
        a[a == nod] = np.nan
    return a


def fill_nan(a):
    m = np.isnan(a)
    if not m.any():
        return a
    idx = ndimage.distance_transform_edt(m, return_distances=False, return_indices=True)
    return a[tuple(idx)]


def detect(bounds):
    """Local maxima on the canopy height model at native resolution (about 1.9 cm)."""
    with rasterio.open(FILES["chm"]) as r:
        w = from_bounds(*bounds, transform=r.transform)
        chm = r.read(1, window=w, boundless=True, fill_value=np.nan).astype("float32")
        T = r.window_transform(w)
        px = r.res[0]
    chm = np.nan_to_num(chm, nan=0.0)
    sm = ndimage.gaussian_filter(chm, DET_SMOOTH / px)
    win = int(round(DET_WIN / px)) | 1
    peaks = (sm == ndimage.maximum_filter(sm, size=win)) & (sm >= DET_MIN_H)
    rr, cc = np.nonzero(peaks)
    xs, ys = rasterio.transform.xy(T, rr, cc)
    return np.column_stack([xs, ys, sm[rr, cc]])


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "plots").mkdir(exist_ok=True)
    burnt, whole, plots, plants = load()
    x0, y0, x1, y1 = whole.bounds
    x0, y0, x1, y1 = x0 - PAD, y0 - PAD, x1 + PAD, y1 + PAD
    W, H = x1 - x0, y1 - y0
    print(f"scene {W:.1f} x {H:.1f} m")

    # surface heights
    zmin = None
    meta_terrain = {}
    for name, res in RES.items():
        nx, ny = int(round(W / res)) + 1, int(round(H / res)) + 1
        z = fill_nan(read(FILES["dsm"], (x0, y0, x1, y1), (ny, nx)))
        z = ndimage.gaussian_filter(z, 0.9)      # soften the 25 cm grid so shrubs read as domes, not tents
        if zmin is None:
            zmin = float(np.floor(z.min()))
        mm = np.clip((z - zmin) * 1000, 0, 65535).astype("<u2")
        (OUT / f"terrain_{name}.bin").write_bytes(mm.tobytes())
        meta_terrain[name] = dict(nx=nx, ny=ny, res=res)
        print(name, nx, ny, f"{mm.nbytes / 1e6:.1f} MB", f"relief {z.max() - z.min():.1f} m")

    # photo
    tw = TEX if W >= H else int(TEX * W / H)
    th = int(TEX * H / W) if W >= H else TEX
    rgb = read(FILES["ortho"], (x0, y0, x1, y1), (th, tw), bands=[1, 2, 3])
    Image.fromarray(np.moveaxis(rgb, 0, -1).astype("uint8")).save(OUT / "ortho.jpg", quality=86, optimize=True)

    # drone detections
    det = detect((x0, y0, x1, y1))
    det = det[[whole.buffer(PAD).contains(Point(x, y)) for x, y, _ in det]]
    print(f"{len(det)} drone detections")

    # field plots and shrubs
    # The listed plot centres sit up to ~1.5 m from where the crew's mapped plants say the circle was
    # (5-10% of plants fall just outside 5 m at every site in this dataset). Each circle is re-centred
    # on its own plants: the nearest centre within REFIT that holds the most of them. Plants still
    # outside are dropped, and a circle whose plants mostly lie elsewhere (a mislabelled plot) is left out.
    pts_by = {}
    for f in plants:
        pts_by.setdefault(int(f["properties"]["CID"]), []).append(to_utm(*f["geometry"]["coordinates"][:2]))
    grid = np.arange(-REFIT, REFIT + 1e-9, 0.1)
    offs = np.array([(a, b) for a in grid for b in grid])
    offs = offs[np.argsort(np.hypot(*offs.T), kind="stable")]       # nearest first, so ties keep the listed centre
    plot_list, dropped_plots = [], []
    for f in plots:
        cid = int(f["properties"]["cid"])
        x, y = to_utm(*f["geometry"]["coordinates"][:2])
        pts = np.array(pts_by.get(cid, []), dtype=float).reshape(-1, 2)
        if len(pts):
            cen = np.array([x, y]) + offs
            inside = (np.hypot(pts[None, :, 0] - cen[:, None, 0], pts[None, :, 1] - cen[:, None, 1]) <= PLOT_R).sum(1)
            k = int(np.argmax(inside))
            if inside[k] < 0.8 * len(pts):
                dropped_plots.append(cid)
                continue
            x, y = cen[k]
        plot_list.append(dict(cid=cid, x=float(x), y=float(y), burnt=bool(burnt.contains(Point(x, y)))))
    pc = {p["cid"]: p for p in plot_list}
    shrubs, stray = [], 0
    for f in plants:
        p = f["properties"]
        if p["Class"] != "Shrub":
            continue
        cid = int(p["CID"])
        x, y = to_utm(*f["geometry"]["coordinates"][:2])
        if cid not in pc or np.hypot(x - pc[cid]["x"], y - pc[cid]["y"]) > PLOT_R:
            stray += 1
            continue
        shrubs.append(dict(x=x, y=y, cid=cid, tall=int(p["Ht_gt_25"]), sp=p["Species"]))
    print(f"circles: {len(plot_list)} kept, left out {dropped_plots}; {stray} stray shrubs dropped")

    # match: within each plot, nearest-first greedy pairing of field shrubs and detections
    from scipy.spatial import cKDTree
    tree = cKDTree(det[:, :2])
    used = set()
    pairs = []
    for i, s in enumerate(shrubs):
        for d, j in zip(*tree.query([s["x"], s["y"]], k=6, distance_upper_bound=MATCH)):
            if np.isfinite(d):
                pairs.append((d, i, int(j)))
    pairs.sort()
    found = {}
    for d, i, j in pairs:
        if i in found or j in used:
            continue
        found[i] = j
        used.add(j)
    for i, s in enumerate(shrubs):
        s["found"] = i in found
        s["burnt"] = pc[s["cid"]]["burnt"] if s["cid"] in pc else bool(burnt.contains(Point(s["x"], s["y"])))

    # detections inside plots that match no field shrub (false or non-shrub)
    in_plot = np.zeros(len(det), bool)
    ptree = cKDTree([[p["x"], p["y"]] for p in plot_list])
    dd, _ = ptree.query(det[:, :2])
    in_plot = dd <= PLOT_R
    false_pos = int(sum(1 for j in np.nonzero(in_plot)[0] if j not in used))

    def rate(sel):
        n = len(sel)
        k = sum(s["found"] for s in sel)
        return dict(n=n, found=k, p=round(k / n, 3) if n else None)

    summary = {}
    for side in ("burnt", "unburnt"):
        S = [s for s in shrubs if s["burnt"] == (side == "burnt")]
        summary[side] = dict(all=rate(S), tall=rate([s for s in S if s["tall"]]), short=rate([s for s in S if not s["tall"]]),
                             plots=sum(1 for p in plot_list if p["burnt"] == (side == "burnt")))
    summary["false_in_plots"] = false_pos
    summary["detections_in_plots"] = int(in_plot.sum())
    print(json.dumps(summary, indent=1))

    # per-plot 1 cm crops
    for p in plot_list:
        b = (p["x"] - PLOT_R - 0.5, p["y"] - PLOT_R - 0.5, p["x"] + PLOT_R + 0.5, p["y"] + PLOT_R + 0.5)
        a = read(FILES["ortho"], b, (1100, 1100), bands=[1, 2, 3], resampling=Resampling.average)
        Image.fromarray(np.moveaxis(a, 0, -1).astype("uint8")).save(
            OUT / "plots" / f"{p['cid']}.jpg", quality=82, optimize=True)

    L = lambda x, y: [round(x - x0, 2), round(y - y0, 2)]
    # the fire edge: where burnt meets unburnt (not the site's own straight edges)
    unburnt = whole.difference(burnt.buffer(0.01))
    edge = burnt.boundary.intersection(unburnt.buffer(0.3)).simplify(0.2)
    edge = linemerge(edge) if edge.geom_type == "MultiLineString" else edge
    burn_rings = [[L(*c) for c in g.coords] for g in getattr(edge, "geoms", [edge]) if g.length > 2]
    burnt_rings = [[L(*c) for c in g.exterior.coords] for g in getattr(burnt, "geoms", [burnt])]

    # canopy height texture: what the drone measures, for the "drone's eye" view (0-1.2 m -> 0-255)
    chm = read(FILES["chm"], (x0, y0, x1, y1), (th, tw), resampling=Resampling.average)
    chm = np.nan_to_num(chm, nan=0.0)
    Image.fromarray((np.clip(chm / 1.2, 0, 1) * 255).astype("uint8")).save(OUT / "chm.png", optimize=True)
    lon, lat = to_ll((x0 + x1) / 2, (y0 + y1) / 2)
    site = dict(
        site=SITE, fire="Soda Fire", fire_year=2015, flown="2022-06-30", crs="EPSG:32611",
        origin=[round(x0, 2), round(y0, 2)], size=[round(W, 2), round(H, 2)], center_lonlat=[round(lon, 6), round(lat, 6)],
        zmin=zmin, terrain=meta_terrain, texture=[tw, th], plot_r=PLOT_R, plot_crop=PLOT_R + 0.5,
        burn=burn_rings, burnt=burnt_rings,
        plots=[dict(cid=p["cid"], xy=L(p["x"], p["y"]), burnt=p["burnt"]) for p in plot_list],
        shrubs=[dict(xy=L(s["x"], s["y"]), cid=s["cid"], tall=s["tall"], found=s["found"], burnt=s["burnt"]) for s in shrubs],
        detections=[[*L(x, y), round(float(h), 2)] for x, y, h in det],
        summary=summary,
        method=dict(det_min_h=DET_MIN_H, det_window=DET_WIN, smooth=DET_SMOOTH, match=MATCH),
        sources=["doi:10.7923/96mc-a063", "doi:10.7923/59M8-5S68"],
    )
    (OUT / "site.json").write_text(json.dumps(site, separators=(",", ":")))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
