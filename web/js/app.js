import { project, clusterEvents, fireMetrics, summarizeEvents, hull } from "./cluster.js";
import { createMap, applyView, setData, setVisible, setSatelliteYear, cubeFeatures, focusEvent, EVENT_COLORS, DATE_RAMP, rampColor } from "./mapview.js";
import { heatmap, heatLegend, dotplot, dotLegend, lines } from "./charts.js";
import { initStudy } from "./study.js";
import { initReplay } from "./replay.js";
import { initStories } from "./stories.js";
import { initUI, openInspector, closeInspector, showTip, hideTip } from "./ui.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const fc = (features) => ({ type: "FeatureCollection", features });
const TABS = ["explore", "result", "stories", "replay", "results", "study"];
const INTRO_KEY = "spdf-intro-seen-v2";

const state = {
  meta: null, national: null, key: null, R: null, x: null, y: null, t: null,
  di: 2, ti: 4, colorBy: "event", view: "sat3d", tab: "stories",
  label: null, events: null, tmax: 366, playing: null, cache: new Map(),
  selected: null, selectedDet: null, hover: null, hoverPerim: null,
};

const map = await createMap("map").catch((err) => { failed(err); throw err; });
const ready = new Promise((res) => (map.loaded() ? res() : map.on("load", res)));

// ---------- formatting ----------
export function dayToDate(year, day) {
  return new Date(Date.UTC(year, 0, 1) + day * 86400000);
}
export function fmtDate(year, day, withTime = false) {
  const d = dayToDate(year, day);
  const s = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  if (!withTime) return s;
  return `${s}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}
const pct = (v) => (v == null ? "n/a" : `${Math.round(v * 100)}%`);
const fmtD = (d) => `${d} km`;
const fmtT = (T) => (T < 1 ? `${T * 24} hours` : `${T} ${T === 1 ? "day" : "days"}`);
const fmtSpan = (days) => (days < 1 ? `${Math.max(1, Math.round(days * 24))} hours` : `${days.toFixed(days < 10 ? 1 : 0)} days`);
const fmtAcres = (a) => Math.round(a).toLocaleString() + " acres";

// ---------- boot ----------
async function boot() {
  initUI();
  const [meta, national] = await Promise.all([
    fetch("data/regions.json").then((r) => r.json()),
    fetch("data/national.json").then((r) => r.json()).catch(() => null),
  ]);
  state.meta = meta;
  state.national = national;
  const sel = $("#region");
  for (const r of meta.regions) {
    const o = document.createElement("option");
    o.value = r.key;
    o.textContent = `${r.name}, ${r.year}${r.truth ? "" : " · no official maps"}`;
    sel.appendChild(o);
  }
  buildTicks();
  wireControls();
  await ready;
  const h = location.hash.slice(1);
  const start = meta.regions.some((r) => r.key === h) ? h : "colorado_2020";
  sel.value = start;
  await loadRegion(start);
  initStudy({ map, meta, onEnter: enterOther, onExit: backToExplore, fmtDate });
  initReplay({ map, cache: state.cache, tab: () => state.tab, onEnter: enterOther, onExit: backToExplore });
  initStories({ map, meta, cache: state.cache, tab: () => state.tab, onEnter: enterOther, onExit: backToExplore });
  renderResults();
  // land on Fire stories, unless the link names another section (a region link just preselects that region)
  state.tab = "explore";
  if (h === "about") { setTab("results"); $(".about-wrap").scrollIntoView(); }
  else setTab(TABS.includes(h) ? h : "stories");
  let seen = false;
  try { seen = localStorage.getItem(INTRO_KEY) === "1"; } catch (_) { /* storage blocked */ }
  if (!seen && (state.tab === "stories" || state.tab === "explore")) $("#intro").hidden = false;
}

function buildTicks() {
  const { d_grid, t_grid, default: dflt } = state.meta;
  const put = (id, arr, fmt, mark) => {
    $(id).innerHTML = arr.map((v, i) => `<span style="left:${(i / (arr.length - 1)) * 100}%" class="${v === mark ? "mark" : ""}">${fmt(v)}</span>`).join("");
  };
  put("#d-ticks", d_grid, (v) => v, dflt.d);
  put("#T-ticks", t_grid, (v) => (v < 1 ? "½" : v), dflt.T);
  state.di = d_grid.indexOf(dflt.d);
  state.ti = t_grid.indexOf(dflt.T);
  $("#d").value = state.di;
  $("#T").value = state.ti;
}

function wireControls() {
  $("#region").addEventListener("change", (e) => loadRegion(e.target.value));
  $("#region-blurb").addEventListener("click", (e) => e.currentTarget.classList.toggle("open"));
  $("#fire-jump").addEventListener("change", (e) => {
    if (e.target.value !== "") selectPerimeter(+e.target.value);
    e.target.value = "";
  });
  const onSlide = () => {
    state.di = +$("#d").value;
    state.ti = +$("#T").value;
    scheduleRecluster();
  };
  $("#d").addEventListener("input", onSlide);
  $("#T").addEventListener("input", onSlide);
  $$("[data-preset]").forEach((b) => b.addEventListener("click", () => preset(b.dataset.preset)));
  $("#legend").addEventListener("click", (e) => {
    const b = e.target.closest("[data-color]");
    if (!b) return;
    state.colorBy = b.dataset.color;
    render();
  });
  for (const id of ["show-hulls", "show-ign", "show-perims", "show-origins"]) $("#" + id).addEventListener("change", layerVisibility);
  $("#layers-btn").addEventListener("click", () => {
    const open = $("#layers-pop").hidden;
    $("#layers-pop").hidden = !open;
    $("#layers-btn").setAttribute("aria-expanded", open);
  });
  document.addEventListener("click", (e) => {
    if (!$("#layers-pop").hidden && !e.target.closest("#layers-wrap")) {
      $("#layers-pop").hidden = true;
      $("#layers-btn").setAttribute("aria-expanded", "false");
    }
  });
  $$("#viewseg button").forEach((b) => b.addEventListener("click", () => setView(b.dataset.v)));
  $$("nav.tabs button").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
  $("#tmax").addEventListener("input", (e) => { state.tmax = +e.target.value; stopPlay(); renderTime(); });
  $("#play").addEventListener("click", () => togglePlay());
  $("#go-study").addEventListener("click", () => setTab("study"));
  $("#study-back").addEventListener("click", () => setTab("explore"));
  $("#explore-back").addEventListener("click", () => setTab(state.backTo || "result"));
  $$("[data-go2]").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.go2)));
  $$("[data-gw]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.gw;
    if (k === "study") return setTab("study");
    state.backTo = state.tab;
    setTab("explore");
    preset(k);
  }));
  $("#help").addEventListener("click", () => { $("#intro").hidden = false; });
  $("#intro-close").addEventListener("click", closeIntro);
  $$("#intro [data-go]").forEach((b) => b.addEventListener("click", () => { closeIntro(); setTab(b.dataset.go); }));

  // hover: highlight a whole fire event and say what it is
  map.on("mousemove", (e) => {
    if (state.tab !== "explore" || state.view === "cube") return;
    const d = map.queryRenderedFeatures(e.point, { layers: ["dets"] });
    if (d.length) {
      const p = d[0].properties;
      setHoverPerim(null);
      showTip(e.point, tipForDetection(p.ev, p.i));
      if (p.ev !== state.hover && state.colorBy !== "certainty") { state.hover = p.ev; applyFocus(); }
      map.getCanvas().style.cursor = "pointer";
      return;
    }
    if (state.hover != null) { state.hover = null; applyFocus(); }
    const pf = map.getLayoutProperty("perims-fill", "visibility") !== "none" ? map.queryRenderedFeatures(e.point, { layers: ["perims-fill"] }) : [];
    if (pf.length) {
      const k = pf[0].properties.id;
      setHoverPerim(k);
      showTip(e.point, tipForPerimeter(k));
      map.getCanvas().style.cursor = "pointer";
      return;
    }
    setHoverPerim(null);
    hideTip();
    map.getCanvas().style.cursor = "";
  });
  map.getCanvas().addEventListener("mouseleave", () => {
    hideTip();
    setHoverPerim(null);
    if (state.hover != null) { state.hover = null; applyFocus(); }
  });
  map.on("click", (e) => {
    if (state.tab !== "explore" || state.view === "cube") return;
    const d = map.queryRenderedFeatures(e.point, { layers: ["dets"] });
    if (d.length) return selectEvent(d[0].properties.ev, { fly: true });
    const pf = map.getLayoutProperty("perims-fill", "visibility") !== "none" ? map.queryRenderedFeatures(e.point, { layers: ["perims-fill"] }) : [];
    if (pf.length) return selectPerimeter(pf[0].properties.id);
    closeInspector();
  });
}

function closeIntro() {
  $("#intro").hidden = true;
  try { localStorage.setItem(INTRO_KEY, "1"); } catch (_) { /* storage blocked */ }
}

// ---------- region ----------
async function loadRegion(key) {
  $("#busy").hidden = false;
  stopPlay();
  closeInspector(true);
  let R = state.cache.get(key);
  if (!R) {
    R = await (await fetch(`data/${key}.json`)).json();
    state.cache.set(key, R);
  }
  state.key = key;
  state.R = R;
  state.summary = state.meta.regions.find((r) => r.key === key);
  const { x, y } = project(R.det.lon, R.det.lat, R.lon0, R.lat0);
  state.x = x; state.y = y; state.t = Float64Array.from(R.det.t);
  const feats = R.perimeters.features;
  const ox = feats.map((f) => (f.properties.origin ? f.properties.origin[0] : 0));
  const oy = feats.map((f) => (f.properties.origin ? f.properties.origin[1] : 0));
  const op = project(ox, oy, R.lon0, R.lat0);
  state.originXY = feats.map((f, k) => (f.properties.origin ? [op.x[k], op.y[k]] : null));
  state.selected = state.hover = null;
  if (state.tab === "explore") history.replaceState(null, "", "#" + key);
  $("#region-blurb").textContent = state.summary.blurb;
  $("#region-blurb").classList.remove("open");
  // official fires of the region, largest first, for the "jump to a fire" picker
  const hasDets = new Set(R.det.truth.filter((k) => k >= 0));
  const named = R.perimeters.features.map((f) => f.properties).filter((p) => hasDets.has(p.id)).sort((p, q) => q.acres - p.acres);
  $("#fire-jump").hidden = !state.summary.truth || !named.length;
  $("#fire-jump").innerHTML = `<option value="">Zoom to an official fire (optional)…</option>` + named.map((p) => `<option value="${p.id}">${p.name} · ${p.acres.toLocaleString()} acres</option>`).join("");
  setSatelliteYear(map, R.year);
  let lo = Infinity, hi = -Infinity;
  for (const v of R.det.t) { if (v < lo) lo = v; if (v > hi) hi = v; }
  state.tRange = [Math.floor(lo), Math.ceil(hi)];
  $("#tmax").min = state.tRange[0];
  $("#tmax").max = state.tRange[1];
  state.tmax = state.tRange[1];
  $("#tmax").value = state.tmax;
  setData(map, "perims", R.perimeters);
  setData(map, "origins", fc(R.perimeters.features.filter((f) => f.properties.origin).map((f) => ({
    type: "Feature", properties: { name: f.properties.name }, geometry: { type: "Point", coordinates: f.properties.origin },
  }))));
  const truth = state.summary.truth;
  $$("[data-preset=best]").forEach((b) => (b.disabled = !truth));
  $("#show-perims").disabled = $("#show-origins").disabled = !truth;
  $("#grid-title").textContent = "Compare every rule at once";
  const s = state.summary;
  map.jumpTo({ center: s.center, zoom: s.zoom - (window.innerWidth < 860 ? 0.8 : 0) });
  recluster();
  $("#busy").hidden = true;
}

function preset(kind) {
  const { d_grid, t_grid, default: dflt, national } = state.meta;
  let p = dflt;
  if (kind === "best" && state.summary.best) p = state.summary.best;
  if (kind === "national") p = national;
  setSetting(d_grid.indexOf(p.d), t_grid.indexOf(p.T));
}

function setSetting(di, ti) {
  state.di = di;
  state.ti = ti;
  $("#d").value = di;
  $("#T").value = ti;
  recluster();
}

let raf = 0;
function scheduleRecluster() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(recluster);
}

function currentGrid() {
  const { d_grid, t_grid } = state.meta;
  const d = d_grid[state.di], T = t_grid[state.ti];
  return { d, T, g: state.R.grid.find((g) => g.d === d && g.T === T) };
}

function recluster() {
  const { d, T } = currentGrid();
  $("#d-out").textContent = fmtD(d);
  $("#T-out").textContent = fmtT(T);
  const { label, nEvents } = clusterEvents(state.x, state.y, state.t, d, T);
  state.label = label;
  state.events = summarizeEvents(label, nEvents, state.t, state.x, state.y);
  indexTruth();
  render();
  renderScore();
  renderGrid();
  renderMore();
  markPresets();
  if (state.selected != null) {
    // keep the selection on whichever event now holds the same detection
    selectEvent(label[state.selectedDet], { silent: true });
  } else if (state.selectedPerim != null) {
    selectPerimeter(state.selectedPerim, { silent: true });
  }
}

// which official fires each event contains, and which events each official fire was split into
function indexTruth() {
  const { label } = state;
  const truth = state.R.det.truth;
  const evTruth = new Map(), truthEv = new Map(), evBg = new Map();
  for (let i = 0; i < label.length; i++) {
    const e = label[i], k = truth[i];
    if (k >= 0) {
      let m = evTruth.get(e); if (!m) evTruth.set(e, (m = new Map()));
      m.set(k, (m.get(k) || 0) + 1);
      let q = truthEv.get(k); if (!q) truthEv.set(k, (q = new Map()));
      q.set(e, (q.get(e) || 0) + 1);
    } else if (k === -1) evBg.set(e, (evBg.get(e) || 0) + 1);
  }
  state.evTruth = evTruth;
  state.truthEv = truthEv;
  state.evBg = evBg;
}

// ---------- map render ----------
function render() {
  if (!state.label || state.tab === "study" || state.tab === "replay") return;
  const { R, label, events } = state;
  const lon = R.det.lon, lat = R.det.lat, t = R.det.t;
  const [t0, t1] = state.tRange;
  const cert = state.colorBy === "certainty";
  const cols = new Array(lon.length);
  const feats = new Array(lon.length);
  for (let i = 0; i < lon.length; i++) {
    const ev = events[label[i]];
    let col, r = 1, a = 0.9;
    if (cert) {
      const f = R.det.ign[i];
      if (f >= 36) { col = "#d7301f"; r = 1.5; a = 0.95; }
      else if (f >= 8) { col = "#f08c2c"; r = 1.15; a = 0.9; }
      else if (f >= 1) { col = "#f6cf6b"; r = 0.85; a = 0.85; }
      else { col = "#9aa6af"; r = 0.6; a = 0.45; }
    } else if (state.colorBy === "date") {
      col = rampColor((t[i] - t0) / Math.max(1, t1 - t0));
    } else if (ev.size < 3) {
      col = "#8a96a0"; r = 0.75; a = 0.65;
    } else {
      col = EVENT_COLORS[ev.id % EVENT_COLORS.length];
    }
    cols[i] = col;
    feats[i] = { type: "Feature", properties: { ev: label[i], t: t[i], col, r, a, i }, geometry: { type: "Point", coordinates: [lon[i], lat[i]] } };
  }
  state.cols = cols;
  state.detFeatures = feats;

  // outlines, starting points and spread arrows for events with 3+ detections
  const members = new Map();
  for (let i = 0; i < lon.length; i++) {
    const e = label[i];
    if (events[e].size < 3) continue;
    let m = members.get(e);
    if (!m) members.set(e, (m = []));
    m.push([lon[i], lat[i]]);
  }
  const hulls = [], ign = [], arrowsByEv = new Map();
  const kx = 111.32 * Math.cos((R.lat0 * Math.PI) / 180);
  for (const [e, pts] of members) {
    const ev = events[e];
    const col = state.colorBy === "event" ? EVENT_COLORS[e % EVENT_COLORS.length] : "#56636e";
    const h = hull(pts);
    if (h) hulls.push({ type: "Feature", properties: { col, t0: ev.t0, ev: e }, geometry: { type: "Polygon", coordinates: [h] } });
    const i0 = ev.ign;
    ign.push({ type: "Feature", properties: { col: state.colorBy === "event" ? col : cols[i0], t0: ev.t0, ev: e }, geometry: { type: "Point", coordinates: [lon[i0], lat[i0]] } });
    const ex = ev.endX / kx + R.lon0, ey = ev.endY / 110.57 + R.lat0;
    const dist = Math.hypot(ev.endX - state.x[i0], ev.endY - state.y[i0]);
    if (ev.size >= 5 && dist > 2) {
      const sx = lon[i0], sy = lat[i0];
      const mx = sx + (ex - sx) * 0.8, my = sy + (ey - sy) * 0.8;
      arrowsByEv.set(e, [
        { type: "Feature", properties: { end: 0 }, geometry: { type: "LineString", coordinates: [[sx, sy], [ex, ey]] } },
        { type: "Feature", properties: { end: 1 }, geometry: { type: "LineString", coordinates: [[mx, my], [ex, ey]] } },
      ]);
    }
  }
  state.layers = { hulls, ign, arrowsByEv };
  renderTime();
  renderLegend();
  layerVisibility();
  applyFocus();
  if (state.view === "cube") renderCube();
}

function renderTime() {
  const tm = state.tmax;
  const [, t1] = state.tRange;
  $("#tmax-out").textContent = tm >= t1 ? `All of ${state.R.year}` : `to ${fmtDate(state.R.year, tm)}`;
  if (!state.detFeatures) return;
  const all = tm >= t1;
  setData(map, "dets", fc(all ? state.detFeatures : state.detFeatures.filter((f) => f.properties.t <= tm)));
  const cert = state.colorBy === "certainty";
  setData(map, "hulls", fc(all && !cert ? state.layers.hulls : []));
  setData(map, "ign", fc(cert ? [] : state.layers.ign.filter((f) => all || f.properties.t0 <= tm)));
  if (state.view === "cube") renderCube();
}

// highlight the hovered (or else the selected) event; draw its spread arrow
function applyFocus() {
  if (!state.layers) return;
  const ev = state.colorBy === "certainty" ? null : state.hover ?? state.selected;
  focusEvent(map, ev);
  setData(map, "arrows", fc(ev != null && $("#show-ign").checked ? state.layers.arrowsByEv.get(ev) || [] : []));
}

function setHoverPerim(k) {
  if (k === state.hoverPerim) return;
  if (state.hoverPerim != null) map.setFeatureState({ source: "perims", id: state.hoverPerim }, { hover: false });
  state.hoverPerim = k;
  if (k != null) map.setFeatureState({ source: "perims", id: k }, { hover: true });
}

function renderCube() {
  const { R } = state;
  const [t0, t1] = state.tRange;
  const span = Math.max(1, t1 - t0);
  const [w, s, e, n] = state.summary.bbox;
  const extentKm = Math.max((e - w) * 111.32 * Math.cos((R.lat0 * Math.PI) / 180), (n - s) * 110.57);
  const tm = state.tmax;
  setData(map, "cube", cubeFeatures(R.det.lon, R.det.lat, R.det.t, state.cols, {
    t0, metersPerDay: (extentKm * 1000 * 0.45) / span, sizeKm: Math.max(1.2, extentKm / 180),
    keep: tm >= t1 ? null : (i) => R.det.t[i] <= tm,
  }));
}

function layerVisibility() {
  if (state.tab !== "explore") return;
  const cert = state.colorBy === "certainty";
  const flat = state.view !== "cube";
  setVisible(map, ["dets"], flat);
  setVisible(map, ["hulls-fill", "hulls-line"], !cert && $("#show-hulls").checked && flat);
  setVisible(map, ["ign", "arrows", "arrowheads"], !cert && $("#show-ign").checked && flat);
  const truth = state.summary && state.summary.truth;
  setVisible(map, ["perims-fill", "perims-line"], truth && $("#show-perims").checked);
  setVisible(map, ["origins"], truth && $("#show-origins").checked && !cert);
  setVisible(map, ["links-on", "links-off", "links-hit", "focus-line"], false);
  applyFocus();
}

const sw = {
  sq: (c) => `<svg class="sw" viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9" fill="${c}"/></svg>`,
  dot: (c, r = 4) => `<svg class="sw" viewBox="0 0 12 12"><circle cx="6" cy="6" r="${r}" fill="${c}"/></svg>`,
  ring: (c) => `<svg class="sw" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4" fill="none" stroke="${c}" stroke-width="2"/></svg>`,
  perim: `<svg class="sw" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" fill="none" stroke="var(--truth)" stroke-dasharray="3 2"/></svg>`,
  origin: `<svg class="sw" viewBox="0 0 12 12"><path d="M6 1.5v9M1.5 6h9" stroke="var(--truth)" stroke-width="2.4" stroke-linecap="round"/></svg>`,
};

function renderLegend() {
  const [t0, t1] = state.tRange;
  const yr = state.R.year;
  const seg = `<div class="head"><span class="eyebrow">Colour dots by</span><div class="seg small" role="group" aria-label="Colour dots by">
    ${[["event", "Fire"], ["date", "Date"], ["certainty", "Certainty"]].map(([v, l]) => `<button data-color="${v}" aria-pressed="${state.colorBy === v}">${l}</button>`).join("")}</div></div>`;
  let body;
  if (state.colorBy === "certainty") {
    body = `<span class="note">How many of 72 settings call this dot the place a fire started</span>
      <div class="keys"><span class="key">${sw.dot("#d7301f", 5)}36–72</span><span class="key">${sw.dot("#f08c2c", 4)}8–35</span>
      <span class="key">${sw.dot("#f6cf6b", 3.5)}1–7</span><span class="key">${sw.dot("#9aa6af", 3)}never</span></div>`;
  } else if (state.colorBy === "date") {
    body = `<div class="ramp" style="background:linear-gradient(90deg,${DATE_RAMP.join(",")})"></div>
      <div class="ends"><span>${fmtDate(yr, t0)}</span><span>${fmtDate(yr, t1)}</span></div>`;
  } else {
    body = `<div class="keys">
      <span class="key">${sw.dot("#e4572e")}one colour = one fire, by the rule</span>
      <span class="key">${sw.dot("#8a96a0", 3)}lone dots (1–2)</span>
      <span class="key">${sw.ring("#e4572e")}its first dot</span></div>`;
  }
  if (state.summary.truth && state.colorBy !== "certainty") {
    body += `<div class="keys"><span class="key">${sw.perim}official perimeter</span><span class="key">${sw.origin}official point of origin</span></div>`;
  }
  $("#legend").innerHTML = seg + body;
}

// ---------- hover text ----------
function officialNames(e, max = 3) {
  const m = state.evTruth.get(e);
  if (!m) return [];
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([k]) => state.R.perimeters.features[k].properties.name);
}

function tipForDetection(e, i) {
  const { R } = state;
  const yr = R.year;
  if (state.colorBy === "certainty") {
    const f = R.det.ign[i];
    return `<b>${f ? `A fire's starting point under ${f} of 72 settings` : "Never a starting point"}</b><br><span class="dim">${fmtDate(yr, R.det.t[i], true)}</span>`;
  }
  const ev = state.events[e];
  if (ev.size < 3) return `<b>${ev.size} ${ev.size === 1 ? "dot" : "dots"} on their own</b><br><span class="dim">a small or short-lived fire, or a false detection · ${fmtDate(yr, ev.t0)}</span>`;
  const m = state.evTruth.get(e);
  let off = "";
  if (state.summary.truth) {
    if (!m) off = `<br><span class="dim">no official perimeter</span>`;
    else if (m.size === 1) off = `<br>Official: ${officialNames(e)[0]}`;
    else off = `<br>⚠ merges ${m.size} official fires: ${officialNames(e, 2).join(", ")}${m.size > 2 ? "…" : ""}`;
  }
  return `<b>Fire ${e + 1}, by this rule</b> · ${ev.size.toLocaleString()} dots<br><span class="dim">${fmtDate(yr, ev.t0)} – ${fmtDate(yr, ev.t1)} (${fmtSpan(ev.t1 - ev.t0)})</span>${off}<br><span class="dim">click for details</span>`;
}

function tipForPerimeter(k) {
  const p = state.R.perimeters.features[k].properties;
  const pieces = state.truthEv.get(k);
  return `<b>${p.name}</b> · official perimeter<br><span class="dim">${fmtAcres(p.acres)}${p.contain_days != null ? ` · contained after ${Math.round(p.contain_days)} days` : ""}</span>${pieces ? `<br>Its dots fall into ${pieces.size} ${pieces.size === 1 ? "event" : "events"} at this setting` : ""}`;
}

// ---------- inspector cards ----------
function eventBounds(e) {
  const { R, label } = state;
  let w = 180, s = 90, ea = -180, n = -90;
  for (let i = 0; i < label.length; i++) {
    if (label[i] !== e) continue;
    w = Math.min(w, R.det.lon[i]); ea = Math.max(ea, R.det.lon[i]); s = Math.min(s, R.det.lat[i]); n = Math.max(n, R.det.lat[i]);
  }
  return [[w, s], [ea, n]];
}

function fitTo(bounds) {
  const wide = window.innerWidth >= 860;
  map.fitBounds(bounds, { padding: wide ? { top: 70, bottom: 90, left: 60, right: 400 } : { top: 40, bottom: 40, left: 30, right: 30 }, maxZoom: 10.5, duration: 900 });
}

function selectEvent(e, { fly = false, silent = false } = {}) {
  if (e == null || !state.events) return;
  const ev = state.events[e];
  state.selected = e;
  state.selectedPerim = null;
  state.selectedDet = ev.ign;
  applyFocus();
  const { R } = state;
  const yr = R.year;
  const i0 = ev.ign;
  const m = state.evTruth.get(e);
  const bg = state.evBg.get(e) || 0;
  const xs = [], ys = [];
  for (let i = 0; i < state.label.length; i++) if (state.label[i] === e) { xs.push(state.x[i]); ys.push(state.y[i]); }
  const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  let official = "";
  if (state.summary.truth) {
    if (!m) {
      official = `<p class="note">No official perimeter contains this event. It may be a small unmapped fire, a prescribed or agricultural burn, or a false detection.</p>`;
    } else {
      const rows = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => {
        const p = R.perimeters.features[k].properties;
        let offTxt = "";
        if (p.origin) {
          const kx = 111.32 * Math.cos((R.lat0 * Math.PI) / 180);
          const dx = (p.origin[0] - R.det.lon[i0]) * kx, dy = (p.origin[1] - R.det.lat[i0]) * 110.57;
          offTxt = ` · recorded origin ${Math.hypot(dx, dy).toFixed(1)} km from this start`;
        }
        const pieces = state.truthEv.get(k).size;
        return `<div class="row-item clickable" data-perim="${k}"><span><b>${p.name}</b></span><span class="mono">${n} dots</span>
          <small>${fmtAcres(p.acres)} · ${p.cause}${p.complex ? " · " + p.complex : ""}${offTxt}${pieces > 1 ? ` · split into ${pieces} events here` : ""}</small></div>`;
      }).join("");
      const verdict = m.size > 1
        ? `<span class="pill warn">merges ${m.size} official fires</span>`
        : state.truthEv.get([...m.keys()][0]).size > 1
          ? `<span class="pill warn">one piece of a split fire</span>`
          : `<span class="pill good">matches one official fire</span>`;
      official = `<div style="display:flex;gap:6px;flex-wrap:wrap">${verdict}${bg ? `<span class="pill">${bg} dots outside any perimeter</span>` : ""}</div>
        <div class="rows">${rows}</div>`;
    }
  }
  const names = officialNames(e, 1);
  const body = openInspector({
    eyebrow: `Fire ${e + 1} by the rule · ${currentGrid().d} km, ${fmtT(currentGrid().T)}`,
    title: `<span class="sw-dot" style="background:${EVENT_COLORS[e % EVENT_COLORS.length]}"></span>${names.length && m && m.size === 1 ? names[0] : ev.size < 3 ? "Isolated detections" : "Unnamed fire event"}`,
    body: `
      <dl class="kv">
        <dt>Dots</dt><dd>${ev.size.toLocaleString()}</dd>
        <dt>First seen</dt><dd>${fmtDate(yr, ev.t0, true)}</dd>
        <dt>Last seen</dt><dd>${fmtDate(yr, ev.t1, true)}</dd>
        <dt>Burned for</dt><dd>${fmtSpan(ev.t1 - ev.t0)}</dd>
        <dt>Spread across</dt><dd>${extent.toFixed(1)} km</dd>
      </dl>
      ${official}
      <div class="presets"><button class="btn" id="ev-zoom">Zoom to it</button><button class="btn" id="ev-play">Watch it grow</button></div>`,
    close: () => { state.selected = null; applyFocus(); },
  });
  body.querySelector("#ev-zoom").addEventListener("click", () => fitTo(eventBounds(e)));
  body.querySelector("#ev-play").addEventListener("click", () => { fitTo(eventBounds(e)); togglePlay([Math.floor(ev.t0), Math.ceil(ev.t1)]); });
  body.querySelectorAll("[data-perim]").forEach((el) => el.addEventListener("click", () => selectPerimeter(+el.dataset.perim)));
  if (fly) fitTo(eventBounds(e));
  if (!silent && state.tab !== "explore") setTab("explore");
}

function selectPerimeter(k, { silent = false } = {}) {
  const { R } = state;
  const p = R.perimeters.features[k].properties;
  state.selected = null;
  state.selectedPerim = k;
  applyFocus();
  const pieces = state.truthEv.get(k);
  const yr = R.year;
  const list = pieces ? [...pieces.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([e, n]) => {
    const ev = state.events[e];
    const others = state.evTruth.get(e).size - 1;
    return `<div class="row-item clickable" data-ev="${e}"><span><span class="sw-dot" style="background:${ev.size < 3 ? "#8a96a0" : EVENT_COLORS[e % EVENT_COLORS.length]}"></span>Event ${e + 1}</span><span class="mono">${n} of its dots</span>
      <small>${fmtDate(yr, ev.t0)} – ${fmtDate(yr, ev.t1)}${others ? ` · also holds ${others} other official ${others === 1 ? "fire" : "fires"}` : ""}</small></div>`;
  }).join("") : "";
  const verdict = !pieces ? `<p class="note">No satellite detections fall inside this perimeter.</p>`
    : pieces.size === 1 && state.evTruth.get([...pieces.keys()][0]).size === 1
      ? `<span class="pill good">comes out as one event</span>`
      : pieces.size > 1 ? `<span class="pill warn">split into ${pieces.size} events</span>` : `<span class="pill warn">merged with other fires</span>`;
  const disc = p.disc != null ? fmtDate(yr, p.disc) : null;
  const body = openInspector({
    eyebrow: "Official record (WFIGS)",
    title: p.name,
    body: `
      <dl class="kv">
        <dt>Area</dt><dd>${fmtAcres(p.acres)}</dd>
        ${disc ? `<dt>Discovered</dt><dd>${disc}</dd>` : ""}
        ${p.contain_days != null ? `<dt>Contained after</dt><dd>${Math.round(p.contain_days)} days</dd>` : ""}
        <dt>Cause</dt><dd>${p.cause || "unknown"}</dd>
        ${p.complex ? `<dt>Complex</dt><dd>${p.complex}</dd>` : ""}
      </dl>
      <div>${verdict}</div>
      ${list ? `<p class="note">At ${currentGrid().d} km and ${fmtT(currentGrid().T)}, its dots fall into:</p><div class="rows">${list}</div>` : ""}`,
    close: () => { state.selectedPerim = null; },
  });
  body.querySelectorAll("[data-ev]").forEach((el) => el.addEventListener("click", () => selectEvent(+el.dataset.ev, { fly: true })));
  if (!silent) {
    const f = R.perimeters.features[k];
    const coords = f.geometry.type === "Polygon" ? f.geometry.coordinates.flat() : f.geometry.coordinates.flat(2);
    const xs = coords.map((c) => c[0]), ys = coords.map((c) => c[1]);
    fitTo([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]]);
  }
}

// ---------- rail: score, settings grid, more numbers ----------
function renderScore() {
  const { g } = currentGrid();
  const s = state.summary;
  const n3 = state.events.filter((e) => e.size >= 3).length;
  $("#explore-facts").innerHTML = `<span><b>${state.R.det.t.length.toLocaleString()}</b> dots</span><span><b>${state.events.length.toLocaleString()}</b> groups at this rule</span><span><b>${n3}</b> with 3+ dots</span>`;
  if (s.truth && g) {
    const at = (v) => `${Math.max(0, Math.min(100, v * 100))}%`;
    const whole = Math.round(g.recovered * g.n_fires);
    // a concrete example: the largest official fire this rule gets wrong, and how
    const feats = state.R.perimeters.features;
    const fate = (k) => {
      const pieces = state.truthEv.get(k);
      const top = [...pieces.entries()].sort((x, y) => y[1] - x[1])[0][0];
      return { pieces: pieces.size, others: state.evTruth.get(top).size - 1 };
    };
    let bad = null;
    for (const [k] of state.truthEv) {
      const f = fate(k);
      if ((f.pieces > 1 || f.others) && (bad == null || feats[k].properties.acres > feats[bad].properties.acres)) bad = k;
    }
    let example = "";
    if (bad != null) {
      const f = fate(bad);
      const link = `<a href="#" data-perim="${bad}">${feats[bad].properties.name} fire</a>`;
      example = f.pieces > 1 ? ` The biggest one it gets wrong: the ${link} is cut into <b>${f.pieces} pieces</b>.`
        : ` The biggest one it gets wrong: the ${link} is glued together with <b>${f.others} other official ${f.others === 1 ? "fire" : "fires"}</b>.`;
    }
    let verdict;
    const best = g.recovered >= s.best.recovered - 1e-9;
    if (best && bad == null) verdict = `<b>This is the best rule for this region:</b> every official fire comes out right.`;
    else if (best) verdict = `<b>This is the best rule for this region.</b> No single rule gets every fire right.`;
    else if (g.mean_split > 1.25 && g.mean_split >= g.mean_merge) verdict = `<b>Too strict.</b> Dots from the same fire are too far apart for this rule, so big fires get cut into pieces.`;
    else if (g.mean_merge > 1.25) verdict = `<b>Too loose.</b> Dots from neighbouring fires count as one, so separate fires get glued together.`;
    else verdict = `<b>Close.</b> The best rule here gets ${pct(s.best.recovered)}.`;
    $("#score").innerHTML = `
      <span class="eyebrow">3 · How well did the rule do?</span>
      <div class="big"><b>${pct(g.recovered)}</b><span>of official fires come out right<br><span class="out-of">${whole} of ${g.n_fires}: each one a single group, with nothing else mixed in</span></span></div>
      <div class="scorebar" aria-hidden="true">
        <div class="track"></div><div class="fill" style="width:${at(g.recovered)}"></div>
        <div class="mk default" style="left:${at(s.default.recovered)}"><i></i>2016 rule</div>
        <div class="mk best" style="left:${at(s.best.recovered)}"><i></i>best</div>
      </div>
      <p class="verdict">${verdict}${example}</p>`;
    $$("#score [data-perim]").forEach((el) => el.addEventListener("click", (ev) => { ev.preventDefault(); selectPerimeter(+el.dataset.perim); }));
  } else {
    const plaus = state.R.grid.filter((q) => q.d >= 1 && q.d <= 5 && q.T >= 1 && q.T <= 7).map((q) => q.n_events_3plus);
    const lo = Math.min(...plaus), hi = Math.max(...plaus);
    $("#score").innerHTML = `
      <span class="eyebrow">3 · How many fires did the rule find?</span>
      <div class="big"><b>${n3.toLocaleString()}</b><span>fires (groups of 3+ dots) at this rule</span></div>
      <p class="verdict">There are no official fire maps here, so no rule can be checked. Sensible-looking rules (1–5 km, 1–7 days) find anywhere from <b>${lo.toLocaleString()} to ${hi.toLocaleString()}</b> fires, and the high count is ${(hi / Math.max(1, lo)).toFixed(1)} times the low one. <a href="#" data-goto="study">Try judging some yourself</a>.</p>`;
    $("#score [data-goto]").addEventListener("click", (ev) => { ev.preventDefault(); setTab("study"); });
  }
}

function renderGrid(hover = null) {
  const { d_grid, t_grid, default: dflt, national } = state.meta;
  const s = state.summary;
  const G = state.R.grid;
  const g = (d, T) => G.find((x) => x.d === d && x.T === T);
  const truth = s.truth;
  const maxv = Math.max(...G.map((q) => Math.log10(1 + q.n_events_3plus)));
  const compact = (n) => (n >= 10000 ? Math.round(n / 1000) + "k" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n));
  const marks = [
    { i: d_grid.indexOf(dflt.d), j: t_grid.indexOf(dflt.T), kind: "outline", title: "2016 default" },
    { i: d_grid.indexOf(national.d), j: t_grid.indexOf(national.T), kind: "ring", title: "US-wide setting" },
    { i: state.di, j: state.ti, kind: "current", title: "Current setting" },
  ];
  if (truth) marks.push({ i: d_grid.indexOf(s.best.d), j: t_grid.indexOf(s.best.T), kind: "dot", title: "Best for this region" });
  heatmap($("#grid"), {
    rows: d_grid.map((d) => d + " km"), cols: t_grid.map((t) => (t < 1 ? "½" : t)),
    values: d_grid.map((d) => t_grid.map((T) => (truth ? g(d, T).recovered : Math.log10(1 + g(d, T).n_events_3plus) / maxv))),
    labels: d_grid.map((d) => t_grid.map((T) => (truth ? Math.round(g(d, T).recovered * 100) : compact(g(d, T).n_events_3plus)))),
    marks, rowTitle: "km apart", colTitle: "days apart",
    label: truth ? "Share of official fires recovered by setting" : "Number of fire events by setting",
    onPick: (i, j) => setSetting(i, j),
    onHover: (i, j) => gridCaption(i == null ? null : [i, j]),
  });
  if (!$("#grid-legend").childElementCount) {
    $("#grid-legend").innerHTML = heatLegend([
      { kind: "current", text: "your rule" }, { kind: "outline", text: "2016 rule" }, { kind: "ring", text: "best US-wide" },
      ...(truth ? [{ kind: "dot", text: "best here" }] : []),
    ]);
  }
  gridCaption(hover);
}

function gridCaption(cell) {
  const { d_grid, t_grid } = state.meta;
  const s = state.summary;
  if (!cell) {
    $("#grid-caption").innerHTML = s.truth
      ? "Each square is one rule: rows are how far apart, columns are how many days apart. The number is the % of official fires it gets right. Darker is better. Click a square to try that rule."
      : "Each square is one rule: rows are how far apart, columns are how many days apart. The number is how many fires (3+ dots) it finds. With no official maps, nothing says which square is right.";
    return;
  }
  const [i, j] = cell;
  const g = state.R.grid.find((x) => x.d === d_grid[i] && x.T === t_grid[j]);
  $("#grid-caption").innerHTML = `<b>${d_grid[i]} km, ${fmtT(t_grid[j])}:</b> ${s.truth ? `${pct(g.recovered)} of fires right · each fire in ${g.mean_split} pieces on average · each group holds ${g.mean_merge} official fires on average · ` : ""}${g.n_events_3plus.toLocaleString()} fires with 3+ dots`;
}

function renderMore() {
  const { g } = currentGrid();
  const s = state.summary;
  if (s.truth && g) {
    $("#explore-readout").innerHTML = `
      <div><small>Pieces per official fire</small><b>${g.mean_split ?? "n/a"}</b><small>average; above 1 means fires get cut up</small></div>
      <div><small>Official fires per group</small><b>${g.mean_merge ?? "n/a"}</b><small>average; above 1 means fires get glued together</small></div>
      <div><small>First dot vs. recorded start point</small><b>${g.ign_err_km == null ? "n/a" : g.ign_err_km.toFixed(1) + " km"}</b><small>median distance</small></div>
      <div><small>Dot-by-dot accuracy (F1)</small><b>${g.f1 != null ? g.f1.toFixed(2) : "n/a"}</b><small>1.00 would be perfect</small></div>`;
    $("#explore-note").innerHTML = `A fire counts as <b>right</b> when one group holds at least 90% of its dots and at least 90% of that group is that fire. The first satellite detection came a median <b>${g.ign_lag_days == null ? "n/a" : (g.ign_lag_days * 24).toFixed(0) + " hours"}</b> after the recorded discovery. ${s.label_cover != null ? `${pct(s.label_cover)} of dots here fall inside an official perimeter.` : ""}`;
  } else {
    const ign = state.R.det.ign;
    let any = 0, half = 0;
    for (const f of ign) { if (f > 0) any++; if (f >= 36) half++; }
    $("#explore-readout").innerHTML = `
      <div><small>Dots ever called a starting point</small><b>${any.toLocaleString()}</b><small>under at least one of 72 settings</small></div>
      <div><small>Called one under half or more</small><b>${half.toLocaleString()}</b><small>the more certain starts</small></div>`;
    $("#explore-note").innerHTML = `In the 2025 global fire-events study, windows for places like this were set by inspecting the results by eye. Switch the legend to <b>Certainty</b> to see which starting points hold up across settings.`;
  }
}

function markPresets() {
  const { d_grid, t_grid, default: dflt, national } = state.meta;
  const d = d_grid[state.di], T = t_grid[state.ti];
  const s = state.summary;
  const is = (p) => p && p.d === d && p.T === T;
  $("[data-preset=default]").setAttribute("aria-pressed", is(dflt));
  $("[data-preset=national]")?.setAttribute("aria-pressed", is(national));
  $("[data-preset=best]").setAttribute("aria-pressed", !!(s.truth && is(s.best)));
}

// ---------- results page ----------

function renderResults() {
  const N = state.national;
  if (!N) return;
  const o = N.overall;
  const R = N.review;
  const k5 = R.budgets.indexOf(0.05);
  $("#tiles").innerHTML = `
    <button class="tile" data-try="default"><span class="t">The 2016 rule</span><b>${pct(o.default)}</b><small>1.5 km, 4 days</small><span class="go">see it on the map →</span></button>
    <button class="tile" data-try="national"><span class="t">A wider window</span><b>${pct(o.fixed_tuned)}</b><small>4 km, 10–14 days</small><span class="go">see it on the map →</span></button>
    <div class="tile"><span class="t">Machine learning</span><b>${pct(o.learned)}</b><small>trained on ${(N.n_pairs / 1e6).toFixed(1)}M detection pairs</small></div>
    <div class="tile"><span class="t">Grow from the start</span><b>${pct(o.growth)}</b><small>my best automatic try</small></div>
    <div class="tile hl"><span class="t">Plus a person</span><b>${pct(R.curves.largest[k5])}</b><small>checks the biggest 5% (simulated)</small></div>`;
  $$("#tiles [data-try]").forEach((b) => b.addEventListener("click", () => { state.backTo = state.tab; setTab("explore"); preset(b.dataset.try); }));
  const short = (n) => n.replace("Great Basin & N. Rockies", "Great Basin").replace("Pacific Northwest", "Pacific NW");
  const series = [
    { key: "default", kind: "square", label: "2016 rule" },
    { key: "fixed_tuned", kind: "ring", label: "wider window" },
    { key: "growth", kind: "diamond", label: "grow from the start" },
  ];
  dotplot($("#nat-chart"), {
    rows: N.regions.map((r) => ({ name: short(r.region), values: Object.fromEntries(series.map((sr) => [sr.key, r[sr.key] * 100])) })),
    series, label: "Fires grouped correctly, by region",
  });
  $("#nat-chart").insertAdjacentHTML("beforeend", dotLegend(series));
  $("#nat-finding").innerHTML = `Every region improves on the 2016 rule. What's left is mostly fires that burned into each other.`;
  lines($("#rev-chart"), {
    xLabels: R.budgets.map((b) => Math.round(b * 100) + "%"), xTitle: "share of fire groups a person checks",
    series: [
      { name: "biggest first", values: R.curves.largest, style: "accent" },
      { name: "at random", values: R.curves.random, style: "muted", dash: true },
    ],
    yMin: 0.7, yMax: 0.95, label: "Fires grouped correctly as a person checks more",
  });
  $("#rev-note").innerHTML = `Checking the biggest 5% takes it from ${pct(R.curves.largest[0])} to <b>${pct(R.curves.largest[k5])}</b>. Checking 5% at random barely helps (${pct(R.curves.random[k5])}).`;
}

// ---------- view, tabs, time ----------
function setView(v, opts) {
  state.view = v;
  $$("#viewseg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === v));
  if (state.tab === "stories" && v === "cube") v = "map";
  applyView(map, v, state.tab === "stories" ? { keepCamera: true } : opts);
  if (state.tab === "stories") document.dispatchEvent(new CustomEvent("stories:refit"));
  if (state.tab !== "explore") return;
  hideTip();
  if (v === "cube") renderCube();
  layerVisibility();
}

function setTab(tab) {
  const prev = state.tab;
  state.tab = tab;
  $$("nav.tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === (tab === "study" || tab === "explore" ? state.backTo || "result" : tab)));
  const isPage = tab === "results" || tab === "result";
  $("#main").classList.toggle("is-page", isPage);
  $$("[data-page]").forEach((p) => (p.hidden = p.dataset.page !== tab));
  $$("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== tab));
  history.replaceState(null, "", "#" + (tab === "explore" ? state.key : tab));
  hideTip();
  $("#intro").hidden = true;
  if (prev !== tab) closeInspector(prev !== "explore");
  if (prev === "replay" && tab !== "replay") document.dispatchEvent(new CustomEvent("replay:hide"));
  if (prev === "study" && tab !== "study") document.dispatchEvent(new CustomEvent("study:hide"));
  if (prev === "stories" && tab !== "stories") document.dispatchEvent(new CustomEvent("stories:hide"));
  if (isPage) { stopPlay(); $(`#page-${tab}`).scrollTop = 0; return; }
  requestAnimationFrame(() => map.resize());
  $("#timebar").hidden = tab !== "explore";
  $("#layers-wrap").hidden = tab !== "explore";
  $("#rp-timeline").hidden = tab !== "replay";
  $("#viewseg").hidden = tab === "replay";
  $("#viewseg [data-v=cube]").hidden = tab === "stories";
  $("#legend").hidden = false;
  $("#legend").classList.toggle("top", tab === "replay");
  $("#legend").classList.toggle("under", tab === "stories");
  if (tab === "stories") {
    $("#legend").innerHTML = `<details class="key-toggle"><summary class="eyebrow">Map key</summary><div class="keybody">
      <div class="ramp" style="background:linear-gradient(90deg,#3a1610,#991b0c,#e0360a,#ff7d00,#ffc233,#fff6d5)"></div>
      <div class="ends"><span>burned</span><span>burning now</span></div>
      <div class="keys"><span class="key">${sw.origin}where it started</span><span class="key"><svg class="sw" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" fill="none" stroke="var(--truth)" stroke-dasharray="3 2"/></svg>final outline</span><span class="key"><svg class="sw" viewBox="0 0 12 12"><path d="M1 8c3-4 6-4 10-5" stroke="var(--muted)" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>prevailing wind</span></div>
      <span class="note">Each square is 1 km seen burning by NASA satellites.</span></div></details>`;
    storiesLegend = $("#legend").innerHTML;
    document.dispatchEvent(new CustomEvent("stories:show"));
    return;
  }
  if (tab === "study") {
    document.dispatchEvent(new CustomEvent("study:show"));
    return;
  }
  if (tab === "replay") {
    $("#legend").innerHTML = `<details class="key-toggle"><summary class="eyebrow">Map key</summary><div class="keybody">
      <div class="ramp" style="background:linear-gradient(90deg,#7a1c0e,#e0360a,#ff7d00,#fff1b0)"></div>
      <div class="ends"><span>days ago</span><span>this pass</span></div>
      <div class="keys"><span class="key">${sw.ring("#e4572e")}new fire</span><span class="key">${sw.ring("#d4a017")}needs a call: click it</span></div>
      <span class="note">Each dot is 1 km seen burning by NASA satellites.</span></div></details>`;
    document.dispatchEvent(new CustomEvent("replay:show"));
    return;
  }
  if (prev === "results") return;   // map state is unchanged
  render();
}

let storiesLegend = "";
document.addEventListener("stories:legend", () => { if (storiesLegend) $("#legend").innerHTML = storiesLegend; });

function enterOther() {
  stopPlay();
}
function backToExplore() {
  if (!state.R) return;
  focusEvent(map, null);
  setSatelliteYear(map, state.R.year);
  setData(map, "perims", state.R.perimeters);
  setView(state.view, { keepCamera: false });
  render();
  map.jumpTo({ center: state.summary.center, zoom: state.summary.zoom - (window.innerWidth < 860 ? 0.8 : 0) });
}

const PLAY_ICON = `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1l9 5-9 5z" fill="currentColor"/></svg>`;
const PAUSE_ICON = `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="1" width="3" height="10" fill="currentColor"/><rect x="7" y="1" width="3" height="10" fill="currentColor"/></svg>`;

// play the season (or one event's life, given [from, to])
function togglePlay(range) {
  if (state.playing && !range) return stopPlay();
  stopPlay();
  const [t0, t1] = range || state.tRange;
  const stepDays = Math.max(0.25, (t1 - t0) / 120);
  if (range || state.tmax >= t1) state.tmax = t0;
  state.playing = setInterval(() => {
    state.tmax = Math.min(t1, state.tmax + stepDays);
    $("#tmax").value = state.tmax;
    renderTime();
    if (state.tmax >= t1) {
      stopPlay();
      if (range) setTimeout(() => { state.tmax = state.tRange[1]; $("#tmax").value = state.tmax; renderTime(); }, 1200);
    }
  }, 70);
  $("#play").innerHTML = PAUSE_ICON;
  $("#play").setAttribute("aria-label", "Pause");
}
function stopPlay() {
  if (state.playing) clearInterval(state.playing);
  state.playing = null;
  $("#play").innerHTML = PLAY_ICON;
  $("#play").setAttribute("aria-label", "Play the fire season");
}

window.addEventListener("hashchange", () => {
  const k = location.hash.slice(1);
  if (TABS.includes(k) && k !== state.tab) return setTab(k);
  if (k !== state.key && state.meta.regions.some((r) => r.key === k)) {
    if (state.tab !== "explore") setTab("explore");
    $("#region").value = k;
    loadRegion(k);
  }
});

// never leave a blank page: say what went wrong
function failed(err) {
  console.error(err);
  const b = document.querySelector("#busy");
  b.hidden = false;
  b.textContent = "Something failed to load. Try a hard refresh (Cmd+Shift+R).";
}

boot().catch(failed);
