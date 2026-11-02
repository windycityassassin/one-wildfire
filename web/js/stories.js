// Fire stories: one official fire at a time, with its record, its satellite detections in the order
// they were seen, and the ERA5 wind at the time, animated as moving particles.
// Everything shown comes from data/stories/*.json (built by pipeline/18_fire_stories.py).
/* global maplibregl */
import { setData, setVisible, applyView, isDark, setImagery } from "./mapview.js";
import { closeInspector, inspectorOpen, showTip, hideTip } from "./ui.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const fc = (features) => ({ type: "FeatureCollection", features });

export const CLASS = {
  with: { label: "with the wind", col: "#e8590c" },
  across: { label: "across the wind", col: "#9c6ade" },
  against: { label: "against the wind", col: "#2f9e44" },
  light: { label: "light wind", col: "#8a96a0" },
  none: { label: "too little spread to tell", col: "#8a96a0" },
};
const REGIONS = ["colorado_2020", "ncal_2020", "oregon_2020", "arizona_2020", "idaho_2020"];
const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const compass = (deg) => POINTS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
const SPEEDS = { slow: 10, normal: 4, fast: 1.5 };        // seconds per day of fire time on the busiest day
const FIRE_LAYERS = [];
const KM2_PER_ACRE = 0.00404686;

let ctx, S = null, phase = "during";
const cacheStories = new Map();

// fetch JSON, retrying a dropped connection once
async function getJSON(url) {
  try { return await (await fetch(url)).json(); } catch (_) {
    await new Promise((r) => setTimeout(r, 400));
    return (await fetch(url)).json();
  }
}

export function initStories(c) {
  ctx = c;
  const sel = $("#st-region");
  for (const k of REGIONS) {
    const r = ctx.meta.regions.find((q) => q.key === k);
    const o = document.createElement("option");
    o.value = k;
    o.textContent = `${r.name}, ${r.year}`;
    sel.appendChild(o);
  }
  sel.addEventListener("change", () => loadRegion(sel.value));
  $("#st-fire").addEventListener("change", (e) => selectFire(+e.target.value));
  $("#st-phase").addEventListener("click", (e) => {
    const b = e.target.closest("[data-p]");
    if (b && S && S.fire) setPhase(b.dataset.p);
  });
  $("#sw-mix").addEventListener("input", (e) => {
    const yr = S.D.year;
    setImagery(ctx.map, true, { before: yr - 1, after: yr + 1, mix: +e.target.value / 100 });
  });
  $("#st-play").addEventListener("click", () => (S && S.fire ? (S.playing ? pause() : play()) : null));
  $("#st-pp").addEventListener("click", () => (S && S.fire ? (S.playing ? pause() : play()) : null));
  $("#st-restart").addEventListener("click", () => { if (S && S.fire) { S.clock = S.t0; drawFire(true); play(); } });
  $("#st-speed").addEventListener("change", () => {});
  $("#st-seek").addEventListener("input", (e) => {
    if (!S || !S.fire) return;
    pause();
    S.clock = S.t0 + (+e.target.value / 1000) * (S.t1 - S.t0);
    drawFire(true);
  });
  ctx.map.on("mousemove", (e) => {
    if (ctx.tab() !== "stories" || !S || !S.fire) return;
    const pf = ctx.map.queryRenderedFeatures(e.point, { layers: ["origins"] });
    if (pf.length) {
      showTip(e.point, `<b>Recorded point of origin</b><br><span class="dim">from the interagency record (WFIGS)</span>`);
      return;
    }
    const a = ctx.map.queryRenderedFeatures(e.point, { layers: ["arrows"] });
    if (a.length) {
      const d = S.fire.daily[a[0].properties.day];
      showTip(e.point, dayTip(d));
      return;
    }
    hideTip();
  });
  document.addEventListener("stories:show", show);
  document.addEventListener("stories:refit", () => S && S.fire && frameFire());
  document.addEventListener("stories:hide", hide);
  window.addEventListener("resize", sizeCanvas);
}

async function show() {
  ctx.onEnter();
  if (!S) await loadRegion($("#st-region").value);
  else if (S.pending != null) await loadRegion(S.key, S.pending === "largest" ? null : S.pending);
  else if (S.fire) applyPhase();
}

function hide() {
  pause();
  stopParticles();
  showFireLayers(false);
  $("#st-info").hidden = true;
  setImagery(ctx.map, false);
  setVisible(ctx.map, ["past-fill", "past-line"], false);
  $("#st-swipe").hidden = true;
  $("#st-now").hidden = true;
  $("#st-player").hidden = true;
  closeInspector(true);
  hideTip();
  ctx.onExit();
}

// the fires of the chosen region, largest first
function fillPicker() {
  const fires = S.D.fires.slice().sort((a, b) => b.acres - a.acres);
  $("#st-fire").innerHTML = fires.map((f) => `<option value="${f.id}">${f.name} · ${f.acres.toLocaleString()} acres</option>`).join("");
}

async function loadRegion(key, fireId = null) {
  pause();
  let D = cacheStories.get(key);
  if (!D) {
    D = await getJSON(`data/stories/${key}.json`);
    cacheStories.set(key, D);
  }
  const R = ctx.cache.get(key) || (await getJSON(`data/${key}.json`));
  ctx.cache.set(key, R);
  let BA = null;
  try { BA = await getJSON(`data/stories/ba_${key}.json`); } catch (_) { BA = null; }
  S = { key, D, R, BA, fire: null, wind: null, clock: 0, playing: false };
  $("#st-region").value = key;
  fillPicker();
  // the data can arrive after the reader has moved to another tab: then leave that tab's map alone,
  // and draw when they come back (show() → drawPending)
  if (ctx.tab() !== "stories") { S.pending = fireId ?? "largest"; return; }
  closeInspector(true);
  $("#st-player").hidden = true;
  $("#st-now").hidden = true;
  setData(ctx.map, "dets", fc([]));
  setData(ctx.map, "arrows", fc([]));
  setData(ctx.map, "perims", fc([]));
  setData(ctx.map, "origins", fc([]));
  const r = ctx.meta.regions.find((q) => q.key === key);
  ctx.map.jumpTo({ center: r.center, zoom: r.zoom - (window.innerWidth < 860 ? 0.8 : 0) });
  prepMap();
  // open on the region's largest fire, so the story and its wind start straight away
  const first = fireId != null ? D.fires.find((f) => f.id === fireId) : D.fires.reduce((a, b) => (b.acres > a.acres ? b : a), D.fires[0]);
  if (first) await selectFire(first.id);
}

function fmtLocal(t, withTime = true) {
  const d = new Date(Date.UTC(S.D.year, 0, 1) + t * 86400000);
  const o = { timeZone: S.D.tz, month: "short", day: "numeric" };
  if (withTime) Object.assign(o, { hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short" });
  return d.toLocaleString("en-US", o);
}
const fmtDay = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function classOf(f) {
  return f.biggest_day.cls || "none";
}

function arrowSvg(deg, col, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="-10 -10 20 20" aria-hidden="true" style="flex:none"><g transform="rotate(${deg})"><path d="M0,-8 L4.5,2 L1.4,0.6 L1.4,8 L-1.4,8 L-1.4,0.6 L-4.5,2 Z" fill="${col}"/></g></svg>`;
}

async function selectFire(id) {
  pause();
  const f = S.D.fires.find((q) => q.id === id);
  S.fire = f;
  S.wind = null;
  $("#st-fire").value = String(id);
  S.wind = await getJSON(`data/stories/wind_${S.key}_${id}.json`);
  prevailingWind(S.wind);
  if (ctx.tab() !== "stories") { S.pending = id; return; }
  S.pending = null;
  placeWindLayer();
  S.t0 = Math.min(f.disc, f.first_det) - 0.25;
  S.t1 = f.last_det + 0.25;
  S.clock = S.t0;
  buildFireGeometry(f);
  prepMap();
  frameFire();
  setData(ctx.map, "perims", fc([S.R.perimeters.features[f.id]]));
  const o = f.origin || f.first_det_lonlat;
  setData(ctx.map, "origins", fc([{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: o } }]));
  applyPhase(true);
}

// ---------- before / during / after ----------
function setPhase(p) {
  phase = p;
  applyPhase(p === "during");
}

function applyPhase(autoplay = false) {
  $$("#st-phase button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.p === phase));
  const during = phase === "during";
  pause();
  $("#st-player").hidden = true;   // no player bar: the story plays by itself and loops
  $("#st-now").hidden = !during;
  $("#st-swipe").hidden = phase !== "after";
  prepMap();
  phaseLegend();
  if (during) {
    showFireLayers(true);
    startParticles();
    drawFire(true);
    openProfile();
    if (autoplay) play();
    return;
  }
  stopParticles();
  showFireLayers(false);
  $("#st-info").hidden = true;
  setData(ctx.map, "dets", fc([]));
  setData(ctx.map, "arrows", fc([]));
  if (phase === "before") openBefore();
  else openAfter();
}

function baFor(f) {
  return S.BA && S.BA.fires[String(f.id)];
}

function phaseLegend() {
  const yr = S.D.year;
  const perim = `<svg class="sw" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" fill="none" stroke="var(--truth)" stroke-dasharray="3 2"/></svg>`;
  const origin = `<svg class="sw" viewBox="0 0 12 12"><path d="M6 1.5v9M1.5 6h9" stroke="var(--truth)" stroke-width="2.4" stroke-linecap="round"/></svg>`;
  const key = (inner) => `<details class="key-toggle"><summary class="eyebrow">Map key</summary><div class="keybody">${inner}</div></details>`;
  if (phase === "before") {
    $("#legend").innerHTML = key(`<div class="keys"><span class="key">${perim}where it would burn</span><span class="key">${origin}where it started</span>
      <span class="key"><svg class="sw" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" fill="#f59f00" fill-opacity=".45" stroke="#f59f00"/></svg>burned before</span></div>
      <span class="note">Satellite image from ${yr - 1}, before the fire.</span>`);
  } else if (phase === "after") {
    $("#legend").innerHTML = key(`<div class="keys"><span class="key">${perim}final outline</span><span class="key">${origin}where it started</span></div>
      <span class="note">Satellite images from ${yr - 1} and ${yr + 1}.</span>`);
  } else document.dispatchEvent(new CustomEvent("stories:legend"));
}

// ERC over the 60 days before the report, against the 2000-2019 range for the same dates
function ercChart(d) {
  const w = 320, h = 150, l = 30, r = 8, t = 10, b = 22;
  const vals = [...d.erc, ...d.erc_p90, ...d.erc_p10].filter((v) => v != null);
  const max = Math.ceil(Math.max(...vals) / 10) * 10, min = Math.floor(Math.min(...vals) / 10) * 10;
  const X = (k) => l + ((w - l - r) * k) / (d.dates.length - 1);
  const Y = (v) => t + (h - t - b) * (1 - (v - min) / (max - min || 1));
  const band = d.erc_p90.map((v, k) => `${X(k)},${Y(v)}`).join(" ") + " " + d.erc_p10.map((v, k) => `${X(k)},${Y(v)}`).reverse().join(" ");
  const line = (arr) => arr.map((v, k) => (v == null ? "" : `${X(k)},${Y(v)}`)).filter(Boolean).join(" ");
  let grid = "";
  for (let g = min; g <= max; g += (max - min) / 4) grid += `<line x1="${l}" x2="${w - r}" y1="${Y(g)}" y2="${Y(g)}" style="stroke:var(--line)"/><text x="${l - 4}" y="${Y(g) + 3}" text-anchor="end">${Math.round(g)}</text>`;
  const last = d.erc.length - 1;
  return `<div class="minichart"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Fire danger before the fire">${grid}
    <polygon points="${band}" style="fill:var(--truth);fill-opacity:.16"/>
    <polyline points="${line(d.erc_p50)}" style="fill:none;stroke:var(--truth);stroke-width:1;stroke-dasharray:3 2"/>
    <polyline points="${line(d.erc)}" style="fill:none;stroke:var(--fire);stroke-width:2"/>
    ${d.erc[last] != null ? `<circle cx="${X(last)}" cy="${Y(d.erc[last])}" r="3.5" style="fill:var(--fire)"/>` : ""}
    <text x="${l}" y="${h - 6}">${fmtDay(d.dates[0])}</text><text x="${w - r}" y="${h - 6}" text-anchor="end">${fmtDay(d.dates[last])} (reported)</text>
  </svg></div>
  <div class="keys" style="display:flex;flex-wrap:wrap;gap:4px 12px;font-size:11.5px;color:var(--muted)">
    <span><b style="color:var(--fire)">—</b> ${S.D.year}</span><span><b style="color:var(--truth)">┄</b> ${d.clim_years[0]}–${d.clim_years[1]} median</span><span><b style="color:var(--truth);opacity:.5">█</b> middle 80% of those years</span></div>`;
}

function openBefore() {
  const f = S.fire, B = baFor(f), yr = S.D.year;
  setImagery(ctx.map, true, { before: yr - 1 });
  setData(ctx.map, "past", fc((B && B.history.shapes) || []));
  setVisible(ctx.map, ["past-fill", "past-line"], true);
  if (!B) {
    renderCard({ label: "Before the fire", eyebrow: f.name, title: "Before the fire", body: `<p class="note">The before-and-after data for this region is still being prepared.</p>` });
    return;
  }
  const d = B.danger, last = d.erc.length - 1;
  const hot7 = d.erc.slice(-8, -1).filter((v, k) => v != null && d.erc_p90[last - 7 + k] != null && v > d.erc_p90[last - 7 + k]).length;
  const H = B.history;
  const past = H.fires.filter((p) => p.overlap_pct > 0);
  renderCard({
    label: "Before the fire", eyebrow: f.name, title: "How ready was it to burn?",
    body: `
      ${ercChart(d)}
      <div class="callout">When it was reported, fire danger was <b>${d.erc[last]}</b>, ${d.erc_pct[last] >= 99 ? "<b>higher than on that date in any year</b>" : `higher than on that date in <b>${d.erc_pct[last]}%</b> of years`} since ${d.clim_years[0]}. It was above the usual range on <b>${hot7} of the 7 days</b> before.</div>
      <h3 class="h3"><span>Had this ground burned before?</span></h3>
      ${past.length ? `<p class="note"><b>${H.burned_before_pct}%</b> of it had, in earlier recorded fires (amber on the map).</p>
        <div>${past.slice(0, 3).map((p) => `<div class="past-row"><span><b>${p.name}</b> · ${p.year}</span><span class="mono">${p.overlap_pct < 0.1 ? "<0.1" : p.overlap_pct}%</span></div>`).join("")}</div>`
        : `<p class="note">No earlier fire on record overlaps this area.</p>`}
      <details class="more"><summary>Where this comes from</summary>
        <p class="note"><b>Fire danger:</b> the Energy Release Component (ERC) that fire managers use for how dry the fuels are, from gridMET (Abatzoglou 2013), daily, about 4 km, fuel model G, at the point of origin. Each day is ranked against the same calendar day in ${d.clim_years[0]}–${d.clim_years[1]}.${d.fm100[last] != null ? ` 100-hour dead fuel moisture on the day it was reported: ${d.fm100[last]}% (lower is drier).` : ""}</p>
        <p class="note"><b>Earlier fires:</b> NIFC Interagency Fire Perimeter History (records from ${H.first_year}). Older records are less complete.</p>
        <p class="note"><b>Imagery:</b> Sentinel-2 cloudless mosaic for ${yr - 1} (EOX).</p>
      </details>`,
  });
}

// summer greenness inside the burn and on nearby unburned land
function ndviChart(n, fireT) {
  const w = 320, h = 150, l = 34, r = 8, t = 10, b = 22;
  const vals = [...n.inside, ...n.outside].filter((v) => v != null && !isNaN(v));
  const min = Math.floor(Math.min(...vals) * 10) / 10, max = Math.ceil(Math.max(...vals) * 10) / 10;
  const y0 = n.years[0], y1 = n.years[n.years.length - 1];
  const X = (y) => l + ((w - l - r) * (y - y0)) / (y1 - y0);
  const Y = (v) => t + (h - t - b) * (1 - (v - min) / (max - min || 1));
  const line = (arr, col, dash) => `<polyline points="${arr.map((v, k) => `${X(n.years[k])},${Y(v)}`).join(" ")}" style="fill:none;stroke:${col};stroke-width:2;${dash ? "stroke-dasharray:4 3" : ""}"/>` +
    arr.map((v, k) => `<circle cx="${X(n.years[k])}" cy="${Y(v)}" r="2.6" style="fill:${col}"><title>${n.years[k]}: ${v}</title></circle>`).join("");
  let grid = "";
  for (let g = min; g <= max + 1e-9; g += 0.1) grid += `<line x1="${l}" x2="${w - r}" y1="${Y(g)}" y2="${Y(g)}" style="stroke:var(--line)"/><text x="${l - 4}" y="${Y(g) + 3}" text-anchor="end">${g.toFixed(1)}</text>`;
  const fx = X(S.D.year + fireT / 365 - 0.53);   // each year's point is its mid-July composite (~0.53 of the way through the year)
  return `<div class="minichart"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Greenness before and after the fire">${grid}
    <line x1="${fx}" x2="${fx}" y1="${t}" y2="${h - b}" style="stroke:var(--fire);stroke-width:1.5;stroke-dasharray:2 2"/><text x="${fx + 3}" y="${t + 9}" style="fill:var(--fire)">fire</text>
    ${line(n.outside, "var(--muted)", true)}${line(n.inside, "var(--good)")}
    ${n.years.map((y) => `<text x="${X(y)}" y="${h - 6}" text-anchor="middle">${String(y).slice(2)}</text>`).join("")}
  </svg></div>
  <div style="display:flex;flex-wrap:wrap;gap:4px 12px;font-size:11.5px;color:var(--muted)"><span><b style="color:var(--good)">—</b> inside the burn</span><span><b>┄</b> unburned land 1–5 km outside</span><span>mid-July each year</span></div>`;
}

function openAfter() {
  const f = S.fire, B = baFor(f), yr = S.D.year;
  $("#sw-mix").value = 100;
  $("#sw-left").textContent = `${yr - 1} · before`;
  $("#sw-right").textContent = `${yr + 1} · after`;
  $("#sw-note").textContent = "Sentinel-2 cloudless mosaics (EOX). Burned forest shows as brown or grey inside the dashed line.";
  setImagery(ctx.map, true, { before: yr - 1, after: yr + 1, mix: 1 });
  setVisible(ctx.map, ["past-fill", "past-line"], false);
  const containDays = f.contain != null ? Math.round(f.contain - f.disc) : null;
  let rec = "";
  if (B) {
    const n = B.ndvi;
    const doy = f.disc;                      // day of year (UTC) of the report
    const firstIdx = n.years.indexOf(doy < 192 ? yr : yr + 1);
    const diff = n.inside.map((v, k) => v - n.outside[k]);
    const preIdx = n.years.map((y, k) => (y < yr || (y === yr && doy > 208) ? k : -1)).filter((k) => k >= 0);
    const pre = preIdx.reduce((a, k) => a + diff[k], 0) / preIdx.length;
    const after1 = diff[firstIdx], lastD = diff[diff.length - 1];
    const regained = pre - after1 > 0.02 ? Math.round(((lastD - after1) / (pre - after1)) * 100) : null;
    rec = `
      <h3 class="h3"><span>Did it green up again?</span></h3>
      ${ndviChart(n, f.disc)}
      <div class="callout">${regained != null ? `The burn lost much of its summer greenness, and by ${n.years[n.years.length - 1]} it had won back <b>${Math.max(0, Math.min(100, regained))}%</b> of what it lost, compared with the land around it.` : "Its summer greenness changed little compared with the land around it."}</div>
      <p class="note">Green isn't always recovery: invasive grasses green up fast too, which drone surveys can tell apart on the ground.</p>`;
  }
  renderCard({
    label: "After the fire", eyebrow: f.name, title: "What it left behind",
    body: `
      <dl class="kv">
        <dt>Final size</dt><dd>${f.acres.toLocaleString()} acres</dd>
        <dt>Contained</dt><dd>${containDays != null ? `${containDays} days after it was reported` : "not recorded"}</dd>
      </dl>
      <p class="note">Drag the slider at the bottom of the map to compare ${yr - 1} and ${yr + 1}.</p>
      ${rec || `<p class="note">The recovery data for this region is still being prepared.</p>`}
      <details class="more"><summary>Where this comes from</summary>
        <p class="note"><b>Greenness:</b> MODIS MOD13Q1 NDVI (250 m), mid-July composites each year, from the ORNL DAAC MODIS web service, averaged inside the final perimeter and over a ring 1–5 km outside it.</p>
        <p class="note"><b>Imagery:</b> Sentinel-2 cloudless mosaics for ${yr - 1} and ${yr + 1} (EOX).</p>
      </details>`,
  });
}

// fit the fire on screen; tilted when the satellite 3D view is on
function frameFire() {
  const [w, s, e, n] = S.fire.bbox;
  const wide = window.innerWidth >= 860;
  const tilt = ($("#viewseg [aria-pressed=true]") || {}).dataset?.v === "sat3d";
  ctx.map.fitBounds([[w, s], [e, n]], {
    padding: wide ? { top: 70, bottom: 150, left: 60, right: inspectorOpen() ? 400 : 60 } : 40, maxZoom: 11, duration: 900,
    pitch: tilt ? 55 : 0, bearing: tilt ? -15 : 0,
  });
}

function prepMap() {
  const v = ($("#viewseg [aria-pressed=true]") || {}).dataset?.v;
  applyView(ctx.map, v === "sat3d" ? "sat3d" : "map", { keepCamera: true });
  setImagery(ctx.map, false);
  setVisible(ctx.map, ["past-fill", "past-line"], false);
  setVisible(ctx.map, ["hulls-fill", "hulls-line", "ign", "cube", "links-on", "links-off", "links-hit", "focus-line"], false);
  setVisible(ctx.map, ["dets"], false);
  setVisible(ctx.map, ["arrows", "arrowheads"], false);
  setVisible(ctx.map, ["perims-fill", "perims-line", "origins"], true);
}

// ---------- the fire, as of the clock ----------
// Built once per fire: each detection's 1 km grid cell (a thermal image of the ground) as a rectangle on the
// wind canvas, and the running area of cells seen burning. Each frame then paints the cells onto that canvas,
// so the work is the same however many cells change (per-feature map updates stalled at each satellite pass).
const CELL_GAP = 0.04;   // km between cells, so the grid reads as pixels
function buildFireGeometry(f) {
  const R = S.R;
  const lat0 = f.bbox[1], kx = 111.32 * Math.cos((lat0 * Math.PI) / 180);
  const index = new Map();
  S.cells = [];
  S.cellOf = [];
  S.times = [];
  S.appear = [];
  S.frpF = [];
  S.cumKm2 = [];
  const h = 0.5 - CELL_GAP / 2;
  for (const i of f.det) {
    const lon = R.det.lon[i], lat = R.det.lat[i], t = R.det.t[i], frp = R.det.frp[i];
    const cx = Math.round(lon * kx), cy = Math.round(lat * 110.57), key = cx + ":" + cy;
    if (!index.has(key)) {
      const [x0, y0] = canvasXY((cx - h) / kx, (cy + h) / 110.57), [x1, y1] = canvasXY((cx + h) / kx, (cy - h) / 110.57);
      index.set(key, S.cells.length);
      S.cells.push([x0, y0, x1 - x0, y1 - y0]);
    }
    S.cellOf.push(index.get(key));
    S.times.push(t);
    S.frpF.push(lerp(frp, [0, 50, 300], [0.55, 0.8, 1]));
    S.cumKm2.push(index.size);
  }
  // Satellites pass only about four times a day, so each square is faded in between the previous pass
  // (when it wasn't burning yet, as far as we know) and the pass that saw it, at most 12 hours earlier.
  // Without this the fire would freeze between passes and jump at each one.
  let prev = S.times[0] - 0.25, passStart = S.times[0];
  for (let k = 0; k < S.times.length; k++) {
    const t = S.times[k];
    if (t - passStart > 0.02) { prev = S.times[k - 1]; passStart = t; }
    S.appear.push(Math.max(prev, t - 0.5));
  }
  S.cellHeat = new Float32Array(S.cells.length);
  S.kx = kx;
  S.finalKm2 = Math.round(f.acres * KM2_PER_ACRE);
  S.maxNew = Math.max(1, ...f.daily.map((d) => d.new));
  S.utcOff = utcOffsetHours(S.D.tz, S.D.year, f.disc);
}

function utcOffsetHours(tz, year, t) {
  const d = new Date(Date.UTC(year, 0, 1) + t * 86400000);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
  let off = ((+p.hour % 24) + +p.minute / 60) - (d.getUTCHours() + d.getUTCMinutes() / 60);
  if (off > 12) off -= 24;
  if (off < -12) off += 24;
  return off;
}

function showFireLayers(on) {
  setVisible(ctx.map, FIRE_LAYERS, on);
  if (!on && ctx.map.getLayer("eox")) { ctx.map.setPaintProperty("eox", "raster-brightness-max", 1); if (S) S.bright = 1; }
}

// how many detections have been seen by time t (times are sorted)
function countBy(t) {
  const a = S.times;
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= t) lo = m + 1; else hi = m; }
  return lo;
}

// 0 at night, 1 in daylight, with an hour and a half of dawn and dusk
function daylight(t) {
  const h = (((t % 1) * 24 + S.utcOff) % 24 + 24) % 24;
  const c = (x) => Math.min(1, Math.max(0, x));
  return Math.min(c((h - 5.25) / 1.5), c((20.25 - h) / 1.5));
}

// piecewise-linear lookup
function lerp(x, xs, ys) {
  if (x <= xs[0]) return ys[0];
  for (let k = 1; k < xs.length; k++) if (x <= xs[k]) return ys[k - 1] + ((ys[k] - ys[k - 1]) * (x - xs[k - 1])) / (xs[k] - xs[k - 1]);
  return ys[ys.length - 1];
}
const AGE_X = [0, 0.25, 0.6, 1.2, 3, 6], AGE_Y = [1, 0.75, 0.45, 0.22, 0.07, 0];

// colour and opacity for each of 48 heat levels: dark red (burned) through orange and yellow to near white
const HEAT_STYLES = Array.from({ length: 48 }, (_, k) => {
  const h = k / 47;
  const stops = [[0, "#3a1610"], [0.07, "#5c160d"], [0.2, "#991b0c"], [0.4, "#e0360a"], [0.6, "#ff7d00"], [0.8, "#ffc233"], [1, "#fff6d5"]];
  let j = 1;
  while (j < stops.length - 1 && h > stops[j][0]) j++;
  const [ha, ca] = stops[j - 1], [hb, cb] = stops[j], u = Math.min(1, Math.max(0, (h - ha) / (hb - ha)));
  const rgb = [1, 3, 5].map((o) => Math.round(parseInt(ca.slice(o, o + 2), 16) * (1 - u) + parseInt(cb.slice(o, o + 2), 16) * u));
  return `rgba(${rgb.join(",")},${lerp(h, [0, 0.3, 1], [0.62, 0.9, 1]).toFixed(3)})`;
});

// heat of each cell at time t (the hottest of its detections): warming up between the previous pass and the
// pass that saw it, hottest when first seen (and for the most intense detections), then cooling over a few
// days to 0, the dark red of burned ground
function drawCells(g, t) {
  const C = S.cellHeat.fill(-1);
  for (let k = 0; k < S.times.length; k++) {
    const t0 = S.appear[k];
    if (t < t0) continue;
    const t1 = S.times[k];
    const h = t < t1 ? S.frpF[k] * (0.2 + 0.8 * ((t - t0) / (t1 - t0 || 1))) : S.frpF[k] * lerp(t - t1, AGE_X, AGE_Y);
    if (h > C[S.cellOf[k]]) C[S.cellOf[k]] = h;
  }
  const paths = new Array(HEAT_STYLES.length);
  for (let c = 0; c < C.length; c++) {
    if (C[c] < 0) continue;
    const lv = Math.min(47, Math.round(C[c] * 47));
    const r = S.cells[c];
    (paths[lv] || (paths[lv] = new Path2D())).rect(r[0], r[1], r[2], r[3]);
  }
  paths.forEach((p, lv) => { if (p) { g.fillStyle = HEAT_STYLES[lv]; g.fill(p); } });
}

let lastHud = 0;
function drawFire(force = false) {
  if (!S || !S.fire || !S.times) return;
  const map = ctx.map, f = S.fire, t = S.clock;
  // the clock in the sidebar moves with the map, every frame
  const ht = $("#st-now .hud-time b");
  if (ht) ht.textContent = fmtLocal(t);
  const hs = $("#st-now .hud-sun");
  if (hs) hs.textContent = daylight(t) > 0.5 ? "☀" : "☾";

  const now = performance.now();
  if (!force && now - lastHud < 200) return;
  lastHud = now;
  const n = countBy(t);
  // readout
  const g = growth(t, n);
  const km2 = n ? S.cumKm2[n - 1] : 0;
  const day = Math.max(1, Math.floor(t - f.disc) + 1);
  const sun = daylight(t) > 0.5;
  const w = pointWind(t);
  $("#st-hud").innerHTML = `
    <div class="hud-time"><span class="hud-sun" aria-hidden="true">${sun ? "☀" : "☾"}</span><b>${fmtLocal(t)}</b></div>
    <div class="hud-line">${t < f.disc ? "Before the report" : `Day ${day}`} · <b>${n.toLocaleString()}</b> detections</div>
    <div class="hud-area"><span><b>≈ ${km2.toLocaleString()} km²</b> seen burning</span><span class="note">final: ${S.finalKm2.toLocaleString()} km²</span></div>
    <div class="hud-bar"><i style="width:${Math.min(100, (100 * km2) / Math.max(1, S.finalKm2)).toFixed(1)}%"></i></div>
    ${g ? `<div class="hud-grow">${arrowSvg(g.deg, "var(--fire)", 22)}<span><b>Growing toward ${compass(g.deg)}</b>${windRel(g.deg, w)}</span></div>`
        : n ? `<div class="hud-line">Not spreading much right now</div>` : ""}
    ${w ? `<div class="hud-wind">${arrowSvg((w.dir + 180) % 360, "var(--truth)", 16)}<span>Prevailing wind from ${compass(w.dir)} · ${w.speed} km/h (24-hour average)</span></div>` : ""}`;
}

// Which way is it growing? From the centre of everything that burned before the last 18 hours to the
// centre of the new heat in those 18 hours (the same idea as the daily spread figures, but continuous).
const GROW_WINDOW = 0.75;
function growth(t, n) {
  const R = S.R, f = S.fire;
  let ax = 0, ay = 0, an = 0, bx = 0, by = 0, bn = 0;
  for (let k = 0; k < n; k++) {
    const i = f.det[k];
    if (S.times[k] < t - GROW_WINDOW) { ax += R.det.lon[i]; ay += R.det.lat[i]; an++; }
    else { bx += R.det.lon[i]; by += R.det.lat[i]; bn++; }
  }
  if (bn < 3) return null;
  const from = an ? [ax / an, ay / an] : (f.origin || f.first_det_lonlat);
  const to = [bx / bn, by / bn];
  const dx = (to[0] - from[0]) * S.kx, dy = (to[1] - from[1]) * 110.57;
  const km = Math.hypot(dx, dy);
  if (km < 1) return null;
  return { from, to, km, deg: ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360 };
}

// is it running with the wind? (same thresholds as the daily labels)
function windRel(deg, w) {
  if (!w || w.speed < 10) return "";
  const down = (w.dir + 180) % 360;
  const a = Math.abs(((deg - down + 540) % 360) - 180);
  const c = a <= 45 ? "with" : a <= 135 ? "across" : "against";
  return ` <span style="color:${CLASS[c].col};font-weight:600">· ${CLASS[c].label}</span>`;
}

// Prevailing wind: over a rolling 24 hours, the direction the air moved on balance and the average wind speed.
// Mountain winds often turn a full circle each day and drop to calm overnight; with a day passing every few
// seconds in playback, the hourly wind made the streaks spin and stall every few seconds. (Averaging speed as
// part of the direction would cancel most of it and leave the streaks crawling.)
const PREVAIL_H = 12;   // hours either side
function prevailingWind(W) {
  if (W.du) return;
  const nn = W.lons.length * W.lats.length, n = W.n;
  W.du = new Float32Array(n * nn);
  W.dv = new Float32Array(n * nn);
  for (let k = 0; k < nn; k++) {
    let su = 0, sv = 0, ss = 0, lo = 0, hi = -1;
    const sp = (h) => Math.hypot(W.u[h * nn + k], W.v[h * nn + k]);
    for (let h = 0; h < n; h++) {
      while (hi < Math.min(n - 1, h + PREVAIL_H)) { hi++; su += W.u[hi * nn + k]; sv += W.v[hi * nn + k]; ss += sp(hi); }
      while (lo < h - PREVAIL_H) { su -= W.u[lo * nn + k]; sv -= W.v[lo * nn + k]; ss -= sp(lo); lo++; }
      const len = Math.hypot(su, sv), c = hi - lo + 1;
      const f = len > 1e-6 ? (ss / c / len) * W.scale : 0;    // unit direction × mean speed
      W.du[h * nn + k] = su * f;
      W.dv[h * nn + k] = sv * f;
    }
  }
  // the same at the fire's starting point, for the readout
  const m = W.speed.length;
  W.pSpeed = new Array(m).fill(null); W.pDir = new Array(m).fill(null); W.pGust = new Array(m).fill(null);
  for (let h = 0; h < m; h++) {
    let u = 0, v = 0, c = 0, sum = 0, gust = null;
    for (let j = Math.max(0, h - PREVAIL_H); j <= Math.min(m - 1, h + PREVAIL_H); j++) {
      if (W.speed[j] == null) continue;
      const r = (W.dir[j] * Math.PI) / 180;               // the direction it blows from
      u -= W.speed[j] * Math.sin(r); v -= W.speed[j] * Math.cos(r); c++; sum += W.speed[j];
      if (W.gust[j] != null) gust = Math.max(gust ?? 0, W.gust[j]);
    }
    if (!c) continue;
    W.pSpeed[h] = Math.round(sum / c);
    W.pDir[h] = Math.round(((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360);
    W.pGust[h] = gust != null ? Math.round(gust) : null;
  }
}

function pointWind(t) {
  const W = S.wind;
  if (!W || !W.pSpeed) return null;
  const h = Math.round((t - W.pt0) * 24);
  if (h < 0 || h >= W.pSpeed.length || W.pSpeed[h] == null) return null;
  return { speed: W.pSpeed[h], dir: W.pDir[h], gust: W.pGust[h] };
}

// ---------- timeline: new detections per local day, coloured by how the day's spread met the wind ----------
function buildTimeline() {
  const f = S.fire;
  const span = S.t1 - S.t0;
  const max = Math.max(...f.daily.map((d) => d.new));
  const bars = f.daily.map((d, k) => {
    const x = ((d.start - S.t0) / span) * 100, w = (1 / span) * 100;
    const h = Math.max(1.5, (Math.sqrt(d.new) / Math.sqrt(max)) * 28);
    const col = d.class ? CLASS[d.class].col : "var(--line)";
    return `<rect class="day" data-k="${k}" x="${Math.max(0, x + w * 0.08).toFixed(3)}" y="${(30 - h).toFixed(2)}" width="${(w * 0.84).toFixed(3)}" height="${h.toFixed(2)}" style="fill:${col}"><title>${fmtDay(d.date)}: ${d.new} new detections${d.class ? " · " + CLASS[d.class].label : ""}</title></rect>`;
  }).join("");
  const disc = ((S.fire.disc - S.t0) / span) * 100;
  $("#st-hist").innerHTML = `<svg viewBox="0 0 100 30" preserveAspectRatio="none">${bars}
    <line x1="${disc}" x2="${disc}" y1="0" y2="30" style="stroke:var(--truth);stroke-width:.35;stroke-dasharray:1 .8" vector-effect="non-scaling-stroke"/>
    <rect id="st-cursor" x="0" y="0" width=".25" height="30" style="fill:var(--ink)"/></svg>`;
  $$("#st-hist rect.day").forEach((el) => el.addEventListener("click", () => jumpToDay(+el.dataset.k)));
  $("#st-t0").textContent = fmtLocal(S.t0, false);
  $("#st-t1").textContent = fmtLocal(S.t1, false);
}

function jumpToDay(k) {
  S.clock = Math.max(S.t0, S.fire.daily[k].start);
  drawFire(true);
  highlightDay(k);
  play();
}

function highlightDay(k) {
  $$("#st-info-body .day-row").forEach((el) => el.classList.toggle("sel", +el.dataset.k === k));
  const el = $(`#st-info-body .day-row[data-k="${k}"]`);
  if (el) el.scrollIntoView({ block: "nearest" });
}

// ---------- profile card ----------
function dayTip(d) {
  let s = `<b>${fmtDay(d.date)}</b> · ${d.new} new detections`;
  if (d.spread_km != null) s += `<br>centre moved ${d.spread_km} km toward ${compass(d.spread_to_deg)}`;
  if (d.wind) s += `<br>burning-period wind from ${compass(d.wind.from_deg)}, ${d.wind.speed} km/h (gusts ${d.wind.gust})`;
  if (d.class) s += `<br><b style="color:${CLASS[d.class].col}">${CLASS[d.class].label}</b>${d.angle_to_wind != null ? ` · ${d.angle_to_wind}° off downwind` : ""}`;
  return s;
}

// detections from the satellites' night passes, by local day (Balch, ... Cattau et al. 2022 on the night-time barrier)
function nightByDay(f) {
  const out = new Array(f.daily.length).fill(0);
  let k = 0;
  for (const i of f.det) {
    const t = S.R.det.t[i];
    while (k < f.daily.length - 1 && t >= f.daily[k].end) k++;
    if (S.R.det.night[i]) out[k]++;
  }
  return out;
}

function openProfile() {
  const f = S.fire;
  const nights = nightByDay(f);
  const nNights = nights.filter((v) => v > 0).length;
  const nightDets = nights.reduce((x, y) => x + y, 0);
  const c = classOf(f), bd = f.biggest_day;
  const ws = f.wind_at_start;
  const lag = (f.first_det - f.disc) * 24;
  const containDays = f.contain != null ? Math.round(f.contain - f.disc) : null;
  const m = S.D.method;
  const days = f.daily.filter((d) => d.new >= 3);
  const body = renderCard({
    eyebrow: `Fire story · ${f.state || ""} ${S.D.year}${f.complex ? " · " + f.complex : ""}`,
    title: f.name,
    body: `
      <dl class="kv">
        <dt>Reported</dt><dd>${fmtLocal(f.disc)}</dd>
        <dt>Point of origin</dt><dd>${f.origin ? `${f.origin[1].toFixed(4)}, ${f.origin[0].toFixed(4)}` : "not recorded"}</dd>
        <dt>Cause</dt><dd>${f.cause}</dd>
        ${f.fuel ? `<dt>Main fuel</dt><dd>${f.fuel}</dd>` : ""}
        <dt>Final size</dt><dd>${f.acres.toLocaleString()} acres</dd>
        <dt>Contained</dt><dd>${containDays != null ? `${fmtLocal(f.contain, false)} (${containDays} days)` : "not recorded"}</dd>
        <dt>First seen from orbit</dt><dd>${Math.abs(lag) < 1 ? "within an hour of the report" : lag > 0 ? Math.round(lag) + " h after the report" : Math.round(-lag) + " h before the report"}</dd>
        <dt>Satellite detections</dt><dd>${f.n_det.toLocaleString()} over ${f.daily.length} days</dd>
        <dt>Still burning at night</dt><dd>${nNights} of ${f.daily.length} days (${Math.round((100 * nightDets) / f.n_det)}% of detections)</dd>
      </dl>
      ${f.origin ? "" : `<p class="note">No point of origin in the record; the map marks the first satellite detection instead.</p>`}
      <div class="callout">
        ${ws ? `<b>Wind when it was reported:</b> from ${compass(ws.from_deg)} (${ws.from_deg}°) at ${ws.speed} km/h, gusts ${ws.gust} km/h.<br>` : ""}
        ${c === "none" ? `<b>Biggest day</b> (${fmtDay(bd.date)}, ${bd.new} new detections): too little movement to give the spread a direction.`
          : `<b>Biggest day, ${fmtDay(bd.date)}:</b> ${bd.new} new detections${bd.spread_km != null ? `, centre moved ${bd.spread_km} km toward ${compass(bd.spread_to_deg)}` : ""}. Burning-period wind from ${compass(bd.wind.from_deg)} at ${bd.wind.speed} km/h (gusts ${bd.wind.gust}). <b style="color:${CLASS[c].col}">${CLASS[c].label[0].toUpperCase() + CLASS[c].label.slice(1)}</b>${bd.angle != null ? `, ${bd.angle}° off downwind` : ""}.`}
        ${f.share_with_wind != null ? `<br>On days with measurable spread, ${Math.round(f.share_with_wind * 100)}% of new detections came on days it spread with the wind.` : ""}
      </div>
      <h3 class="h3"><span>Day by day</span><span class="hint">click a day</span></h3>
      <div class="days">
        <div class="day-row head"><span>Day</span><span>New</span><span title="detections from night passes">Night</span><span>Spread</span><span>Wind</span></div>
        ${days.map((d) => {
          const k = f.daily.indexOf(d);
          return `<div class="day-row" data-k="${k}">
            <span>${fmtDay(d.date)}</span><span class="mono">${d.new}</span><span class="mono">${nights[k] ? "☾ " + nights[k] : "–"}</span>
            <span>${d.spread_km != null && d.spread_km >= m.min_spread_km ? `${arrowSvg(d.spread_to_deg, d.class ? CLASS[d.class].col : "var(--muted)", 14)} ${d.spread_km} km` : `<span class="note">–</span>`}</span>
            <span>${d.wind ? `${arrowSvg(d.wind.to_deg, "var(--truth)", 14)} ${d.wind.speed}` : "–"}</span>
          </div>`;
        }).join("")}
      </div>
      <details class="more"><summary>Where this comes from</summary>
        <p class="note"><b>Record:</b> WFIGS interagency fire perimeters (NIFC): name, discovery time, point of origin, cause, fuel group, containment.</p>
        <p class="note"><b>Spread:</b> NASA MODIS active-fire detections (Terra and Aqua, about four passes a day). On the map, each new square fades in between the previous pass and the pass that saw it, so the growth plays smoothly; the satellite only confirmed it at that pass. Each day's arrow runs from the centre of everything detected before that day to the centre of that day's new detections (day one starts at the recorded origin). It shows where the fire grew, not the exact fire front.</p>
        <p class="note"><b>Night:</b> detections from the satellites' night passes (about 22:30 and 01:30 local). Nights used to slow or stop fires; Balch, …, Cattau et al. (2022, <i>Nature</i>) found warming is weakening that night-time barrier.</p>
        <p class="note"><b>Wind:</b> ERA5 reanalysis (ECMWF) via the Open-Meteo archive, hourly, 10 m above ground, on a grid of about 25 km. It smooths out terrain and does not include winds the fire made itself; gusts on ridges were often stronger. On the map and in the readout it is the prevailing wind, a rolling 24-hour average, because mountain winds often turn a full circle each day and a day passes in seconds here. Streak speed is scaled for visibility.</p>
        <p class="note"><b>Labels:</b> a day is classed only if its centre moved at least ${m.min_spread_km} km with at least ${m.min_new} new detections. Its wind is averaged over the ${m.burn_hours[0]}:00–${m.burn_hours[1]}:00 local burning period. Under ${m.light_wind_kmh} km/h counts as light wind; otherwise the spread is <i>with</i> the wind within 45° of downwind, <i>across</i> it at 45–135°, and <i>against</i> it beyond 135°.</p>
      </details>`,
  });
  body.querySelectorAll(".day-row[data-k]").forEach((el) => el.addEventListener("click", () => jumpToDay(+el.dataset.k)));
}

// the fire's details live in a collapsed card on the map, like the map key, opened with a click
function renderCard({ eyebrow, title, body, label = "Fire details" }) {
  $("#st-info summary").textContent = label;
  $("#st-info-body").innerHTML = `<span class="eyebrow">${eyebrow}</span><h3 class="mc-title">${title}</h3>${body}`;
  $("#st-info").hidden = false;
  return $("#st-info-body");
}

// ---------- playback ----------
let rafId = 0, lastT = 0;
function play() {
  if (!S || !S.fire) return;
  if (S.clock >= S.t1) S.clock = S.t0;
  S.playing = true;
  $("#st-play").textContent = "Pause";
  $("#st-pp").textContent = "Pause";
  lastT = performance.now();
}
function pause() {
  if (S) { S.playing = false; clearTimeout(S.loop); }
  if ($("#st-pp")) $("#st-pp").textContent = "Play";
  const b = $("#st-play");
  if (b) b.textContent = "Play";
}

// ---------- wind particles ----------
// The particles are drawn into an off-screen canvas that the map shows as a layer under the place
// names, the perimeter and the fire, so the wind sits in the background of the map.
let particles = [], animating = false, cv = null, wv = null, area = null;
const WIND_W = 1400;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

function sizeCanvas() {}

// lon/lat to a pixel on the wind canvas (Web Mercator, like the map)
function canvasXY(lon, lat) {
  return [((lon - area.w) / (area.e - area.w)) * cv.width, ((area.yn - mercY(lat)) / (area.yn - area.ys)) * cv.height];
}

// cover the fire and a wide margin around it with the wind layer
function placeWindLayer() {
  const map = ctx.map;
  const [w0, s0, e0, n0] = S.fire.bbox;
  const pad = Math.max(0.3, (e0 - w0) * 0.6, (n0 - s0) * 0.6);
  const w = w0 - pad, e = e0 + pad, s = s0 - pad * 0.8, n = n0 + pad * 0.8;
  const H = Math.min(1600, Math.round((WIND_W * (mercY(n) - mercY(s))) / (((e - w) * Math.PI) / 180)));
  if (!cv) { cv = document.createElement("canvas"); wv = document.createElement("canvas"); }
  cv.width = wv.width = WIND_W;
  cv.height = wv.height = H;
  area = { w, e, s, n, H, yn: mercY(n), ys: mercY(s) };
  particles = [];
  const coords = [[w, n], [e, n], [e, s], [w, s]];
  const src = map.getSource("windcv");
  if (src) {
    src.setCoordinates(coords);
  } else {
    map.addSource("windcv", { type: "canvas", canvas: cv, coordinates: coords, animate: true });
    // one layer for the fire cells and the wind, above the faint perimeter fill and below its dashed line
    map.addLayer({ id: "wind", type: "raster", source: "windcv", paint: { "raster-opacity": 1, "raster-fade-duration": 0 } }, "perims-line");
  }
  map.setLayoutProperty("wind", "visibility", "visible");
}

function startParticles() {
  if (animating) return;
  animating = true;
  if (ctx.map.getLayer("wind") && S && S.fire) ctx.map.setLayoutProperty("wind", "visibility", "visible");
  rafId = requestAnimationFrame(frame);
}
function stopParticles() {
  animating = false;
  cancelAnimationFrame(rafId);
  if (ctx.map.getLayer("wind")) ctx.map.setLayoutProperty("wind", "visibility", "none");
  if (cv) { cv.getContext("2d").clearRect(0, 0, cv.width, cv.height); wv.getContext("2d").clearRect(0, 0, wv.width, wv.height); }
  particles = [];
}

// The prevailing-wind grid at the story clock, interpolated between hours, worked out once per frame.
let smooth = null;
function updateWind(dt) {
  const W = S.wind, nn = W.lons.length * W.lats.length;
  if (!smooth || smooth.wind !== S.wind) smooth = { wind: S.wind, u: new Float32Array(nn), v: new Float32Array(nn) };
  const fh = Math.min(W.n - 1.0001, Math.max(0, (S.clock - W.t0) * 24));
  const h = Math.floor(fh), ah = fh - h;
  for (let k = 0; k < nn; k++) {
    smooth.u[k] = (1 - ah) * W.du[h * nn + k] + ah * W.du[(h + 1) * nn + k];
    smooth.v[k] = (1 - ah) * W.dv[h * nn + k] + ah * W.dv[(h + 1) * nn + k];
  }
}

// bilinear wind (km/h, east and north components) at a point, from the smoothed grid
function windAt(lon, lat) {
  const W = S.wind;
  const nx = W.lons.length, ny = W.lats.length;
  const fx = Math.min(nx - 1.0001, Math.max(0, ((lon - W.lons[0]) / (W.lons[nx - 1] - W.lons[0])) * (nx - 1)));
  const fy = Math.min(ny - 1.0001, Math.max(0, ((lat - W.lats[0]) / (W.lats[ny - 1] - W.lats[0])) * (ny - 1)));
  const i = Math.floor(fx), j = Math.floor(fy), ax = fx - i, ay = fy - j;
  const at = (arr) => (1 - ay) * ((1 - ax) * arr[j * nx + i] + ax * arr[j * nx + i + 1]) + ay * ((1 - ax) * arr[(j + 1) * nx + i] + ax * arr[(j + 1) * nx + i + 1]);
  return [at(smooth.u), at(smooth.v)];
}

function frame(now) {
  if (!animating) return;
  rafId = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  if (S && S.fire && S.playing) {
    // one steady speed (varying it, or dimming for night, read as the animation stopping and starting)
    S.clock += dt / SPEEDS[$("#st-speed").value];
    // at the end, hold the finished fire for a moment, then play it again from the start
    if (S.clock >= S.t1) {
      S.clock = S.t1;
      pause();
      drawFire(true);
      clearTimeout(S.loop);
      S.loop = setTimeout(() => { if (S && S.fire && phase === "during" && ctx.tab() === "stories") { S.clock = S.t0; play(); } }, 2500);
    }
    else drawFire();
  }
  if (!S || !S.fire || !S.wind || !cv || !area) return;
  updateWind(dt);
  drawWind(dt);
  // compose: the fire cells, then the wind trails on top
  const g = cv.getContext("2d");
  g.clearRect(0, 0, cv.width, cv.height);
  if (S.cells) drawCells(g, S.clock);
  g.drawImage(wv, 0, 0);
  // In 3D, MapLibre drapes layers onto the terrain once and reuses that image until the style changes or a
  // tile loads; a canvas being redrawn doesn't count. Without this, the fire and wind on the 3D map only
  // updated when something else happened to change, which made them freeze and then jump.
  const terrain = ctx.map.terrain;
  if (terrain && terrain.sourceCache) { terrain.sourceCache.freeRtt(); ctx.map.triggerRepaint(); }
}


// Wind streaks, sized for the screen rather than for the canvas: however far in or out the map is, a streak
// is about 1.5 screen pixels wide and moves a set number of screen pixels per km/h. Each streak keeps its last
// few positions and its trail is redrawn fresh every frame, brighter at the head and for faster wind, and
// fainter towards the edges of the wind area so it has no hard border.
// (Fading old frames instead leaves a dim residue that builds up into a dark veil.)
const WIND_PX0 = 0.8, WIND_PX = 0.12;     // screen pixels per frame: a base so light wind still drifts, plus per km/h
const WIND_BANDS = [[8, 0.3], [20, 0.45], [Infinity, 0.6]];   // km/h upper bound, brightness
const TRAIL = 10;                          // positions kept per streak
const ALPHA_LEVELS = 12;
function drawWind(dt) {
  const map = ctx.map, g = wv.getContext("2d");
  const W = wv.width, H = wv.height;
  // how big the canvas is on screen right now, measured at the centre of the view
  const c = map.getCenter();
  const p0 = map.project([c.lng, c.lat]), p1 = map.project([c.lng + 0.05, c.lat]);
  const screenPerDeg = Math.hypot(p1.x - p0.x, p1.y - p0.y) / 0.05;
  if (!(screenPerDeg > 0)) return;
  const ratio = W / (area.e - area.w) / screenPerDeg;            // canvas pixels per screen pixel
  const kmPerScreenPx = (111.32 * Math.cos((c.lat * Math.PI) / 180)) / screenPerDeg;
  const sx = W / (area.e - area.w), sy = H / (area.yn - area.ys);
  const target = Math.max(250, Math.min(1500, Math.round((W / ratio) * (H / ratio) / 900)));
  while (particles.length < target) particles.push(spawn());
  if (particles.length > target) particles.length = target;
  const sat = map.getLayer("eox") && map.getLayoutProperty("eox", "visibility") === "visible";
  const rgb = sat || isDark() ? "236,243,248" : "16,52,96";
  const f60 = dt * 60, edgeZone = 0.25 * Math.min(W, H);
  const paths = Array.from({ length: ALPHA_LEVELS }, () => null);
  for (const p of particles) {
    const [u, v] = windAt(p.lon, p.lat);
    const sp = Math.hypot(u, v);
    const km = sp > 0.01 ? ((WIND_PX0 + WIND_PX * sp) * kmPerScreenPx * f60) / sp : 0;   // km per km/h
    p.lon += (u * km) / (111.32 * Math.cos((p.lat * Math.PI) / 180));
    p.lat += (v * km) / 110.57;
    const x = (p.lon - area.w) * sx, y = (area.yn - mercY(p.lat)) * sy;
    // remember the new head position (a ring of the last TRAIL positions)
    p.head = (p.head + 1) % TRAIL;
    p.hx[p.head] = x; p.hy[p.head] = y;
    if (p.n < TRAIL) p.n++;
    const band = WIND_BANDS.find(([max]) => sp < max)[1];
    const edge = Math.min(1, Math.max(0, Math.min(x, W - x, y, H - y) / edgeZone));
    const fadeIn = Math.min(1, p.age / 15);
    for (let j = 1; j < p.n; j++) {
      const i0 = (p.head - j + 1 + TRAIL) % TRAIL, i1 = (p.head - j + TRAIL) % TRAIL;
      const a = band * edge * fadeIn * (1 - j / TRAIL);
      const lv = Math.min(ALPHA_LEVELS - 1, Math.floor(a * ALPHA_LEVELS / 0.6));
      if (lv <= 0) continue;
      const path = paths[lv] || (paths[lv] = new Path2D());
      path.moveTo(p.hx[i0], p.hy[i0]);
      path.lineTo(p.hx[i1], p.hy[i1]);
    }
    if (++p.age > p.life || p.lon < area.w || p.lon > area.e || p.lat < area.s || p.lat > area.n) Object.assign(p, spawn());
  }
  g.clearRect(0, 0, W, H);
  g.lineWidth = Math.min(8, Math.max(0.8, 1.5 * ratio));
  g.lineCap = "round";
  paths.forEach((path, lv) => { if (path) { g.strokeStyle = `rgba(${rgb},${((lv + 0.5) * 0.6 / ALPHA_LEVELS).toFixed(3)})`; g.stroke(path); } });
}

function spawn() {
  return {
    lon: area.w + Math.random() * (area.e - area.w),
    lat: area.s + Math.random() * (area.n - area.s),
    age: 0, life: 60 + Math.random() * 90,
    hx: new Float32Array(TRAIL), hy: new Float32Array(TRAIL), head: 0, n: 0,
  };
}
