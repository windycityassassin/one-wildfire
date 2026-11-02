// Live replay: satellite detections arrive one overpass at a time, as they did during the fire.
// Each detection is tracked as spread of a fire already burning, or as a new start (the same
// ignition-aware growth rule tested nationally: join the nearest earlier detection within 4 km and
// 14 days; fires that touch merge only if they started within 4 days of each other).
// New starts close to an active fire are flagged for a person to judge. Any tracked fire can be
// compared with "fires like this one": past fires from other years that behaved similarly early on.
import { project } from "./cluster.js";
import { setData, setVisible, applyView, setSatelliteYear, focusEvent } from "./mapview.js";
import { openInspector, closeInspector, showTip, hideTip } from "./ui.js";
/* global maplibregl */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const SCENARIOS = {
  ncal: { key: "ncal_2020", name: "California lightning siege", start: [7, 15], days: 24, tz: -7, tzName: "PDT",
    blurb: "August 2020: thousands of lightning strikes start hundreds of fires in three days." },
  oregon: { key: "oregon_2020", name: "Oregon Labor Day fires", start: [8, 5], days: 16, tz: -7, tzName: "PDT",
    blurb: "September 2020: a dry east wind turns slow fires into some of Oregon's worst." },
  colorado: { key: "colorado_2020", name: "Colorado, October 2020", start: [9, 8], days: 18, tz: -6, tzName: "MDT",
    blurb: "October 2020: East Troublesome runs about 87,000 acres in a single day." },
};
const LINK_KM = 4, LINK_DAYS = 14, MERGE_DAYS = 4, FLAG_KM = 10, CELL = 5;

let ctx, A = null, S = null, timer = null, popup = null;

export function initReplay(c) {
  ctx = c;
  $("#rp-scenario").addEventListener("change", (e) => load(e.target.value));
  $("#rp-restart").addEventListener("click", () => { stop(); closeInspector(true); closePopup(); reset(); draw(); });
  $("#rp-play").addEventListener("click", () => (timer ? stop() : play()));
  $("#rp-step").addEventListener("click", () => { stop(); step(); draw(); });
  $("#rp-speed").addEventListener("change", () => { if (timer) { stop(); play(); } });
  $("#rp-seek").addEventListener("input", (e) => { stop(); seek(S.t0 + (+e.target.value / 1000) * S.cfg.days); });
  const m = ctx.map;
  m.on("click", (e) => {
    if (ctx.tab() !== "replay" || !S) return;
    const ring = m.queryRenderedFeatures(e.point, { layers: ["ign"] }).find((f) => f.properties.flag);
    if (ring) return flagPopup(ring.properties.i);
    const d = m.queryRenderedFeatures(e.point, { layers: ["dets"] });
    if (d.length && S.fireOf[d[0].properties.i] >= 0) return select(root(S.fireOf[d[0].properties.i]));
  });
  m.on("mousemove", (e) => {
    if (ctx.tab() !== "replay" || !S) return;
    const ring = m.queryRenderedFeatures(e.point, { layers: ["ign"] }).find((f) => f.properties.flag);
    const d = ring ? [] : m.queryRenderedFeatures(e.point, { layers: ["dets"] });
    if (ring) {
      showTip(e.point, `<b>Needs a call</b><br>New fire near a burning one: spot fire or separate start?<br><span class="dim">click to decide</span>`);
    } else if (d.length && S.fireOf[d[0].properties.i] >= 0) {
      const f = S.fires[root(S.fireOf[d[0].properties.i])];
      showTip(e.point, `<b>Fire ${f.no}</b> · ${f.n.toLocaleString()} dots so far<br><span class="dim">first seen ${fmtLocal(f.t0)}</span><br><span class="dim">click to compare with past fires</span>`);
    } else {
      hideTip();
      m.getCanvas().style.cursor = "";
      return;
    }
    m.getCanvas().style.cursor = "pointer";
  });
  document.addEventListener("replay:show", show);
  document.addEventListener("replay:hide", () => { stop(); closePopup(); closeInspector(true); focusEvent(ctx.map, null); ctx.onExit(); });
}

async function show() {
  ctx.onEnter();
  if (!A) A = await (await fetch("data/analogs.json")).json();
  if (!S) { await load($("#rp-scenario").value); if (ctx.tab() === "replay") play(); }
  else { frame(); draw(); }
}

async function load(sc) {
  stop();
  const cfg = SCENARIOS[sc];
  const R = ctx.cache.get(cfg.key) || (await (await fetch(`data/${cfg.key}.json`)).json());
  ctx.cache.set(cfg.key, R);
  const { x, y } = project(R.det.lon, R.det.lat, R.lon0, R.lat0);
  const t0 = dayOfYear(R.year, cfg.start[0], cfg.start[1]);
  // detections inside the scenario window, grouped into overpasses (gaps of 30+ minutes)
  const idx = [];
  for (let i = 0; i < R.det.t.length; i++) if (R.det.t[i] >= t0 - LINK_DAYS && R.det.t[i] < t0 + cfg.days) idx.push(i);
  const passes = [];
  let cur = [];
  for (const i of idx) {
    if (cur.length && R.det.t[i] - R.det.t[cur[cur.length - 1]] > 0.02) { passes.push(cur); cur = []; }
    cur.push(i);
  }
  if (cur.length) passes.push(cur);
  S = { cfg, R, x, y, t0, passes, overrides: new Map() };
  $("#rp-blurb").textContent = cfg.blurb;
  closeInspector(true);
  closePopup();
  histogram();
  reset();
  frame();
  draw();
}

function dayOfYear(year, month, day) {
  return (Date.UTC(year, month, day) - Date.UTC(year, 0, 1)) / 86400000;
}

function frame() {
  const R = S.R;
  let w = 180, s = 90, e = -180, n = -90;
  for (const pass of S.passes) for (const i of pass) {
    w = Math.min(w, R.det.lon[i]); e = Math.max(e, R.det.lon[i]); s = Math.min(s, R.det.lat[i]); n = Math.max(n, R.det.lat[i]);
  }
  setSatelliteYear(ctx.map, R.year);
  applyView(ctx.map, "sat3d", { keepCamera: true });
  ctx.map.fitBounds([[w, s], [e, n]], { padding: 50, duration: 0, pitch: 40, bearing: 0 });
}

// ---------- tracking ----------
function reset() {
  const n = S.R.det.t.length;
  S.fireOf = new Int32Array(n).fill(-1);
  S.parent = [];
  S.fires = [];
  S.grid = new Map();
  S.pass = 0;
  S.now = S.passes.length ? S.R.det.t[S.passes[0][0]] : S.t0;
  S.flags = [];
  S.newStarts = [];
  S.lastPass = [];
  S.selected = null;
  // detections in the two weeks before the window are processed silently, so fires already burning are known
  while (S.pass < S.passes.length && S.R.det.t[S.passes[S.pass][0]] < S.t0) step(true);
  S.flags = [];
  S.newStarts = [];
  S.lastPass = [];
  S.passStats = null;
  S.now = Math.max(S.now, S.t0);
}

// jump to any time: forward by stepping, backward by replaying from the start
function seek(t) {
  const sel = S.selected, rev = S.revealed;
  if (t < S.now) { reset(); S.selected = sel; S.revealed = rev; }
  stepUntil(t);
  draw();
}

// detections per 6 hours across the scenario window, drawn behind the time slider
function histogram() {
  const bins = new Array(S.cfg.days * 4).fill(0);
  for (const pass of S.passes) for (const i of pass) {
    const k = Math.floor((S.R.det.t[i] - S.t0) * 4);
    if (k >= 0 && k < bins.length) bins[k]++;
  }
  S.bins = bins;
  $("#rp-t0").textContent = fmtLocal(S.t0).replace(/, .*/, "");
  $("#rp-t1").textContent = fmtLocal(S.t0 + S.cfg.days).replace(/, .*/, "");
}

function drawHistogram() {
  const bins = S.bins, n = bins.length;
  const max = Math.max(1, ...bins.map((v) => Math.sqrt(v)));
  const at = Math.floor((S.now - S.t0) * 4);
  const w = 100 / n;
  $("#rp-hist").innerHTML = `<svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">${bins.map((v, k) =>
    `<rect x="${k * w + w * 0.1}" y="${30 - (Math.sqrt(v) / max) * 28}" width="${w * 0.8}" height="${(Math.sqrt(v) / max) * 28}" style="fill:${k <= at ? "var(--fire)" : "var(--line)"}"/>`).join("")}</svg>`;
  $("#rp-seek").value = Math.round(((S.now - S.t0) / S.cfg.days) * 1000);
}

function root(f) {
  while (S.parent[f] !== f) { S.parent[f] = S.parent[S.parent[f]]; f = S.parent[f]; }
  return f;
}

function neighbours(i, radius) {
  const { x, y } = S;
  const cx = Math.floor(x[i] / CELL), cy = Math.floor(y[i] / CELL);
  const r = Math.ceil(radius / CELL);
  const out = [];
  for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
    const list = S.grid.get((cx + dx) * 100003 + (cy + dy));
    if (!list) continue;
    for (const j of list) {
      const d = Math.hypot(x[i] - x[j], y[i] - y[j]);
      if (d <= radius) out.push([j, d]);
    }
  }
  return out;
}

function step(silent = false) {
  if (S.pass >= S.passes.length) return false;
  const R = S.R;
  const pass = S.passes[S.pass++];
  const flags = [], starts = [];
  for (const i of pass) {
    const ti = R.det.t[i];
    const near = neighbours(i, FLAG_KM).filter(([j]) => ti - R.det.t[j] <= LINK_DAYS);
    const links = near.filter(([, d]) => d <= LINK_KM).sort((a, b) => a[1] - b[1]);
    let f;
    const ov = S.overrides.get(i);
    if (links.length) {
      f = root(S.fireOf[links[0][0]]);
      for (const [j] of links.slice(1)) {
        const g = root(S.fireOf[j]);
        if (g !== f && Math.abs(S.fires[g].t0 - S.fires[f].t0) <= MERGE_DAYS) {
          const [keep, drop] = S.fires[f].t0 <= S.fires[g].t0 ? [f, g] : [g, f];
          S.parent[drop] = keep;
          S.fires[keep].n += S.fires[drop].n;
          f = keep;
        }
      }
    } else if (ov && ov.join != null) {
      f = root(ov.join);                                 // a person said: part of that fire
    } else {
      f = S.fires.length;
      S.parent.push(f);
      S.fires.push({ id: f, no: f + 1, t0: ti, first: i, n: 0 });
      starts.push(i);
      // a new start within 10 km of a fire seen in the last 3 days: spot fire, or a separate ignition?
      const active = near.filter(([j]) => ti - R.det.t[j] <= 3).sort((a, b) => a[1] - b[1]);
      if (active.length && !ov) flags.push({ i, fire: root(S.fireOf[active[0][0]]), km: active[0][1] });
    }
    S.fireOf[i] = f;
    S.fires[root(f)].n++;
    S.fires[root(f)].last = ti;
    const key = Math.floor(S.x[i] / CELL) * 100003 + Math.floor(S.y[i] / CELL);
    let cell = S.grid.get(key);
    if (!cell) S.grid.set(key, (cell = []));
    cell.push(i);
  }
  S.now = R.det.t[pass[pass.length - 1]];
  S.lastPass = pass;
  if (!silent) {
    S.newStarts.push(...starts);
    S.flags.push(...flags);
    S.passStats = { n: pass.length, starts: starts.length, flags: flags.length };
  }
  return true;
}

function stepUntil(t) {
  while (S.pass < S.passes.length && S.R.det.t[S.passes[S.pass][0]] <= t) step();
  S.now = Math.max(S.now, Math.min(t, S.t0 + S.cfg.days));
}

function play() {
  const ms = { "1": 700, "4": 180, "12": 60 }[$("#rp-speed").value];
  timer = setInterval(() => {
    if (!step()) return stop();
    draw();
  }, ms);
  $("#rp-play").textContent = "Pause";
}
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  const b = $("#rp-play");
  if (b) b.textContent = "Play";
}

// ---------- drawing ----------
function draw() {
  if (!S) return;
  const { R } = S;
  const lastSet = new Set(S.lastPass);
  const feats = [];
  for (const pass of S.passes.slice(0, S.pass)) for (const i of pass) {
    const f = root(S.fireOf[i]);
    const recent = lastSet.has(i);
    const age = S.now - R.det.t[i];
    feats.push({ type: "Feature", properties: {
      i, col: recent ? "#fff1b0" : age < 1 ? "#ff7d00" : age < 3 ? "#e0360a" : "#7a1c0e", r: recent ? 1.6 : 1,
      a: recent ? 1 : age > 3 ? 0.7 : 0.9, t: R.det.t[i], ev: f,
    }, geometry: { type: "Point", coordinates: [R.det.lon[i], R.det.lat[i]] } });
  }
  setData(ctx.map, "dets", { type: "FeatureCollection", features: feats });
  const openFlags = new Set(S.flags.filter((fl) => !S.overrides.has(fl.i)).map((fl) => fl.i));
  const rings = S.newStarts.filter((i) => S.now - R.det.t[i] <= 1 || openFlags.has(i)).map((i) => ({
    type: "Feature", properties: { col: openFlags.has(i) ? "#d4a017" : "#e4572e", t0: R.det.t[i], i, flag: openFlags.has(i), ev: root(S.fireOf[i]) },
    geometry: { type: "Point", coordinates: [R.det.lon[i], R.det.lat[i]] },
  }));
  setData(ctx.map, "ign", { type: "FeatureCollection", features: rings });
  setVisible(ctx.map, ["dets", "ign"], true);
  setVisible(ctx.map, ["hulls-fill", "hulls-line", "arrows", "arrowheads", "perims-fill", "perims-line", "origins", "cube", "links-on", "links-off", "links-hit", "focus-line"], false);
  focusEvent(ctx.map, S.selected != null ? root(S.selected) : null);
  if (S.revealed && S.selected != null) showOfficial();
  panel();
}

function fmtLocal(t) {
  const d = new Date(Date.UTC(S.R.year, 0, 1) + (t * 24 + S.cfg.tz) * 3600000);
  const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${day}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} ${S.cfg.tzName}`;
}

function activeFires() {
  const roots = new Set();
  for (const f of S.fires) roots.add(root(f.id));
  return [...roots].map((f) => S.fires[f]).filter((f) => S.now - f.last <= 1 && f.n >= 3);
}

function panel() {
  const R = S.R;
  $("#rp-clock").textContent = fmtLocal(S.now);
  drawHistogram();
  const ps = S.passStats;
  const active = activeFires();
  const open = S.flags.filter((fl) => !S.overrides.has(fl.i));
  $("#rp-readout").innerHTML = `
    <div><b>${ps ? ps.n : 0}</b><small>dots this pass</small></div>
    <div><b>${active.length}</b><small>active fires</small></div>
    <div><b>${S.newStarts.length}</b><small>new fires so far</small></div>
    <div class="flagged"><b>${open.length}</b><small>need a call</small></div>`;
  $("#rp-flag-count").textContent = open.length;

  // flags for a person to judge, newest first
  const shown = open.slice(-3).reverse();
  $("#rp-flags").innerHTML = shown.length ? shown.map((fl) => {
    const no = S.fires[root(fl.fire)].no;
    return `<div class="flag-item" data-i="${fl.i}">
      <span class="where" title="Show it on the map">New fire <b>${fl.km.toFixed(1)} km</b> from Fire ${no} · ${fmtLocal(R.det.t[fl.i])}</span>
      <span class="presets"><button class="btn" data-act="sep">Separate start</button><button class="btn" data-act="join">Spot fire of Fire ${no}</button></span>
    </div>`;
  }).join("") + (open.length > 3 ? `<p class="note">${open.length - 3} more on the map (yellow rings).</p>` : "")
    : `<p class="note">Nothing to judge yet.</p>`;
  $$("#rp-flags .flag-item").forEach((el) => {
    const i = +el.dataset.i;
    el.querySelector(".where").addEventListener("click", () => flagPopup(i, true));
    el.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => decide(i, b.dataset.act)));
  });

  // biggest active fires
  const top = active.sort((a, b) => b.n - a.n).slice(0, 6);
  const sel = S.selected != null ? root(S.selected) : null;
  $("#rp-fires").innerHTML = top.length ? top.map((f) => `
    <div class="row-item clickable ${f.id === sel ? "sel" : ""}" data-f="${f.id}">
      <span><b>Fire ${f.no}</b> · since ${fmtLocal(f.t0).replace(/ [A-Z]{3}$/, "")}</span>
      <span class="mono">${f.n.toLocaleString()} dots</span>
    </div>`).join("") : `<p class="note">No active fires yet.</p>`;
  $$("#rp-fires .row-item").forEach((el) => el.addEventListener("click", () => select(+el.dataset.f)));
  if (sel != null) analog(sel);
}

function closePopup() {
  if (popup) popup.remove();
  popup = null;
}

// ask the question on the map, at the new fire
function flagPopup(i, fly = false) {
  const fl = S.flags.find((q) => q.i === i);
  if (!fl || S.overrides.has(i)) return;
  const R = S.R;
  const no = S.fires[root(fl.fire)].no;
  closePopup();
  const el = document.createElement("div");
  el.style.display = "grid";
  el.style.gap = "8px";
  el.style.maxWidth = "230px";
  el.innerHTML = `<b>New fire, ${fl.km.toFixed(1)} km from Fire ${no}</b>
    <span class="note">First seen ${fmtLocal(R.det.t[i])}. Is it a spot fire thrown ahead of Fire ${no}, or a separate start?</span>
    <span class="presets"><button class="btn" data-act="sep">Separate start</button><button class="btn primary" data-act="join">Spot fire of ${no}</button></span>`;
  el.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { closePopup(); decide(i, b.dataset.act); }));
  popup = new maplibregl.Popup({ closeButton: true, maxWidth: "260px", offset: 10 }).setLngLat([R.det.lon[i], R.det.lat[i]]).setDOMContent(el).addTo(ctx.map);
  if (fly) ctx.map.flyTo({ center: [R.det.lon[i], R.det.lat[i]], zoom: Math.max(ctx.map.getZoom(), 9.5), duration: 800 });
}

function decide(i, act) {
  const fl = S.flags.find((q) => q.i === i);
  S.overrides.set(i, act === "join" ? { join: fl.fire } : { separate: true });
  // re-run the replay up to now with the decision applied
  const upto = S.pass, sel = S.selected, rev = S.revealed;
  reset();
  while (S.pass < upto) step();
  S.selected = sel;
  S.revealed = rev;
  draw();
}

function select(f) {
  if (S.selected != null && root(S.selected) === root(f) && !$("#inspector").hidden) return;
  S.selected = f;
  S.revealed = false;
  const fire = S.fires[root(f)];
  const i = fire.first;
  ctx.map.flyTo({ center: [S.R.det.lon[i], S.R.det.lat[i]], zoom: Math.max(ctx.map.getZoom(), 8.5), duration: 800 });
  draw();
}

// ---------- fires like this one ----------
function fireMembers(f) {
  const out = [];
  for (const pass of S.passes.slice(0, S.pass)) for (const i of pass) if (S.fireOf[i] >= 0 && root(S.fireOf[i]) === f) out.push(i);
  return out;
}

function features(members, h) {
  const R = S.R;
  const t0 = Math.min(...members.map((i) => R.det.t[i]));
  const m = members.filter((i) => R.det.t[i] <= t0 + h);
  const xs = m.map((i) => S.x[i]), ys = m.map((i) => S.y[i]);
  const ext = m.length > 1 ? Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) : 0;
  const frp = m.reduce((a, i) => a + R.det.frp[i], 0);
  const night = m.reduce((a, i) => a + R.det.night[i], 0) / m.length;
  const late = m.filter((i) => R.det.t[i] > t0 + h / 2).length / m.length;
  const doy = Math.floor(t0) + 1;
  const first = members.reduce((a, i) => (R.det.t[i] < R.det.t[a] ? i : a), members[0]);
  return [Math.log1p(m.length), Math.log1p(ext), Math.log1p(frp), night, late,
    Math.sin((2 * Math.PI * doy) / 365.25), Math.cos((2 * Math.PI * doy) / 365.25), R.det.lat[first], R.det.lon[first]];
}

const quant = (arr, q) => {
  const a = arr.slice().sort((p, r) => p - r);
  const k = (a.length - 1) * q, lo = Math.floor(k), hi = Math.ceil(k);
  return a[lo] + (a[hi] - a[lo]) * (k - lo);
};
const fmtAcres = (a) => (a >= 10000 ? Math.round(a / 1000) + "k" : a >= 1000 ? (a / 1000).toFixed(1) + "k" : String(Math.round(a)));

function analog(f) {
  const fire = S.fires[f];
  const members = fireMembers(f);
  const age = S.now - fire.t0;
  const h = [...A.horizons].reverse().find((q) => q <= age) ?? A.horizons[0];
  const key = `${S.overrides.size}|${f}|${h}|${S.revealed}|${age < 3 ? members.length : "settled"}`;
  if (key === S.analogKey && !$("#inspector").hidden) return;
  S.analogKey = key;
  const sc = A.scale[h.toFixed(1)];
  const q = features(members, h).map((v, k) => ((v - sc.mean[k]) / sc.std[k]) * A.weights[k]);
  const pool = A.library.filter((L) => L.year !== S.R.year);         // never peek at the same year
  const scored = pool.map((L) => {
    const z = L.feats[h.toFixed(1)].map((v, k) => ((v - sc.mean[k]) / sc.std[k]) * A.weights[k]);
    return [L, Math.hypot(...z.map((v, k) => v - q[k]))];
  }).sort((a, b) => a[1] - b[1]).slice(0, A.k);
  const acres = scored.map(([L]) => L.acres);
  const cont = scored.map(([L]) => L.contain_days).filter((v) => v != null);
  const skill = A.skill[h.toFixed(1)];
  const hoursLabel = age < h ? `first ${Math.max(1, Math.round(age * 24))} hours` : `first ${Math.round(h * 24)} hours`;
  const truth = officialRows(members, fire);
  // where the analogs ended up, on a log acres scale from 100 to 1 million
  const X = (a) => `${Math.max(0, Math.min(100, ((Math.log10(Math.max(a, 100)) - 2) / 4) * 100))}%`;
  const truthAcres = S.revealed && truth.length ? truth[0].p.acres : null;
  const range = `
    <div class="range" aria-hidden="true">
      <div class="track"></div>
      <div class="iqr" style="left:${X(quant(acres, 0.25))};width:calc(${X(quant(acres, 0.75))} - ${X(quant(acres, 0.25))})"></div>
      ${acres.map((a) => `<div class="dot" style="left:${X(a)}"></div>`).join("")}
      <div class="med" style="left:${X(quant(acres, 0.5))}"></div>
      ${truthAcres ? `<div class="truth" style="left:${X(truthAcres)}">▼</div>` : ""}
    </div>
    <div class="range-ends"><span>100 ac</span><span>1k</span><span>10k</span><span>100k</span><span>1M ac</span></div>`;
  const body = openInspector({
    eyebrow: `Fire ${fire.no} · first seen ${fmtLocal(fire.t0)}`,
    title: `Fires like this one`,
    body: `
      <p class="note">The ${A.k} past US fires (other years) whose ${hoursLabel} from orbit looked most like Fire ${fire.no}'s:</p>
      <div class="readout">
        <div><small>They grew to</small><b>${fmtAcres(quant(acres, 0.5))} ac</b><small>middle half ${fmtAcres(quant(acres, 0.25))}–${fmtAcres(quant(acres, 0.75))}</small></div>
        <div><small>Contained after</small><b>${cont.length ? Math.round(quant(cont, 0.5)) + " days" : "n/a"}</b><small>${cont.length ? `middle half ${Math.round(quant(cont, 0.25))}–${Math.round(quant(cont, 0.75))}` : ""}</small></div>
      </div>
      ${range}
      <div class="rows">${scored.slice(0, 5).map(([L]) => `
        <div class="row-item"><span><b>${L.name}</b> · ${L.state} ${L.year}</span>
        <span class="mono">${fmtAcres(L.acres)} ac${L.contain_days != null ? " · " + Math.round(L.contain_days) + " d" : ""}</span>
        ${L.fuel ? `<small>${L.fuel.toLowerCase()}${L.cause ? " · " + L.cause.toLowerCase() : ""}</small>` : ""}</div>`).join("")}</div>
      <p class="note">Tested on 1,421 past fires: at this stage the analogs rank final size with a correlation of ${skill.rho_acres.toFixed(2)} and are typically off by ×${skill.median_factor_error} (×${skill.median_factor_error_baseline} guessing a typical fire). Context, not a forecast; no wind or weather yet.</p>
      ${truth.length ? `<button class="btn ${S.revealed ? "" : "primary"}" id="rp-reveal">${S.revealed ? "Hide" : "Show"} what actually happened</button>${S.revealed ? `<div class="rows">${truth.map((r) => r.html).join("")}</div>` : ""}`
        : `<p class="note">No official perimeter covers this fire in the interagency record. That record started in 2020 and misses some fires, including most of the LNU and North complexes.</p>`}`,
    close: () => { S.selected = null; S.revealed = false; S.analogKey = null; draw(); },
  });
  const b = body.querySelector("#rp-reveal");
  if (b) b.addEventListener("click", () => {
    S.revealed = !S.revealed;
    if (!S.revealed) setVisible(ctx.map, ["perims-fill", "perims-line"], false);
    draw();
  });
}

function officialRows(members, fire) {
  const R = S.R;
  const count = new Map();
  for (const i of members) { const k = R.det.truth[i]; if (k >= 0) count.set(k, (count.get(k) || 0) + 1); }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => {
    const p = R.perimeters.features[k].properties;
    const lag = (fire.t0 - p.disc) * 24;
    return { p, html: `<div class="row-item"><span><b>${p.name}</b>${p.complex ? " (" + p.complex + ")" : ""}</span>
      <span class="mono">${fmtAcres(p.acres)} ac${p.contain_days != null ? " · " + Math.round(p.contain_days) + " d" : ""}</span>
      <small>${p.cause} · ${n} of this fire's dots · satellite first saw it ${lag >= 0 ? Math.round(lag) + " h after" : Math.round(-lag) + " h before"} it was reported</small></div>` };
  });
}

function showOfficial() {
  const R = S.R;
  const members = new Set(fireMembers(root(S.selected)));
  const ks = new Set();
  for (const i of members) if (R.det.truth[i] >= 0) ks.add(R.det.truth[i]);
  setData(ctx.map, "perims", { type: "FeatureCollection", features: R.perimeters.features.filter((f) => ks.has(f.properties.id)) });
  setVisible(ctx.map, ["perims-fill", "perims-line"], true);
}
