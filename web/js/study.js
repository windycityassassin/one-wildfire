// "One fire or several?" A small within-subject pilot: each cluster is shown in one of four
// representations (rotated so every view is used for every kind of case), and the answers are
// both scored against the record and turned into an implied clustering setting.
import { applyView, setData, setVisible, setSatelliteYear, cubeFeatures, rampColor, DATE_RAMP } from "./mapview.js";
import { heatmap, bars } from "./charts.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const VIEWS = ["map", "satellite", "terrain", "cube"];
const VIEW_NAMES = { map: "Flat map", satellite: "Pre-fire satellite", terrain: "3D terrain", cube: "Space-time cube" };
const STORE = "spdf-study-v1";

let ctx, items = null, trials = [], k = 0, answer = null, shownAt = 0, session = null;

export function initStudy(c) {
  ctx = c;
  $("#study-start").addEventListener("click", start);
  $("#res-again").addEventListener("click", start);
  $$("#trial-choice button").forEach((b) => b.addEventListener("click", () => {
    answer = b.dataset.a;
    $$("#trial-choice button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    updateNext();
  }));
  $$("#trial-conf input").forEach((i) => i.addEventListener("change", updateNext));
  $("#trial-next").addEventListener("click", () => record(false));
  $("#trial-skip").addEventListener("click", () => record(true));
  $("#res-csv").addEventListener("click", () => download("csv"));
  $("#res-json").addEventListener("click", () => download("json"));
  document.addEventListener("study:show", show);
  document.addEventListener("study:hide", hide);
}

async function loadItems() {
  if (!items) items = (await (await fetch("data/study.json")).json()).items;
  return items;
}

function shuffle(a, rnd = Math.random) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// pick n items, spreading across regions before repeating one
function pickSpread(pool, n) {
  const byRegion = new Map();
  for (const it of shuffle(pool.slice())) {
    if (!byRegion.has(it.region)) byRegion.set(it.region, []);
    byRegion.get(it.region).push(it);
  }
  const out = [];
  const queues = shuffle([...byRegion.values()]);
  while (out.length < n && queues.some((q) => q.length)) {
    for (const q of queues) if (q.length && out.length < n) out.push(q.shift());
  }
  return out;
}

async function start() {
  const all = await loadItems();
  const one = pickSpread(all.filter((it) => it.truth === 1), 4);
  const sev = pickSpread(all.filter((it) => it.truth >= 2), 4);
  const unk = pickSpread(all.filter((it) => it.truth == null), 4);
  trials = [];
  for (const group of [one, sev, unk]) {
    const views = shuffle(VIEWS.slice());
    group.forEach((it, i) => trials.push({ item: it, view: views[i % views.length] }));
  }
  shuffle(trials);
  session = {
    id: Math.random().toString(36).slice(2, 10),
    started: new Date().toISOString(),
    responses: [],
  };
  k = 0;
  $("#study-intro").hidden = true;
  $("#study-results").hidden = true;
  $("#study-trial").hidden = false;
  showTrial();
}

function show() {
  ctx.onEnter();
  $("#viewseg").style.pointerEvents = "none";
  $("#viewseg").style.opacity = "0.55";
  setVisible(ctx.map, ["hulls-fill", "hulls-line", "ign", "arrows", "arrowheads", "perims-fill", "perims-line", "origins", "links-on", "links-off", "links-hit"], false);
  setData(ctx.map, "perims", { type: "FeatureCollection", features: [] });
  if (trials.length && !$("#study-trial").hidden) showTrial();
  else {
    setData(ctx.map, "dets", { type: "FeatureCollection", features: [] });
    setData(ctx.map, "cube", { type: "FeatureCollection", features: [] });
    $("#legend").innerHTML = `<span class="note">Clusters appear here once you start.</span>`;
  }
}

function hide() {
  $("#viewseg").style.pointerEvents = "";
  $("#viewseg").style.opacity = "";
  ctx.onExit();
}

function showTrial() {
  const { item, view } = trials[k];
  const region = ctx.meta.regions.find((r) => r.key === item.region);
  const map = ctx.map;
  const span = Math.max(0.5, item.t1 - item.t0);
  const cols = item.t.map((t) => rampColor((t - item.t0) / span));
  setData(map, "dets", {
    type: "FeatureCollection",
    features: item.lon.map((lon, i) => ({
      type: "Feature", properties: { col: cols[i], r: 1.25, a: 0.95, t: item.t[i], ev: -1 },
      geometry: { type: "Point", coordinates: [lon, item.lat[i]] },
    })),
  });
  // bounds with a margin so the surrounding landscape is visible
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  item.lon.forEach((lon, i) => { w = Math.min(w, lon); e = Math.max(e, lon); s = Math.min(s, item.lat[i]); n = Math.max(n, item.lat[i]); });
  const padLon = Math.max(0.04, (e - w) * 0.35), padLat = Math.max(0.03, (n - s) * 0.35);
  const extentKm = Math.max((e - w) * 111.32 * Math.cos(((s + n) / 2) * Math.PI / 180), (n - s) * 110.57, 4);
  setData(map, "cube", cubeFeatures(item.lon, item.lat, item.t, cols, {
    t0: item.t0, metersPerDay: (extentKm * 1000 * 0.6) / span, sizeKm: Math.max(0.5, extentKm / 70),
  }));
  setSatelliteYear(map, region.year);
  $$("#viewseg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === view));
  applyView(map, view, { keepCamera: true });
  setVisible(map, ["dets"], view !== "cube");
  setVisible(map, ["hulls-fill", "hulls-line", "ign", "arrows", "arrowheads", "perims-fill", "perims-line", "origins", "links-on", "links-off", "links-hit"], false);
  const pitched = view === "terrain" || view === "cube";
  map.fitBounds([[w - padLon, s - padLat], [e + padLon, n + padLat]], {
    padding: { top: 70, bottom: 90, left: 40, right: 40 }, duration: 0,
    pitch: pitched ? (view === "cube" ? 60 : 55) : 0, bearing: pitched ? -15 : 0, maxZoom: 12,
  });

  const yr = region.year;
  $("#legend").innerHTML = `<div class="ramp" style="background:linear-gradient(90deg,${DATE_RAMP.join(",")})"></div>
    <div class="ends"><span>${ctx.fmtDate(yr, item.t0, true)}</span><span>${ctx.fmtDate(yr, item.t1, true)}</span></div>
    ${view === "cube" ? `<span class="note">Height is time: later detections sit higher.</span>` : ""}`;
  $("#trial-count").textContent = `Cluster ${k + 1} of ${trials.length}`;
  $("#trial-progress").style.width = `${(k / trials.length) * 100}%`;
  $("#trial-view").textContent = VIEW_NAMES[view];
  $("#trial-meta").textContent = `${item.n} detections over ${span < 1 ? Math.round(span * 24) + " hours" : span.toFixed(1) + " days"} · ${region.name}, ${yr}`;
  answer = null;
  $$("#trial-choice button").forEach((x) => x.setAttribute("aria-pressed", "false"));
  $$("#trial-conf input").forEach((i) => (i.checked = false));
  $("#trial-why").value = "";
  updateNext();
  shownAt = performance.now();
}

function updateNext() {
  $("#trial-next").disabled = !(answer && $("#trial-conf input:checked"));
  $("#trial-next").textContent = k === trials.length - 1 ? "See results" : "Next";
}

function record(skipped) {
  const { item, view } = trials[k];
  session.responses.push({
    session: session.id, trial: k + 1, item: item.id, region: item.region, view,
    answer: skipped ? null : answer,
    confidence: skipped ? null : +$("#trial-conf input:checked").value,
    noticed: skipped ? "" : $("#trial-why").value.trim(),
    rt_s: +((performance.now() - shownAt) / 1000).toFixed(1),
    n_detections: item.n, span_days: +(item.t1 - item.t0).toFixed(2),
    truth: item.truth == null ? null : item.truth === 1 ? "one" : "several",
    official_fires: item.names.join(" + "),
  });
  k++;
  if (k < trials.length) showTrial();
  else finish();
}

function finish() {
  session.finished = new Date().toISOString();
  try {
    const prev = JSON.parse(localStorage.getItem(STORE) || "[]");
    prev.push(session);
    localStorage.setItem(STORE, JSON.stringify(prev));
  } catch (_) { /* storage unavailable; the download still works */ }
  $("#study-trial").hidden = true;
  $("#study-results").hidden = false;
  renderResults();
}

function renderResults() {
  const R = session.responses.filter((r) => r.answer);
  const known = R.filter((r) => r.truth);
  const right = known.filter((r) => r.answer === r.truth).length;
  $("#res-headline").textContent = known.length
    ? `${right} of ${known.length} matched the official record`
    : "No answered clusters had a known answer";
  const unk = R.filter((r) => !r.truth);
  $("#res-lede").textContent = `${unk.length} of your answers were for places with no official record (${[...new Set(unk.map((r) => ctx.meta.regions.find((g) => g.key === r.region).name))].join(", ") || "none"}). There, judgments like yours are the only calibration available.`;

  bars($("#res-views"), {
    label: "Accuracy by view",
    rows: VIEWS.map((v) => {
      const rs = known.filter((r) => r.view === v);
      const ok = rs.filter((r) => r.answer === r.truth).length;
      return { name: VIEW_NAMES[v], value: rs.length ? ok / rs.length : null, text: rs.length ? `${ok}/${rs.length}` : "none" };
    }),
  });

  // agreement between each clustering setting and the participant's calls
  const { d_grid, t_grid } = ctx.meta;
  const byId = new Map(items.map((it) => [it.id, it]));
  const agree = d_grid.map((_, i) => t_grid.map((_, j) => {
    const c = i * t_grid.length + j;
    if (!R.length) return null;
    let a = 0;
    for (const r of R) {
      const algoOne = byId.get(r.item).ncl[c] === 1;
      if (algoOne === (r.answer === "one")) a++;
    }
    return a / R.length;
  }));
  let best = -1, bi = 0, bj = 0;
  agree.forEach((row, i) => row.forEach((v, j) => {
    if (v != null && v > best + 1e-9) { best = v; bi = i; bj = j; }
  }));
  heatmap($("#res-heat"), {
    rows: d_grid.map((d) => d + " km"), cols: t_grid.map((t) => (t < 1 ? "½" : t)),
    values: agree, labels: agree.map((row) => row.map((v) => (v == null ? "" : Math.round(v * 100)))),
    marks: [{ i: bi, j: bj, kind: "dot", title: "Closest to your judgment" }],
    rowTitle: "d", colTitle: "T (days)", label: "Agreement between each setting and your answers",
  });
  $("#res-heat-note").innerHTML = R.length
    ? `Each cell is the share of your ${R.length} answers that the algorithm reproduces at that setting. Your calls are best matched by <b>${d_grid[bi]} km and ${t_grid[bj]} ${t_grid[bj] === 1 ? "day" : "days"}</b> (${Math.round(best * 100)}%). With more people who know a place, this becomes a way to set the window where there are no perimeters to check against.`
    : "";

  $("#res-reveal").innerHTML = session.responses.map((r) => {
    const region = ctx.meta.regions.find((g) => g.key === r.region);
    const verdict = !r.answer ? `<span class="pill">skipped</span>`
      : !r.truth ? `<span class="pill">no record</span>`
      : r.answer === r.truth ? `<span class="pill good">matches record</span>` : `<span class="pill warn">record says ${r.truth}</span>`;
    return `<div class="item"><span><b>${r.trial}.</b> ${region.name} · ${VIEW_NAMES[r.view]} · you said <b>${r.answer ?? "–"}</b></span>${verdict}
      ${r.official_fires ? `<small>Official record: ${r.official_fires}</small>` : ""}${r.noticed ? `<small>You noticed: “${escapeHtml(r.noticed)}”</small>` : ""}</div>`;
  }).join("");
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function download(kind) {
  if (!session) return;
  let blob, name;
  if (kind === "json") {
    blob = new Blob([JSON.stringify(session, null, 2)], { type: "application/json" });
    name = `one-fire-or-several_${session.id}.json`;
  } else {
    const cols = Object.keys(session.responses[0]);
    const esc = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const csv = [cols.join(","), ...session.responses.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
    blob = new Blob([csv], { type: "text/csv" });
    name = `one-fire-or-several_${session.id}.csv`;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
