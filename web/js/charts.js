// Small SVG charts drawn with theme tokens, so they read in light and dark.

const NS = "http://www.w3.org/2000/svg";

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

function svg(container, w, h, label) {
  container.innerHTML = "";
  const s = el("svg", { viewBox: `0 0 ${w} ${h}`, role: "img", "aria-label": label });
  container.appendChild(s);
  return s;
}

// Grid heatmap. values[i][j] for row i (d) and column j (T), already in 0..1 for shading.
// labels[i][j] are the strings printed in each cell. marks: [{i, j, kind: 'outline'|'dot'|'ring'|'current', title}]
// onPick(i, j) makes cells clickable; onHover(i, j | null) reports the cell under the pointer.
export function heatmap(container, { rows, cols, values, labels, marks = [], rowTitle, colTitle, label, onPick, onHover }) {
  const cw = 34, ch = 22, left = 44, top = 30, bottom = 6;
  const w = left + cols.length * cw + 6, h = top + rows.length * ch + bottom;
  const s = svg(container, w, h, label);
  el("text", { x: left + (cols.length * cw) / 2, y: 10, "text-anchor": "middle", class: "title" }, s).textContent = colTitle;
  cols.forEach((c, j) => {
    el("text", { x: left + j * cw + cw / 2, y: top - 6, "text-anchor": "middle" }, s).textContent = c;
  });
  el("text", { x: 4, y: 10, class: "title" }, s).textContent = rowTitle;
  rows.forEach((r, i) => {
    el("text", { x: left - 6, y: top + i * ch + ch / 2 + 3.5, "text-anchor": "end" }, s).textContent = r;
    cols.forEach((_, j) => {
      const v = values[i][j];
      const cell = el("rect", {
        x: left + j * cw + 1, y: top + i * ch + 1, width: cw - 2, height: ch - 2, rx: 2,
        style: `fill: var(--accent); fill-opacity: ${v == null || isNaN(v) ? 0.04 : 0.08 + 0.82 * v}`,
      }, s);
      if (onPick) {
        cell.classList.add("pick");
        cell.addEventListener("click", () => onPick(i, j));
        if (onHover) {
          cell.addEventListener("mouseenter", () => onHover(i, j));
          cell.addEventListener("mouseleave", () => onHover(null));
        }
      }
      const txt = el("text", {
        x: left + j * cw + cw / 2, y: top + i * ch + ch / 2 + 3, "text-anchor": "middle", class: "cellv",
        style: (v > 0.55 ? "fill: var(--panel);" : "") + (onPick ? "pointer-events: none" : ""),
      }, s);
      txt.textContent = labels[i][j];
    });
  });
  for (const m of marks) {
    const x = left + m.j * cw, y = top + m.i * ch;
    let shape;
    if (m.kind === "current") {
      shape = el("rect", { x: x - 0.5, y: y - 0.5, width: cw + 1, height: ch + 1, rx: 4, style: "fill: none; stroke: var(--fire); stroke-width: 2.6; pointer-events: none" }, s);
    } else if (m.kind === "outline") {
      shape = el("rect", { x: x + 1.5, y: y + 1.5, width: cw - 3, height: ch - 3, rx: 2, style: "fill: none; stroke: var(--ink); stroke-width: 1.4; stroke-dasharray: 3 2; pointer-events: none" }, s);
    } else if (m.kind === "dot") {
      shape = el("circle", { cx: x + cw - 5, cy: y + 5, r: 3.2, style: "fill: var(--warn); stroke: var(--panel); stroke-width: 1; pointer-events: none" }, s);
    } else {
      shape = el("circle", { cx: x + 5, cy: y + 5, r: 3, style: "fill: var(--panel); stroke: var(--ink); stroke-width: 1.3; pointer-events: none" }, s);
    }
    if (m.title) el("title", {}, shape).textContent = m.title;
  }
  return s;
}

export function heatLegend(items) {
  // items: [{kind, text}] rendered as inline HTML
  const sw = {
    outline: `<svg width="14" height="12" aria-hidden="true"><rect x="1" y="1" width="12" height="10" rx="2" style="fill:none;stroke:var(--ink);stroke-width:1.4;stroke-dasharray:3 2"/></svg>`,
    current: `<svg width="14" height="12" aria-hidden="true"><rect x="1" y="1" width="12" height="10" rx="2" style="fill:none;stroke:var(--fire);stroke-width:2.2"/></svg>`,
    dot: `<svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="3.5" style="fill:var(--warn)"/></svg>`,
    ring: `<svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="3.3" style="fill:var(--panel);stroke:var(--ink);stroke-width:1.3"/></svg>`,
  };
  return `<div style="display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--muted)">${items
    .map((it) => `<span style="display:inline-flex;align-items:center;gap:5px">${sw[it.kind]}${it.text}</span>`)
    .join("")}</div>`;
}

// Dot plot: one row per region, x = 0..100 %. series: [{key, kind, label}] ; rows: [{name, values:{key: pct}}]
export function dotplot(container, { rows, series, label }) {
  const left = 118, right = 14, top = 22, rh = 24;
  const w = 340, h = top + rows.length * rh + 22;
  const s = svg(container, w, h, label);
  const X = (v) => left + ((w - left - right) * v) / 100;
  for (const g of [0, 25, 50, 75, 100]) {
    el("line", { x1: X(g), x2: X(g), y1: top - 4, y2: h - 18, style: "stroke: var(--line); stroke-width: 1" }, s);
    el("text", { x: X(g), y: h - 6, "text-anchor": "middle" }, s).textContent = g + "%";
  }
  rows.forEach((r, i) => {
    const y = top + i * rh + rh / 2;
    el("text", { x: left - 8, y: y + 3.5, "text-anchor": "end", style: "fill: var(--ink); font: 11px var(--f-body)" }, s).textContent = r.name;
    const vals = series.map((sr) => r.values[sr.key]).filter((v) => v != null);
    if (vals.length) {
      el("line", { x1: X(Math.min(...vals)), x2: X(Math.max(...vals)), y1: y, y2: y, style: "stroke: var(--muted); stroke-width: 2; stroke-opacity: .45" }, s);
    }
    for (const sr of series) {
      const v = r.values[sr.key];
      if (v == null) continue;
      let shape;
      if (sr.kind === "dot") shape = el("circle", { cx: X(v), cy: y, r: 5, style: "fill: var(--warn); stroke: var(--panel); stroke-width: 1.2" }, s);
      else if (sr.kind === "ring") shape = el("circle", { cx: X(v), cy: y, r: 4.5, style: "fill: var(--panel); stroke: var(--ink); stroke-width: 1.5" }, s);
      else if (sr.kind === "diamond") shape = el("path", { d: `M${X(v)},${y - 5.5} L${X(v) + 5},${y} L${X(v)},${y + 5.5} L${X(v) - 5},${y} Z`, style: "fill: var(--truth)" }, s);
      else if (sr.kind === "tri") shape = el("path", { d: `M${X(v)},${y - 5.5} L${X(v) + 5.5},${y + 4.5} L${X(v) - 5.5},${y + 4.5} Z`, style: "fill: none; stroke: var(--muted); stroke-width: 1.4" }, s);
      else shape = el("rect", { x: X(v) - 4.5, y: y - 4.5, width: 9, height: 9, style: "fill: var(--accent)" }, s);
      el("title", {}, shape).textContent = `${r.name}: ${sr.label} ${v.toFixed(0)}%`;
    }
  });
  el("text", { x: left, y: 11, class: "title" }, s).textContent = label.startsWith("Fires") ? "Fires recovered" : "";
  return s;
}

export function dotLegend(series) {
  const sw = {
    dot: `<svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" style="fill:var(--warn)"/></svg>`,
    ring: `<svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="3.5" style="fill:var(--panel);stroke:var(--ink);stroke-width:1.4"/></svg>`,
    square: `<svg width="10" height="10" aria-hidden="true"><rect x="1" y="1" width="8" height="8" style="fill:var(--accent)"/></svg>`,
    diamond: `<svg width="11" height="11" aria-hidden="true"><path d="M5.5,0.5 L10.5,5.5 L5.5,10.5 L0.5,5.5 Z" style="fill:var(--truth)"/></svg>`,
    tri: `<svg width="12" height="11" aria-hidden="true"><path d="M6,1 L11,10 L1,10 Z" style="fill:none;stroke:var(--muted);stroke-width:1.3"/></svg>`,
  };
  return `<div style="display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--muted)">${series
    .map((s) => `<span style="display:inline-flex;align-items:center;gap:5px">${sw[s.kind]}${s.label}</span>`)
    .join("")}</div>`;
}

// Horizontal bars with a count label: rows [{name, value (0..1) | null, text}]
export function bars(container, { rows, label }) {
  const left = Math.max(100, Math.max(...rows.map((r) => r.name.length)) * 6.1 + 12), right = 54, rh = 26, top = 6;
  const w = 340, h = top + rows.length * rh + 4;
  const s = svg(container, w, h, label);
  const W = w - left - right;
  rows.forEach((r, i) => {
    const y = top + i * rh;
    el("text", { x: left - 8, y: y + rh / 2 + 3.5, "text-anchor": "end", style: "fill: var(--ink); font: 11.5px var(--f-body)" }, s).textContent = r.name;
    el("rect", { x: left, y: y + 5, width: W, height: rh - 10, rx: 3, style: "fill: var(--chip)" }, s);
    if (r.value != null) el("rect", { x: left, y: y + 5, width: Math.max(2, W * r.value), height: rh - 10, rx: 3, style: "fill: var(--accent)" }, s);
    el("text", { x: left + W + 6, y: y + rh / 2 + 3.5 }, s).textContent = r.text;
  });
  return s;
}

// Lines over categorical x positions. series: [{name, values (0..1), style: 'accent'|'warn'|'muted', dash}]
export function lines(container, { xLabels, series, yMin = 0.7, yMax = 0.95, label, xTitle }) {
  const left = 40, right = 92, top = 10, bottom = 34;
  const w = 340, h = 200;
  const s = svg(container, w, h, label);
  const X = (k) => left + ((w - left - right) * k) / (xLabels.length - 1);
  const Y = (v) => top + (h - top - bottom) * (1 - (v - yMin) / (yMax - yMin));
  for (let g = Math.ceil(yMin * 20) / 20; g <= yMax + 1e-9; g += 0.05) {
    el("line", { x1: left, x2: w - right, y1: Y(g), y2: Y(g), style: "stroke: var(--line); stroke-width: 1" }, s);
    el("text", { x: left - 6, y: Y(g) + 3.5, "text-anchor": "end" }, s).textContent = Math.round(g * 100) + "%";
  }
  xLabels.forEach((t, k) => { el("text", { x: X(k), y: h - bottom + 14, "text-anchor": "middle" }, s).textContent = t; });
  if (xTitle) el("text", { x: left + (w - left - right) / 2, y: h - 4, "text-anchor": "middle" }, s).textContent = xTitle;
  const ends = [];
  for (const sr of series) {
    const col = `var(--${sr.style})`;
    el("polyline", {
      points: sr.values.map((v, k) => `${X(k)},${Y(v)}`).join(" "),
      style: `fill: none; stroke: ${col}; stroke-width: 2; ${sr.dash ? "stroke-dasharray: 4 3;" : ""}`,
    }, s);
    sr.values.forEach((v, k) => {
      const c = el("circle", { cx: X(k), cy: Y(v), r: 2.8, style: `fill: ${col}` }, s);
      el("title", {}, c).textContent = `${sr.name}, ${xLabels[k]} reviewed: ${(v * 100).toFixed(1)}%`;
    });
    ends.push({ y: Y(sr.values[sr.values.length - 1]), sr, col });
  }
  // end labels, nudged apart so they don't overlap
  ends.sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 12) ends[k].y = ends[k - 1].y + 12;
  for (const e of ends) {
    el("text", { x: w - right + 6, y: e.y + 3.5, style: `fill: ${e.col}; font: 600 10.5px var(--f-body)` }, s).textContent = e.sr.name;
  }
  return s;
}

// Grouped monthly bars: series [{name, values[12], style: 'warn'|'truth'|'accent'}]
export function monthBars(container, { series, label }) {
  const left = 36, right = 8, top = 26, bottom = 22;
  const w = 640, h = 220;
  const s = svg(container, w, h, label);
  const max = Math.max(...series.flatMap((q) => q.values));
  const step = max > 400 ? 200 : max > 150 ? 50 : 25;
  const Y = (v) => top + (h - top - bottom) * (1 - v / (Math.ceil(max / step) * step));
  for (let g = 0; g <= Math.ceil(max / step) * step; g += step) {
    el("line", { x1: left, x2: w - right, y1: Y(g), y2: Y(g), style: "stroke: var(--line); stroke-width: 1" }, s);
    el("text", { x: left - 6, y: Y(g) + 3.5, "text-anchor": "end" }, s).textContent = g;
  }
  const gw = (w - left - right) / 12, bw = (gw * 0.8) / series.length;
  "JFMAMJJASOND".split("").forEach((m, k) => {
    el("text", { x: left + gw * k + gw / 2, y: h - 6, "text-anchor": "middle" }, s).textContent = m;
    series.forEach((sr, j) => {
      const v = sr.values[k];
      const r = el("rect", { x: left + gw * k + gw * 0.1 + j * bw, y: Y(v), width: bw - 1, height: Y(0) - Y(v), style: `fill: var(--${sr.style})` }, s);
      el("title", {}, r).textContent = `${sr.name}, ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][k]}: ${v} fires`;
    });
  });
  series.forEach((sr, j) => {
    el("rect", { x: left + 6 + j * 170, y: 6, width: 10, height: 10, style: `fill: var(--${sr.style})` }, s);
    el("text", { x: left + 22 + j * 170, y: 15, style: "fill: var(--ink); font: 11px var(--f-body)" }, s).textContent = sr.name;
  });
  return s;
}
