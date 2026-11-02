"""Attach learned-linkage results to each demo region for the web app.

Single linkage over all pairs with p >= tau gives exactly the same events as the maximum spanning
forest (MSF) of the probability graph cut at tau. So each region only needs its MSF edges: at most
one per detection. The browser can then regroup at any tau and let a person override single links.

US regions use the model trained WITHOUT the region they sit in (so what the app shows is
out-of-sample). Kalimantan uses the model trained on all US regions.
"""
import importlib
import json
import pathlib

import joblib
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import minimum_spanning_tree
from scipy.spatial import cKDTree

from cluster import project
from linkfeat import pair_features
from regions import REGIONS

build = importlib.import_module("02_build")
nat = importlib.import_module("11_national_dataset")
ROOT = pathlib.Path(__file__).resolve().parents[1]
MOD, WEB = ROOT / "data/models", ROOT / "web/data"
NAMES = ["Pacific Northwest", "California", "Southwest", "Great Basin & N. Rockies", "Plains", "East"]


def pairs_local(x, y, t, dmax=10.0, tmax=14.0):
    tree = cKDTree(np.column_stack([x, y, t * dmax / tmax]))
    pr = tree.query_pairs(dmax, p=np.inf, output_type="ndarray")
    i, j = pr[:, 0], pr[:, 1]
    d = np.hypot(x[i] - x[j], y[i] - y[j])
    k = d <= dmax
    i, j, d = i[k], j[k], d[k]
    sw = i > j
    i[sw], j[sw] = j[sw], i[sw]
    return i.astype(np.int32), j.astype(np.int32), d.astype(np.float32), np.abs(t[i] - t[j]).astype(np.float32)


def msf(n, i, j, p, pmin=0.02):
    k = p >= pmin
    w = (1.0 - p[k]).astype(np.float64) + 1e-6           # minimum spanning tree on 1 - p
    g = coo_matrix((w, (i[k], j[k])), shape=(n, n)).tocsr()
    t = minimum_spanning_tree(g).tocoo()
    return t.row.astype(np.int32), t.col.astype(np.int32), (1.0 - (t.data - 1e-6)).clip(0, 1)


for key, r in REGIONS.items():
    df = build.load_detections(r)
    path = WEB / f"{key}.json"
    data = json.loads(path.read_text())
    assert np.allclose(df.t.values, data["det"]["t"]), key        # same detections, same order as the app
    w, s, e, n = r["bbox"]
    x, y = project(df.longitude.values, df.latitude.values, (w + e) / 2, (s + n) / 2)
    t = df.t.values
    i, j, d, dt = pairs_local(x, y, t)
    det = dict(frp=df.frp.values, scan=df.scan.values, track=df.track.values,
               night=(df.daynight.values == "N"), aqua=(df.satellite.values == "Aqua"),
               conf=df.confidence.values, t=t)
    X = pair_features(det, i, j, d, dt)
    cx, cy = r["center"]
    if key == "kalimantan_2019":
        fold, mname = None, "linkage_all_us.joblib"
    else:
        fold = int(nat.region_of(np.array([cx]), np.array([cy]))[0])
        mname = f"linkage_without_{fold}.joblib"
    model = joblib.load(MOD / mname)
    p = model.predict_proba(X)[:, 1]
    a, b, q = msf(len(t), i, j, p)
    data["link"] = dict(i=a.tolist(), j=b.tolist(), p=np.round(q, 3).tolist(),
                        model="trained on all US regions" if fold is None else f"trained without {NAMES[fold]}")
    path.write_text(json.dumps(data, separators=(",", ":")))
    unsure = int(((q > 0.25) & (q < 0.75)).sum())
    print(f"{key:18s} pairs={len(i):,} msf_edges={len(a):,} uncertain={unsure} model={mname}")
