// MapLibre map with four representations of the same detections:
// flat map, pre-fire satellite imagery, 3D terrain, and a space-time cube (height = time).
/* global maplibregl */

export const EVENT_COLORS = [
  "#e4572e", "#2e86ab", "#3a9a5b", "#8e5cc2", "#d4a017", "#c2366b",
  "#1aa6a6", "#7a8c1c", "#b5651d", "#4a6fe3", "#9c3d3d", "#5f7f8f",
];
// perceptual fire ramp for time: early = deep violet, late = pale yellow
export const DATE_RAMP = ["#3b0f70", "#8c2981", "#de4968", "#fe9f6d", "#fcfdbf"];

export function rampColor(f) {
  f = Math.min(1, Math.max(0, f));
  const n = DATE_RAMP.length - 1;
  const i = Math.min(n - 1, Math.floor(f * n));
  const a = hex(DATE_RAMP[i]), b = hex(DATE_RAMP[i + 1]);
  const u = f * n - i;
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * u)).join(",")})`;
}
function hex(h) {
  return [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
}

export function isDark() {
  const t = document.documentElement.dataset.theme;
  if (t) return t === "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

const empty = () => ({ type: "FeatureCollection", features: [] });

// Base map: OpenFreeMap vector tiles (crisp labels, no key) with hillshaded terrain under the roads
// and labels, so fires sit in a landscape. Falls back to Esri raster tiles if the style can't load.
const OFM = "https://tiles.openfreemap.org/styles/";
export const BASE_LAYERS = [];   // ids of the base style's land/water/road layers
export const LABEL_LAYERS = [];  // ids of the base style's text layers

async function baseStyle(dark) {
  try {
    const r = await fetch(OFM + (dark ? "dark" : "positron"), { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch (_) {
    const esri = (v) => [`https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${v}/MapServer/tile/{z}/{y}/{x}`];
    const tone = dark ? "Dark" : "Light";
    return {
      version: 8,
      sources: {
        esri: { type: "raster", tiles: esri(`World_${tone}_Gray_Base`), tileSize: 256, maxzoom: 16, attribution: "Basemap © Esri" },
        esrilab: { type: "raster", tiles: esri(`World_${tone}_Gray_Reference`), tileSize: 256, maxzoom: 16 },
      },
      layers: [
        { id: "background", type: "background", paint: { "background-color": dark ? "#0d1418" : "#e9edf0" } },
        { id: "esri", type: "raster", source: "esri" },
        { id: "esrilab", type: "symbol-raster", source: "esrilab" },
      ],
    };
  }
}

export async function createMap(container) {
  const dark = isDark();
  const base = await baseStyle(dark);
  const style = { version: 8, glyphs: base.glyphs, sprite: base.sprite, sources: { ...base.sources }, layers: [] };
  style.sources.eox2 = { type: "raster", tiles: [eoxUrl(2022)], tileSize: 256, maxzoom: 14, attribution: "Sentinel-2 cloudless by EOX (Copernicus Sentinel data)" };
  style.sources.past = { type: "geojson", data: empty() };
  style.sources.eox = { type: "raster", tiles: [eoxUrl(2019)], tileSize: 256, maxzoom: 14, attribution: "Sentinel-2 cloudless by EOX (Copernicus Sentinel data)" };
  style.sources.dem = { type: "raster-dem", tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"], tileSize: 256, encoding: "terrarium", maxzoom: 13, attribution: "Terrain: Mapzen / AWS Open Data" };
  for (const id of ["perims", "origins", "hulls", "dets", "arrows", "ign", "cube", "links", "focus"]) style.sources[id] = { type: "geojson", data: empty() };
  style.sources.perims.promoteId = "id";

  BASE_LAYERS.length = LABEL_LAYERS.length = 0;
  const hillshade = { id: "hillshade", type: "hillshade", source: "dem", paint: {
    "hillshade-exaggeration": dark ? 0.35 : 0.3, "hillshade-shadow-color": dark ? "#000000" : "#5b6770",
    "hillshade-highlight-color": dark ? "#4a5560" : "#ffffff", "hillshade-accent-color": dark ? "#000000" : "#5b6770" } };
  let placed = false;
  for (const l of base.layers) {
    const isLabel = l.type === "symbol" || l.type === "symbol-raster";
    if (l.type === "symbol-raster") { style.layers.push({ ...l, type: "raster" }); LABEL_LAYERS.push(l.id); continue; }
    // hillshade goes above land cover and water, below roads, borders and labels
    if (!placed && l.type !== "background" && l.type !== "fill" && l.type !== "raster") {
      style.layers.push({ id: "eox", type: "raster", source: "eox", layout: { visibility: "none" } },
        { id: "eox2", type: "raster", source: "eox2", layout: { visibility: "none" }, paint: { "raster-fade-duration": 0 } }, hillshade);
      placed = true;
    }
    style.layers.push(l);
    (isLabel ? LABEL_LAYERS : BASE_LAYERS).push(l.id);
  }
  if (!placed) style.layers.push({ id: "eox", type: "raster", source: "eox", layout: { visibility: "none" } },
    { id: "eox2", type: "raster", source: "eox2", layout: { visibility: "none" }, paint: { "raster-fade-duration": 0 } }, hillshade);
  const truth = dark ? "#8fb8f2" : "#2156a3";
  const halo = dark ? "#0d1418" : "#ffffff";
  style.layers.push(
    { id: "past-fill", type: "fill", source: "past", layout: { visibility: "none" }, paint: { "fill-color": "#f59f00", "fill-opacity": 0.16 } },
    { id: "past-line", type: "line", source: "past", layout: { visibility: "none" }, paint: { "line-color": "#f59f00", "line-width": 1.2, "line-opacity": 0.8 } },
    { id: "perims-fill", type: "fill", source: "perims", paint: { "fill-color": truth, "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.16, 0.05] } },
    { id: "perims-line", type: "line", source: "perims", paint: { "line-color": truth, "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 2.4, 1.3], "line-dasharray": [3, 2] } },
    { id: "hulls-fill", type: "fill", source: "hulls", paint: { "fill-color": ["get", "col"], "fill-opacity": 0.1 } },
    { id: "hulls-line", type: "line", source: "hulls", paint: { "line-color": ["get", "col"], "line-width": 1.2, "line-opacity": 0.8 } },
    { id: "dets", type: "circle", source: "dets", paint: {
      "circle-color": ["get", "col"],
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, ["*", 2.2, ["get", "r"]], 8, ["*", 3.4, ["get", "r"]], 11, ["*", 4.6, ["get", "r"]], 14, ["*", 8, ["get", "r"]]],
      "circle-opacity": ["get", "a"],
      "circle-stroke-color": halo,
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 6, 0.3, 10, 0.8],
      "circle-stroke-opacity": 0.6,
    } },
    { id: "focus-line", type: "line", source: "focus", paint: { "line-color": dark ? "#ffffff" : "#142029", "line-width": 2, "line-dasharray": [2, 1.5] } },
    { id: "links-off", type: "line", source: "links", filter: ["==", ["get", "on"], 0], layout: { "line-cap": "round" },
      paint: { "line-color": dark ? "#93a2ad" : "#56636e", "line-width": ["case", ["get", "ov"], 3, 1.8], "line-dasharray": [1.5, 1.5] } },
    { id: "links-on", type: "line", source: "links", filter: ["==", ["get", "on"], 1], layout: { "line-cap": "round" },
      paint: { "line-color": "#d97706", "line-width": ["case", ["get", "ov"], 3.5, 2.2] } },
    { id: "links-hit", type: "line", source: "links", paint: { "line-color": "#000000", "line-opacity": 0.001, "line-width": 14 } },
    { id: "arrows", type: "line", source: "arrows", layout: { "line-cap": "round" }, paint: { "line-color": ["coalesce", ["get", "col"], dark ? "#ffffff" : "#142029"], "line-width": 2.6, "line-opacity": 0.95 } },
    { id: "arrowheads", type: "symbol", source: "arrows", filter: ["==", ["get", "end"], 1],
      layout: { "symbol-placement": "line-center", "icon-image": "arrowhead", "icon-size": 0.7, "icon-rotation-alignment": "map", "icon-allow-overlap": true, "icon-ignore-placement": true } },
    { id: "ign", type: "circle", source: "ign", paint: {
      "circle-color": halo, "circle-stroke-color": ["get", "col"], "circle-stroke-width": 2.2,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 3.2, 10, 6],
    } },
    { id: "origins", type: "symbol", source: "origins", layout: {
      "icon-image": "origin", "icon-size": ["interpolate", ["linear"], ["zoom"], 6, 0.5, 10, 0.8],
      "icon-allow-overlap": true, "icon-ignore-placement": true } },
    { id: "cube", type: "fill-extrusion", source: "cube", layout: { visibility: "none" }, paint: {
      "fill-extrusion-color": ["get", "col"], "fill-extrusion-base": ["get", "b"], "fill-extrusion-height": ["get", "h"], "fill-extrusion-opacity": 0.92,
    } },
  );
  // cap the drawing resolution: on retina screens full resolution is four times the pixels for the 3D terrain
  const map = new maplibregl.Map({ container, attributionControl: false, maxPitch: 75, style, center: [-106.4, 40.3], zoom: 6.5,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5) });
  // a cancelled tile download (when the imagery year switches) is expected, not an error worth logging
  map.on("error", (e) => { const err = e && e.error; if (!(err && (err.name === "AbortError" || err.message === "AbortError"))) console.error(err || e); });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
  map.on("load", () => {
    // start with the attribution collapsed to its (i) button
    const at = map.getContainer().querySelector(".maplibregl-ctrl-attrib");
    if (at) { at.classList.remove("maplibregl-compact-show"); at.removeAttribute("open"); }
    map.addImage("arrowhead", arrowImage(dark), { pixelRatio: 2 });
    map.addImage("origin", originImage(truth, halo), { pixelRatio: 2 });
  });
  return map;
}

// Dim everything except one event (ev = null clears the focus)
export function focusEvent(map, ev) {
  const on = ev != null;
  map.setPaintProperty("dets", "circle-opacity", on ? ["case", ["==", ["get", "ev"], ev], 1, ["*", 0.18, ["get", "a"]]] : ["get", "a"]);
  map.setPaintProperty("hulls-fill", "fill-opacity", on ? ["case", ["==", ["get", "ev"], ev], 0.16, 0.03] : 0.1);
  map.setPaintProperty("hulls-line", "line-opacity", on ? ["case", ["==", ["get", "ev"], ev], 1, 0.2] : 0.8);
  map.setPaintProperty("ign", "circle-opacity", on ? ["case", ["==", ["get", "ev"], ev], 1, 0.2] : 1);
  map.setPaintProperty("ign", "circle-stroke-opacity", on ? ["case", ["==", ["get", "ev"], ev], 1, 0.2] : 1);
}

// The pre-fire Sentinel-2 cloudless mosaic for a fire season in `year` (the year before)
export function eoxUrl(year) {
  const y = Math.max(2016, Math.min(2023, year - 1));
  const layer = y === 2016 ? "s2cloudless_3857" : `s2cloudless-${y}_3857`;
  return `https://tiles.maps.eox.at/wmts/1.0.0/${layer}/default/g/{z}/{y}/{x}.jpg`;
}

// recorded point of origin: a plus sign, so it can't be mistaken for a detection
function originImage(col, halo) {
  const s = 32;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  g.lineCap = "round";
  for (const [w, colr] of [[10, halo], [5, col]]) {
    g.strokeStyle = colr;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(s / 2, 6); g.lineTo(s / 2, s - 6);
    g.moveTo(6, s / 2); g.lineTo(s - 6, s / 2);
    g.stroke();
  }
  const d = g.getImageData(0, 0, s, s);
  return { width: s, height: s, data: new Uint8Array(d.data.buffer) };
}

function arrowImage(dark) {
  const s = 32;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  g.fillStyle = dark ? "#e2e8ec" : "#142029";
  g.beginPath();
  // points to the right; MapLibre rotates it along the line
  g.moveTo(s - 4, s / 2);
  g.lineTo(6, 6);
  g.lineTo(11, s / 2);
  g.lineTo(6, s - 6);
  g.closePath();
  g.fill();
  const d = g.getImageData(0, 0, s, s);
  return { width: s, height: s, data: new Uint8Array(d.data.buffer) };
}

// Sentinel-2 cloudless mosaic for a given calendar year (no offset)
export function eoxYearUrl(y) {
  y = Math.max(2016, Math.min(2023, y));
  const layer = y === 2016 ? "s2cloudless_3857" : `s2cloudless-${y}_3857`;
  return `https://tiles.maps.eox.at/wmts/1.0.0/${layer}/default/g/{z}/{y}/{x}.jpg`;
}

// Before/after imagery: `before` year under, `after` year on top at opacity `mix` (0 = before only)
export function setImagery(map, on, { before, after, mix = 0 } = {}) {
  const vis = (id, v) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", v ? "visible" : "none");
  if (!on) { vis("eox2", false); return; }
  for (const id of BASE_LAYERS) vis(id, false);
  for (const id of LABEL_LAYERS) vis(id, false);
  map.getSource("eox").setTiles([eoxYearUrl(before)]);
  vis("eox", true);
  if (after) {
    map.getSource("eox2").setTiles([eoxYearUrl(after)]);
    map.setPaintProperty("eox2", "raster-opacity", mix);
    vis("eox2", mix > 0);
  } else vis("eox2", false);
}

export function setSatelliteYear(map, year) {
  const src = map.getSource("eox");
  if (src && src.setTiles) src.setTiles([eoxUrl(year)]);
}

// view: map | satellite | terrain | cube
// view: map | satellite | terrain | sat3d (pre-fire satellite imagery draped over 3D terrain) | cube
export function applyView(map, view, { keepCamera = false } = {}) {
  const vis = (id, on) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  const sat = view === "satellite" || view === "sat3d";
  for (const id of BASE_LAYERS) vis(id, !sat);
  for (const id of LABEL_LAYERS) vis(id, !sat);
  vis("eox", sat);
  vis("hillshade", view !== "satellite");
  if (map.getLayer("hillshade")) {
    map.setPaintProperty("hillshade", "hillshade-exaggeration", view === "terrain" ? 0.6 : view === "sat3d" ? 0.25 : isDark() ? 0.35 : 0.3);
  }
  vis("cube", view === "cube");
  const flat2d = view === "map" || view === "satellite";
  if (view === "terrain" || view === "sat3d") {
    map.setTerrain({ source: "dem", exaggeration: 1.6 });
  } else {
    map.setTerrain(null);
  }
  if (!keepCamera) {
    if (flat2d) map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
    else map.easeTo({ pitch: view === "cube" ? 62 : 58, bearing: view === "cube" ? -18 : -12, duration: 700 });
  }
}

export function setData(map, id, data) {
  const s = map.getSource(id);
  if (s) s.setData(data);
}

export function setVisible(map, ids, on) {
  for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
}


// Space-time cube: one slab per detection, raised by its time. sizeKm sets the square's side.
export function cubeFeatures(lon, lat, t, cols, { t0, metersPerDay, sizeKm, keep }) {
  const feats = [];
  const half = sizeKm / 2;
  for (let i = 0; i < lon.length; i++) {
    if (keep && !keep(i)) continue;
    const dLat = half / 110.57;
    const dLon = half / (111.32 * Math.cos((lat[i] * Math.PI) / 180));
    const b = (t[i] - t0) * metersPerDay;
    feats.push({
      type: "Feature",
      properties: { col: cols[i], b, h: b + Math.max(metersPerDay * 0.35, 60) },
      geometry: { type: "Polygon", coordinates: [[
        [lon[i] - dLon, lat[i] - dLat], [lon[i] + dLon, lat[i] - dLat],
        [lon[i] + dLon, lat[i] + dLat], [lon[i] - dLon, lat[i] + dLat], [lon[i] - dLon, lat[i] - dLat],
      ]] },
    });
  }
  return { type: "FeatureCollection", features: feats };
}
