"""Features for the learned linkage model: for a candidate pair of active-fire detections, how likely
is it that both belong to the same fire?

Only properties of the detections and their immediate space-time neighbourhood are used. Nothing
about location (latitude, longitude, region, land cover) goes in, so the model can be applied where
it was not trained, including outside the US.
"""
import numpy as np
from scipy.sparse import csr_matrix

FEATURES = [
    "dist_km",          # distance between pixel centres
    "gap_days",         # time between detections
    "dist_per_pixel",   # distance in units of the (larger) MODIS pixel footprint
    "pixel_km",         # larger along-scan pixel size of the two (1 km at nadir, ~4.8 km at swath edge)
    "same_overpass",    # detected in the same satellite pass
    "both_night",
    "same_satellite",
    "frp_min_log",      # fire radiative power: weaker of the two
    "frp_max_log",
    "conf_min",
    "density_min",      # neighbours within 3 km and 1 day: sparser end of the pair
    "density_max",
    "shared_neighbours",  # detections within 3 km and 2 days of BOTH: are they connected through others?
    "shared_frac",        # shared neighbours relative to the sparser end
]


def neighbour_matrix(n, i, j, d, dt, dmax, tmax):
    m = (d <= dmax) & (dt <= tmax)
    a = np.concatenate([i[m], j[m]])
    b = np.concatenate([j[m], i[m]])
    return csr_matrix((np.ones(len(a), np.float32), (a, b)), shape=(n, n))


def pair_features(det, i, j, d, dt, chunk=2_000_000):
    """det: dict of per-detection arrays (frp, scan, track, night, aqua, conf, t).
    i, j, d, dt: candidate pairs. Returns float32 array (n_pairs, len(FEATURES))."""
    n = len(det["t"])
    dens = np.asarray(neighbour_matrix(n, i, j, d, dt, 3.0, 1.0).sum(axis=1)).ravel()
    A = neighbour_matrix(n, i, j, d, dt, 3.0, 2.0)
    deg = np.asarray(A.sum(axis=1)).ravel()
    out = np.empty((len(i), len(FEATURES)), np.float32)
    scan, frp = det["scan"], det["frp"]
    for s in range(0, len(i), chunk):
        a, b = i[s:s + chunk], j[s:s + chunk]
        dd, tt = d[s:s + chunk], dt[s:s + chunk]
        pix = np.maximum(scan[a], scan[b])
        shared = np.asarray(A[a].multiply(A[b]).sum(axis=1)).ravel()
        mindeg = np.maximum(np.minimum(deg[a], deg[b]), 1)
        cols = [
            dd, tt, dd / pix, pix, tt < 0.02,
            det["night"][a] & det["night"][b], det["aqua"][a] == det["aqua"][b],
            np.log1p(np.minimum(frp[a], frp[b])), np.log1p(np.maximum(frp[a], frp[b])),
            np.minimum(det["conf"][a], det["conf"][b]),
            np.minimum(dens[a], dens[b]), np.maximum(dens[a], dens[b]),
            shared, shared / mindeg,
        ]
        out[s:s + chunk] = np.column_stack(cols).astype(np.float32)
    return out
