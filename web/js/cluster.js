// Space-time clustering of active-fire detections into fire events.
// Same rule as pipeline/cluster.py (after Cattau et al. 2016): two detections are linked when they are
// within d km AND within T days of each other; events are connected components (single linkage);
// an event's ignition is its earliest detection.

export function project(lon, lat, lon0, lat0) {
  const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180);
  const n = lon.length;
  const x = new Float64Array(n), y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = (lon[i] - lon0) * kx;
    y[i] = (lat[i] - lat0) * 110.57;
  }
  return { x, y };
}

function makeUnionFind(n) {
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (a) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const union = (a, b) => {
    a = find(a); b = find(b);
    if (a !== b) parent[a < b ? b : a] = a < b ? a : b;
  };
  return { find, union };
}

// Returns { label: Int32Array (event id per detection, 0..nEvents-1), nEvents }
export function clusterEvents(x, y, t, d, T) {
  const n = x.length;
  const uf = makeUnionFind(n);
  // spatial hash with cell size d; detections inside each cell are kept in time order
  const K = 100000, OFF = 50000;
  const cells = new Map();
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => t[a] - t[b]);
  for (const i of order) {
    const cx = Math.floor(x[i] / d), cy = Math.floor(y[i] / d);
    const key = (cx + OFF) * K + (cy + OFF);
    let c = cells.get(key);
    if (!c) cells.set(key, (c = { cx, cy, items: [] }));
    c.items.push(i);
  }
  const d2 = d * d;
  for (const c of cells.values()) {
    // visit each unordered pair of neighbouring cells once: itself plus 4 "forward" neighbours
    for (const [ox, oy] of [[0, 0], [1, -1], [1, 0], [1, 1], [0, 1]]) {
      const b = ox === 0 && oy === 0 ? c : cells.get((c.cx + ox + OFF) * K + (c.cy + oy + OFF));
      if (b) linkCells(c.items, b.items, b === c, x, y, t, d2, T, uf);
    }
  }
  const label = new Int32Array(n);
  const remap = new Map();
  // number events in order of their ignition time
  for (const i of order) {
    const r = uf.find(i);
    if (!remap.has(r)) remap.set(r, remap.size);
    label[i] = remap.get(r);
  }
  return { label, nEvents: remap.size };
}

function linkCells(a, b, same, x, y, t, d2, T, uf) {
  // both lists are time-sorted; sweep a moving time window over b
  let start = 0;
  for (let ia = 0; ia < a.length; ia++) {
    const i = a[ia];
    const ti = t[i];
    while (start < b.length && t[b[start]] < ti - T) start++;
    // within one cell, earlier items already linked forward to this one
    for (let jb = same ? Math.max(start, ia + 1) : start; jb < b.length; jb++) {
      const j = b[jb];
      if (t[j] > ti + T) break;
      const dx = x[i] - x[j], dy = y[i] - y[j];
      if (dx * dx + dy * dy <= d2) uf.union(i, j);
    }
  }
}

// Summaries per event: size, ignition index (earliest detection), last time, centroid of final day
export function summarizeEvents(label, nEvents, t, x, y) {
  const size = new Int32Array(nEvents);
  const ign = new Int32Array(nEvents).fill(-1);
  const tEnd = new Float64Array(nEvents).fill(-Infinity);
  for (let i = 0; i < label.length; i++) {
    const e = label[i];
    size[e]++;
    if (ign[e] < 0 || t[i] < t[ign[e]]) ign[e] = i;
    if (t[i] > tEnd[e]) tEnd[e] = t[i];
  }
  // spread vector: ignition -> centroid of the event's final 24 hours of detections
  const sx = new Float64Array(nEvents), sy = new Float64Array(nEvents), sn = new Int32Array(nEvents);
  for (let i = 0; i < label.length; i++) {
    const e = label[i];
    if (t[i] >= tEnd[e] - 1) { sx[e] += x[i]; sy[e] += y[i]; sn[e]++; }
  }
  const events = [];
  for (let e = 0; e < nEvents; e++) {
    events.push({
      id: e, size: size[e], ign: ign[e], t0: t[ign[e]], t1: tEnd[e],
      endX: sx[e] / sn[e], endY: sy[e] / sn[e],
    });
  }
  return events;
}

// Convex hull (monotone chain) of a list of [lon, lat]
export function hull(points) {
  if (points.length < 3) return null;
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  const h = lower.slice(0, -1).concat(upper.slice(0, -1));
  if (h.length < 3) return null;
  h.push(h[0]);
  return h;
}

// Events from an explicit list of links (the learned model's spanning-forest edges that are switched on).
// Numbered by ignition time, like clusterEvents.
export function clusterFromLinks(n, a, b, on, t) {
  const uf = makeUnionFind(n);
  for (let k = 0; k < a.length; k++) if (on[k]) uf.union(a[k], b[k]);
  const order = Array.from({ length: n }, (_, i) => i).sort((p, q) => t[p] - t[q]);
  const label = new Int32Array(n);
  const remap = new Map();
  for (const i of order) {
    const r = uf.find(i);
    if (!remap.has(r)) remap.set(r, remap.size);
    label[i] = remap.get(r);
  }
  return { label, nEvents: remap.size };
}

// Same scoring as the pipeline: a fire (>= 3 detections) is recovered when one event holds >= 90% of
// its detections and >= 90% of that event is that fire. Detections just outside a perimeter (truth -2)
// are ignored. Ignition error uses the event's earliest detection vs. the recorded origin (km).
export function fireMetrics(label, truth, events, x, y, originXY) {
  const size = new Int32Array(events.length);
  for (let i = 0; i < label.length; i++) if (truth[i] !== -2) size[label[i]]++;
  const byFire = new Map();
  for (let i = 0; i < label.length; i++) {
    const f = truth[i];
    if (f < 0) continue;
    let m = byFire.get(f);
    if (!m) byFire.set(f, (m = new Map()));
    m.set(label[i], (m.get(label[i]) || 0) + 1);
  }
  let rec = 0, n = 0;
  const errs = [];
  for (const [f, m] of byFire) {
    let tot = 0, best = -1, bestN = 0;
    for (const [e, c] of m) { tot += c; if (c > bestN) { bestN = c; best = e; } }
    if (tot < 3) continue;
    n++;
    if (bestN / tot >= 0.9 && bestN / size[best] >= 0.9) rec++;
    const o = originXY[f];
    if (o) {
      const i0 = events[best].ign;
      errs.push(Math.hypot(x[i0] - o[0], y[i0] - o[1]));
    }
  }
  errs.sort((p, q) => p - q);
  const med = errs.length ? (errs.length % 2 ? errs[(errs.length - 1) / 2] : (errs[errs.length / 2 - 1] + errs[errs.length / 2]) / 2) : null;
  return { recovered: n ? rec / n : null, nFires: n, nRecovered: rec, ignErr: med };
}
