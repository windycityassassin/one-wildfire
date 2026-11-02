"""Ignition-aware fire growth: an alternative to single linkage.

Detections are processed in time order. Each one joins the fire of its nearest EARLIER detection
within d km and T days; if there is none, it starts a new fire (an ignition). When a detection
touches two different fires, they are merged only if they ignited within `merge_days` of each other
(likely one fire first seen as separate patches). Otherwise they stay separate fires that burned
into each other, which is how official records treat neighbouring ignitions.
"""
import numpy as np
from scipy.sparse import csr_matrix


def grow(n, i, j, d, dt, t, dlink, tlink, merge_days):
    """i < j are time-ordered candidate pairs (t[i] <= t[j]). Returns event labels 0..k-1."""
    m = (d <= dlink) & (dt <= tlink)
    # for each detection j, its earlier neighbours i, nearest first
    order = np.lexsort((d[m], j[m]))
    jj, ii, dd = j[m][order], i[m][order], d[m][order]
    ptr = np.searchsorted(jj, np.arange(n + 1))
    parent = np.arange(n)
    label = np.full(n, -1)
    t_ign = np.empty(n)

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for v in np.argsort(t, kind="stable"):
        s, e = ptr[v], ptr[v + 1]
        if s == e:
            label[v] = v
            t_ign[v] = t[v]
            continue
        roots = []
        for u in ii[s:e]:
            if label[u] < 0:
                continue
            r = find(label[u])
            if r not in roots:
                roots.append(r)
        if not roots:
            label[v] = v
            t_ign[v] = t[v]
            continue
        home = roots[0]                      # nearest earlier neighbour's fire
        for r in roots[1:]:
            a, b = find(home), find(r)
            if a != b and abs(t_ign[a] - t_ign[b]) <= merge_days:
                keep, drop = (a, b) if t_ign[a] <= t_ign[b] else (b, a)
                parent[drop] = keep
                home = keep
        label[v] = find(home)
    roots = np.array([find(l) for l in label])
    _, lab = np.unique(roots, return_inverse=True)
    return lab
