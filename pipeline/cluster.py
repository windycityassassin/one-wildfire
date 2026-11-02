"""Space-time clustering of active-fire detections into fire events.

Re-implementation of the rule described in Cattau et al. (2016) and reused in Sloan et al. (2022):
two detections belong to the same event if they are within a spatial distance d of each other
AND within a temporal window T of each other; events are the connected components of that graph
(single linkage). The event's ignition is its earliest detection.

Cattau's published default is "same or adjacent 1-km cell, within 4 days". Without snapping to a
1-km grid, the closest equivalent on raw detection centres is d ~ 1.5 km (the diagonal of a 3x3
neighbourhood), T = 4 days.
"""
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

D_GRID = [0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 7.5, 10.0]   # km
T_GRID = [0.5, 1.0, 2.0, 3.0, 4.0, 7.0, 10.0, 14.0]        # days
CATTAU_DEFAULT = (1.5, 4.0)


def project(lon, lat, lon0, lat0):
    """Local equirectangular projection to km. Good to a few percent over a ~400 km region."""
    x = (lon - lon0) * 111.32 * np.cos(np.radians(lat0))
    y = (lat - lat0) * 110.57
    return x, y


class Clusterer:
    """Caches the spatial neighbour pairs at the largest distance so every (d, T) combo is cheap."""

    def __init__(self, x, y, t, dmax=max(D_GRID)):
        self.n = len(x)
        self.t = t
        tree = cKDTree(np.column_stack([x, y]))
        pairs = tree.query_pairs(dmax, output_type="ndarray")
        self.i, self.j = pairs[:, 0], pairs[:, 1]
        self.dist = np.hypot(x[self.i] - x[self.j], y[self.i] - y[self.j])
        self.dt = np.abs(t[self.i] - t[self.j])

    def labels(self, d, T):
        m = (self.dist <= d) & (self.dt <= T)
        g = coo_matrix((np.ones(m.sum(), dtype=np.int8), (self.i[m], self.j[m])), shape=(self.n, self.n))
        _, lab = connected_components(g, directed=False)
        return lab

    def ignitions(self, lab):
        """Index of the earliest detection in each event, as a boolean mask over detections."""
        order = np.lexsort((self.t, lab))
        first = np.ones(len(order), bool)
        first[1:] = lab[order][1:] != lab[order][:-1]
        mask = np.zeros(self.n, bool)
        mask[order[first]] = True
        return mask


def bcubed(pred, truth):
    """B-cubed precision/recall/F1 over detections that fall inside an official perimeter (truth >= 0).

    truth == -1 marks background detections (clearly outside every perimeter: small unmapped fires,
    prescribed and agricultural burns). They are not scored themselves, but they count against the
    precision of any event they are merged into. truth == -2 marks detections just outside a perimeter
    edge (likely the same fire, displaced by pixel size); they are ignored entirely.
    Precision drops when separate fires are merged; recall drops when one fire is split."""
    keep = truth != -2
    p_all, g_all = pred[keep], truth[keep]
    k = g_all >= 0
    p, g = p_all[k], g_all[k]
    if len(p) == 0:
        return np.nan, np.nan, np.nan
    _, inv_pg, cnt_pg = np.unique(np.column_stack([p, g]), axis=0, return_inverse=True, return_counts=True)
    size_p = np.bincount(p_all)                       # event size including background detections
    _, inv_g, cnt_g = np.unique(g, return_inverse=True, return_counts=True)
    inter = cnt_pg[inv_pg.ravel()]
    prec = np.mean(inter / size_p[p])
    rec = np.mean(inter / cnt_g[inv_g])
    return prec, rec, 2 * prec * rec / (prec + rec)
