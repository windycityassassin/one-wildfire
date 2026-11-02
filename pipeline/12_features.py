"""Compute pair features and pair labels for every year. Output data/national/feat_<year>.npy (float16)
and lab_<year>.npy (int8: 1 same fire, 0 different fires or fire vs background, -1 unknown)."""
import pathlib
import time

import numpy as np

from linkfeat import pair_features

NAT = pathlib.Path(__file__).resolve().parents[1] / "data/national"

for year in range(2020, 2025):
    t0 = time.time()
    det = dict(np.load(NAT / f"dets_{year}.npz"))
    pr = np.load(NAT / f"pairs_{year}.npz")
    i, j, d, dt = pr["i"], pr["j"], pr["d"], pr["dt"]
    X = pair_features(det, i, j, d, dt)
    np.save(NAT / f"feat_{year}.npy", X.astype(np.float16))
    ti, tj = det["truth"][i], det["truth"][j]
    lab = np.full(len(i), -1, np.int8)
    both = (ti >= 0) & (tj >= 0)
    lab[both] = (ti[both] == tj[both])
    lab[((ti >= 0) & (tj == -1)) | ((ti == -1) & (tj >= 0))] = 0
    np.save(NAT / f"lab_{year}.npy", lab)
    print(f"{year}: {len(i):,} pairs, same={int((lab == 1).sum()):,} diff={int((lab == 0).sum()):,} "
          f"unknown={int((lab == -1).sum()):,}  {time.time() - t0:.0f}s")
