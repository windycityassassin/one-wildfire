// From orbit: the Soda Fire as MODIS saw it (pipeline/31_soda.py), on a quiet dark globe.
// Modes:
//   "intro"    the Earth from space, slowly turning
//   "sat"      Aqua's first pass over the fire, its scan strip sweeping the globe, the fire lighting up
//   "spot"     the satellite looks closer: brackets lock on, the camera dives in, and the speck becomes one square of heat
//   "start"    earlier that day: lightning strikes where the first hot spot was seen; the nine squares of that first
//              pass land, one by one, and the fire holds there, ageing white to red
//   "pixels"   the same fire, unbroken: the five days of passes pile up while the camera eases out to the whole fire.
//              Scrolling from "start" to "pixels" changes the caption, not the animation (see "the fire" below)
//   "split"    the 2016 rule's 38 pieces appear one by one, each its own colour
//   "one"      the pieces join into one fire, the Soda Fire, with its official outline
//   "us"       every one of the 1,431 US fires, turning from the 2016 rule's result to the wider window's:
//              right ones stay yellow, the ones more room fixed turn orange
//   "spread"   the five days on a loop, squares by age, with the ERA5 wind
// The hot squares and the national dots are drawn on their own canvas (#heat) after each map frame; see "the overlay".
//   "descend"  fly down to the drone site on imagery, where the drone flies its survey over the white square
/* global maplibregl */
import { palette } from "./fires.js";
import { initFx } from "./fx.js";

const FIRE = "#ff6a2b";
const GREY = "#8e8981";
const empty = { type: "FeatureCollection", features: [] };
const KM = 1.0;      // MODIS pixel at nadir, km
const RE = 6371;     // Earth radius, km
const rad = Math.PI / 180;

// a point `km` away from [lon, lat] on initial bearing `brg` (degrees), along a great circle
function dest([lon, lat], brg, km) {
  const d = km / RE, b = brg * rad, p1 = lat * rad, l1 = lon * rad;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [l2 / rad, p2 / rad];
}
function bearing([lo1, la1], [lo2, la2]) {
  const p1 = la1 * rad, p2 = la2 * rad, dl = (lo2 - lo1) * rad;
  return Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / rad;
}

// Aqua's pass at 20:07 UTC on 10 August 2015, the first time a satellite saw the fire. Aqua flies north in the
// afternoon, on a track tilted about 14° west of north here. The fire sat near the western edge of the strip
// (those first pixels were 3.1 km wide, against 1 km straight below the satellite), so the track is drawn
// about 870 km east of it. The strip is 2,330 km wide (MODIS specifications).
const PASS = { heading: -14, offset: 870, half: 1165, from: -2900, to: 2500, seconds: 8 };

// a sky full of faint stars, behind the globe
function stars(el) {
  const c = document.createElement("canvas"), w = 1600, h = 1000;
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 520; i++) {
    const r = rnd() < 0.92 ? 0.6 : 1.1;
    g.fillStyle = `rgba(235, 238, 245, ${0.15 + rnd() * 0.45})`;
    g.beginPath(); g.arc(rnd() * w, rnd() * h, r, 0, Math.PI * 2); g.fill();
  }
  el.style.backgroundImage = `url(${c.toDataURL()})`;
  el.style.backgroundSize = "cover";
}

// one colour walk for every hot square: white when new, then yellow, orange, red, and (only on the spread map,
// where five days play out) dark as it burns out. Ages are in the fire's hours; "spread" plays them at RATE hours a
// second, and every other scene ages its squares at that same speed.
const RAMP = [[0, [255, 244, 207]], [5, [255, 192, 97]], [18, [255, 106, 43]], [50, [194, 50, 26]], [95, [122, 36, 16]], [140, [74, 26, 12]]];
const RED = 50;      // scenes other than "spread" hold here: the squares stay red
function ramp(h) {
  if (h <= 0) return RAMP[0][1];
  for (let i = 1; i < RAMP.length; i++) if (h <= RAMP[i][0]) {
    const [h0, c0] = RAMP[i - 1], [h1, c1] = RAMP[i], u = (h - h0) / (h1 - h0);
    return [c0[0] + (c1[0] - c0[0]) * u, c0[1] + (c1[1] - c0[1]) * u, c0[2] + (c1[2] - c0[2]) * u];
  }
  return RAMP[RAMP.length - 1][1];
}
const rgba = (c, a) => `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${a})`;
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export async function initOrbit(el, D) {
  const [w, s, e, n] = D.bounds;
  const lat0 = (s + n) / 2;
  const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180);
  // the middle of the first pass's hot spots: where the bolt lands
  const pass0 = D.dets.filter((d) => d[2] === 0);
  const ignite = [pass0.reduce((t, d) => t + d[0], 0) / pass0.length, pass0.reduce((t, d) => t + d[1], 0) / pass0.length];
  const hmax = Math.max(...D.dets.map((d) => d[2]));
  const SPREAD = 11, RATE = hmax / SPREAD;      // "spread" plays the five days in 11 s
  const PIX = 7;                                 // "pixels" plays them in 7 s

  // every hot square: its centre, and points half a pixel east and north (to size it on screen)
  const dx = KM / 2 / kx, dy = KM / 2 / 110.57;
  const SQ = D.dets.map(([lon, lat, h, , , e16]) => ({ c: [lon, lat], ex: [lon + dx, lat], ny: [lon, lat + dy], h, e16 }));
  // the first day and a half, one square at a time: in the order they were seen, nearest the strike first.
  // tq: the second each lands (slow at first, then the fire takes off)
  const DAY1 = 36, GROW = 18;
  const seq = D.dets.map((d, i) => [d[2], Math.hypot((d[0] - ignite[0]) * kx, (d[1] - ignite[1]) * 110.57), i])
    .filter((x) => x[0] <= DAY1).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  seq.forEach(([, , i], q) => (SQ[i].tq = GROW * Math.pow(q / seq.length, 1 / 1.8)));
  // the first pass's squares, in "spot": one after another
  const first = seq.filter(([h]) => h === 0).map(([, , i], k) => ({ i, ts: k * 0.18 }));
  // the one square "spot" ends on (the nearest to the strike, 0.8 km from it): the speck, the brackets and the dive all
  // aim at its centre, so it lands in the middle of them
  const spot0 = SQ[first[0].i].c;
  const n16 = D.events.rule2016;
  const pal = palette(n16);
  // the 2016 pieces in the order they first appeared
  const firstSeen = new Array(n16).fill(Infinity);
  for (const d of D.dets) firstSeen[d[5]] = Math.min(firstSeen[d[5]], d[2]);
  const order = [...Array(n16).keys()].sort((a, b) => firstSeen[a] - firstSeen[b] || a - b);
  const rank = new Array(n16); order.forEach((p, k) => (rank[p] = k));

  const [dlon, dlat] = D.drone.lonlat;
  const [sw, sh] = D.drone.size;
  const ddx = sw / 2 / 1000 / kx, ddy = sh / 2 / 1000 / 110.57;
  const siteSquare = { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[
    [dlon - ddx, dlat - ddy], [dlon + ddx, dlat - ddy], [dlon + ddx, dlat + ddy], [dlon - ddx, dlat + ddy], [dlon - ddx, dlat - ddy]]] } };
  const pt = (c, p = {}) => ({ type: "Feature", properties: p, geometry: { type: "Point", coordinates: c } });

  stars(el);
  const GLOBE = [-104, 22];
  const map = new maplibregl.Map({
    container: el,
    interactive: false,
    attributionControl: { compact: true },
    center: GLOBE, zoom: el.clientWidth < 760 ? 1.1 : 1.7,
    fadeDuration: 0,
    style: {
      version: 8,
      projection: { type: "globe" },
      sky: { "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.9, 4, 0.6, 7, 0] },
      glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
      sources: {
        dem: { type: "raster-dem", tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"], tileSize: 256, encoding: "terrarium", maxzoom: 12, attribution: "Terrain: Mapzen / AWS" },
        omt: { type: "vector", url: "https://tiles.openfreemap.org/planet", attribution: "© OpenStreetMap" },
        img: { type: "raster", tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], tileSize: 256, maxzoom: 19, attribution: "Imagery © Esri, Maxar, Earthstar Geographics" },
        perim: { type: "geojson", data: { type: "Feature", properties: {}, geometry: D.perimeter } },
        site: { type: "geojson", data: siteSquare },
        spark: { type: "geojson", data: pt(spot0) },
        label: { type: "geojson", data: empty },
      },
      layers: [
        { id: "bg", type: "background", paint: { "background-color": "#0a0b0c" } },
        { id: "hill", type: "hillshade", source: "dem", paint: { "hillshade-exaggeration": 0.55, "hillshade-exaggeration-transition": { duration: 1600 }, "hillshade-shadow-color": "#000000", "hillshade-highlight-color": "#3b3833", "hillshade-accent-color": "#050505", "hillshade-illumination-direction": 315 } },
        { id: "img", type: "raster", source: "img", paint: { "raster-opacity": 0, "raster-opacity-transition": { duration: 1600 }, "raster-saturation": -0.15, "raster-brightness-max": 1, "raster-brightness-max-transition": { duration: 1600 } } },
        { id: "water", type: "fill", source: "omt", "source-layer": "water", paint: { "fill-color": "#0c0f12", "fill-opacity-transition": { duration: 1200 } } },
        { id: "border", type: "line", source: "omt", "source-layer": "boundary", filter: ["all", ["<=", ["coalesce", ["get", "admin_level"], 99], 4], ["!=", ["coalesce", ["get", "maritime"], 0], 1]],
          paint: { "line-color": "#4a4741", "line-width": 0.8, "line-dasharray": [3, 2], "line-opacity-transition": { duration: 1200 } } },
        { id: "states", type: "symbol", source: "omt", "source-layer": "place", filter: ["==", ["get", "class"], "state"],
          layout: { "text-field": ["upcase", ["coalesce", ["get", "name:en"], ["get", "name"]]], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-letter-spacing": 0.35 },
          paint: { "text-color": "#6d6a64", "text-opacity-transition": { duration: 1200 } } },
        { id: "perim-fill", type: "fill", source: "perim", paint: { "fill-color": FIRE, "fill-opacity": 0, "fill-opacity-transition": { duration: 1400 } } },
        { id: "perim", type: "line", source: "perim", paint: { "line-color": "#f2efe8", "line-width": 1.2, "line-opacity": 0, "line-opacity-transition": { duration: 1400 } } },
        { id: "site", type: "line", source: "site", paint: { "line-color": "#f2efe8", "line-width": 1.5, "line-opacity": 0, "line-opacity-transition": { duration: 900 } } },
        // seen from space: the fire as a single bright speck
        { id: "speck", type: "circle", source: "spark", paint: { "circle-color": FIRE, "circle-radius": 5, "circle-blur": 0.5, "circle-opacity": 0, "circle-opacity-transition": { duration: 500 } } },
        // where the bolt lands: a white-hot point that cools to orange
        { id: "spark", type: "circle", source: "spark", paint: { "circle-color": "#fff4cf", "circle-radius": 4, "circle-blur": 0.25, "circle-opacity": 0, "circle-opacity-transition": { duration: 300 } } },
        { id: "label", type: "symbol", source: "label", layout: { "text-field": ["get", "t"], "text-font": ["Noto Sans Regular"], "text-size": 15, "text-anchor": ["get", "a"], "text-justify": "center", "text-letter-spacing": 0.04, "text-allow-overlap": true, "text-line-height": 1.35 },
          paint: { "text-color": "#ece8e1", "text-halo-color": "#0a0b0c", "text-halo-width": 1.6, "text-opacity": 0, "text-opacity-transition": { duration: 1400 } } },
      ],
    },
  });
  await new Promise((r) => map.on("load", r));
  const fx = initFx(document.getElementById("fx"), el);

  // ---- view helpers ----
  const narrow = () => el.clientWidth < 760;
  const pad = () => narrow() ? { top: 110, bottom: el.clientHeight * 0.38, left: 24, right: 24 }
    : { top: 110, bottom: 70, left: Math.max(420, el.clientWidth * 0.36), right: 90 };
  // the fixed zooms below were set on a desktop window (about 770 × 620 px of map beside the caption); on a smaller or
  // shorter screen, such as a tablet held sideways, the picture is zoomed out by the same ratio so it stays clear of the words
  const squeeze = () => {
    if (narrow()) return 0;
    const p = pad(), w = el.clientWidth - p.left - p.right, h = el.clientHeight - p.top - p.bottom;
    return Math.min(0, Math.log2(Math.min(w / 770, h / 620)));
  };
  // fit a box on screen (MapLibre 5's fitBounds zooms out about one level too far on the globe): Mercator maths,
  // which is what the globe matches at the centre of the view
  const merc = ([lon, lat]) => [(lon + 180) / 360 * 512, (180 - Math.log(Math.tan(Math.PI / 4 + lat * rad / 2)) / rad) / 360 * 512];
  function fit([[w0, s0], [e0, n0]], { padding = pad(), ...opts } = {}) {
    const [x0, y0] = merc([w0, n0]), [x1, y1] = merc([e0, s0]);
    const aw = el.clientWidth - padding.left - padding.right, ah = el.clientHeight - padding.top - padding.bottom;
    const zoom = Math.log2(Math.min(aw / (x1 - x0), ah / (y1 - y0)));
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * ((y0 + y1) / 2) / 512))) / rad;
    map.flyTo({ center: [(w0 + e0) / 2, lat], zoom, padding, duration: 2600, essential: true, ...opts });
  }
  const fitFire = (opts = {}) => fit([[w, s], [e, n]], opts);
  const set = (id, prop, v) => map.setPaintProperty(id, prop, v);
  // timers and loops belong to one mode: leaving it cancels them
  let token = 0;
  const later = (ms, f) => { const t = token; setTimeout(() => t === token && f(), ms); };
  const loop = (f) => { const t = token; const step = (now) => { if (t === token && f(now) !== false) requestAnimationFrame(step); }; requestAnimationFrame(step); };
  const arrive = (f) => { const t = token; map.once("moveend", () => t === token && f()); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- the overlay: hot squares and fire dots, drawn on their own canvas right after each map frame, so they
  // move with the camera exactly and never make the map rebuild its data. Each scene hands it a painter;
  // painters fade in, and the last one fades out, so scenes cross over instead of cutting. ----
  const hv = document.getElementById("heat"), hg = hv.getContext("2d");
  let HW = 0, HH = 0;
  const sizeHeat = () => {
    const r = Math.min(devicePixelRatio, 2);
    HW = el.clientWidth; HH = el.clientHeight;
    hv.width = HW * r; hv.height = HH * r;
    hg.setTransform(r, 0, 0, r, 0, 0);
    map.triggerRepaint();
  };
  sizeHeat();
  new ResizeObserver(sizeHeat).observe(el);
  let painters = [], lastPaint = 0;
  function paint(draw) {
    for (const p of painters) p.to = 0;
    if (draw) painters.push({ draw, a: 0, to: 1 });
    map.triggerRepaint();
  }
  map.on("render", () => {
    const now = performance.now(), dt = Math.min(0.1, (now - (lastPaint || now)) / 1000);
    lastPaint = now;
    hg.clearRect(0, 0, HW, HH);
    let again = false;
    for (const p of painters) {
      p.a += (p.to - p.a) * Math.min(1, dt * 6);
      if (Math.abs(p.to - p.a) < 0.01) p.a = p.to; else again = true;
      if (p.a > 0 && p.draw(hg, now, p.a)) again = true;
    }
    painters = painters.filter((p) => p.a > 0 || p.to > 0);
    if (again) map.triggerRepaint();
  });
  // a square on screen: its centre and two half-axes, so it tilts with the camera
  const SQP = new Float32Array(SQ.length * 6);
  function place(i) {
    const q = SQ[i], c = map.project(q.c), a = map.project(q.ex), b = map.project(q.ny), o = i * 6;
    SQP[o] = c.x; SQP[o + 1] = c.y; SQP[o + 2] = a.x - c.x; SQP[o + 3] = a.y - c.y; SQP[o + 4] = b.x - c.x; SQP[o + 5] = b.y - c.y;
    return c.x > -80 && c.y > -80 && c.x < HW + 80 && c.y < HH + 80;
  }
  function quad(g, i) {
    const o = i * 6, x = SQP[o], y = SQP[o + 1], ax = SQP[o + 2], ay = SQP[o + 3], bx = SQP[o + 4], by = SQP[o + 5];
    g.beginPath();
    g.moveTo(x - ax - bx, y - ay - by); g.lineTo(x + ax - bx, y + ay - by); g.lineTo(x + ax + bx, y + ay + by); g.lineTo(x - ax + bx, y - ay + by);
    g.closePath(); g.fill();
  }
  const sprite = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d"), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255, 150, 70, 1)"); grad.addColorStop(0.4, "rgba(255, 110, 40, .35)"); grad.addColorStop(1, "rgba(255, 90, 30, 0)");
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    return c;
  })();
  // burning squares: list of [index, age in hours]; a soft glow under each, strongest when new
  function burn(g, a, list) {
    const shown = list.filter(([i]) => place(i));
    g.globalCompositeOperation = "lighter";
    for (const [i, h] of shown) {
      const o = i * 6, r = Math.max(6, Math.hypot(SQP[o + 2], SQP[o + 3]) * 3.2);
      g.globalAlpha = a * (0.08 + 0.32 * Math.max(0, 1 - h / 18));
      g.drawImage(sprite, SQP[o] - r, SQP[o + 1] - r, r * 2, r * 2);
    }
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    for (const [i, h] of shown) { g.fillStyle = rgba(ramp(h), 0.92 * a); quad(g, i); }
  }
  // flat squares in one colour (or a colour per square)
  function flat(g, a, idx, colour, alpha) {
    for (const i of idx) { if (!place(i)) continue; g.fillStyle = typeof colour === "function" ? colour(i) : colour; g.globalAlpha = a * alpha; quad(g, i); }
    g.globalAlpha = 1;
  }
  const ALL = SQ.map((_, i) => i);

  // ---- the clock: hours since the first detection ----
  let clock = 0, onClock = () => {};
  let lastClock = NaN;
  const tellClock = (h) => { if (h !== lastClock) { lastClock = h; onClock(h); } };

  // ---- wind: particles advected by the ERA5 grid, drawn on a canvas over the map ----
  const cv = document.getElementById("wind"), g2 = cv.getContext("2d");
  let windOn = false, parts = [];
  const sizeCanvas = () => {
    const r = Math.min(devicePixelRatio, 2);
    cv.width = el.clientWidth * r; cv.height = el.clientHeight * r;
    g2.setTransform(r, 0, 0, r, 0, 0);
  };
  sizeCanvas();
  new ResizeObserver(sizeCanvas).observe(el);
  const Wd = D.wind, nx = Wd.lons.length, ny = Wd.lats.length;
  const windAt = (lon, lat, hAbs) => {
    let hi = (D.t0 + hAbs * 3600000 - Wd.t0) / 3600000;
    hi = Math.max(0, Math.min(Wd.n - 1.001, hi));
    const h0 = Math.floor(hi), ht = hi - h0;
    const fx2 = Math.max(0, Math.min(nx - 1.001, ((lon - Wd.lons[0]) / (Wd.lons[nx - 1] - Wd.lons[0])) * (nx - 1)));
    const fy = Math.max(0, Math.min(ny - 1.001, ((lat - Wd.lats[0]) / (Wd.lats[ny - 1] - Wd.lats[0])) * (ny - 1)));
    const i = Math.floor(fx2), j = Math.floor(fy), u = fx2 - i, v = fy - j;
    const at = (arr, hh, a, b) => arr[hh * nx * ny + b * nx + a] * Wd.scale;
    const bil = (arr, hh) => (at(arr, hh, i, j) * (1 - u) + at(arr, hh, i + 1, j) * u) * (1 - v) + (at(arr, hh, i, j + 1) * (1 - u) + at(arr, hh, i + 1, j + 1) * u) * v;
    return [bil(Wd.u, h0) * (1 - ht) + bil(Wd.u, h0 + 1) * ht, bil(Wd.v, h0) * (1 - ht) + bil(Wd.v, h0 + 1) * ht];
  };
  const seed = () => {
    const b = map.getBounds();
    return { lon: b.getWest() + Math.random() * (b.getEast() - b.getWest()), lat: b.getSouth() + Math.random() * (b.getNorth() - b.getSouth()), age: Math.random() * 80 };
  };
  let lastT = 0;
  const windLoop = (now) => {
    if (!windOn) return;
    const dt = Math.min(0.05, (now - (lastT || now)) / 1000);
    lastT = now;
    const W = el.clientWidth, H = el.clientHeight;
    if (map.isMoving()) {          // streaks drawn while the camera moves smear into arcs
      g2.clearRect(0, 0, W, H);
      for (const p of parts) Object.assign(p, seed());
      requestAnimationFrame(windLoop);
      return;
    }
    g2.globalCompositeOperation = "destination-in";
    g2.fillStyle = "rgba(0,0,0,0.86)";
    g2.fillRect(0, 0, W, H);
    g2.globalCompositeOperation = "source-over";
    g2.lineWidth = 1;
    g2.strokeStyle = "rgba(225, 232, 245, 0.3)";
    g2.beginPath();
    const SPEED = 0.55;   // hours of air travel drawn per second: streak speed is scaled for visibility
    for (const p of parts) {
      const [u, v] = windAt(p.lon, p.lat, clock);
      const a = map.project([p.lon, p.lat]);
      p.lon += (u * SPEED * dt) / kx;
      p.lat += (v * SPEED * dt) / 110.57;
      const b = map.project([p.lon, p.lat]);
      g2.moveTo(a.x, a.y); g2.lineTo(b.x, b.y);
      if (--p.age < 0 || b.x < -20 || b.y < -20 || b.x > W + 20 || b.y > H + 20) Object.assign(p, seed(), { age: 60 + Math.random() * 60 });
    }
    g2.stroke();
    requestAnimationFrame(windLoop);
  };
  const wind = (on) => {
    if (on === windOn) return;
    windOn = on;
    cv.style.opacity = on ? 1 : 0;
    if (on) { parts = Array.from({ length: el.clientWidth < 760 ? 280 : 520 }, seed); lastT = 0; requestAnimationFrame(windLoop); }
    else setTimeout(() => !windOn && g2.clearRect(0, 0, cv.width, cv.height), 900);
  };

  // ---- start: the strike, then the first day and a half, square by square ----
  function strike() {
    fx.strike(() => { const p = map.project(ignite); return [p.x, p.y]; }, () => {
      // hit, and go: a white-hot point for a moment, then the first square
      set("spark", "circle-opacity", 1);
      const t0 = performance.now();
      loop((now) => {
        const k = Math.min(1, (now - t0) / 900);
        set("spark", "circle-radius", 3 + 7 * Math.sin(k * Math.PI));
        set("spark", "circle-color", k < 0.5 ? "#fff4cf" : "#ffc061");
        return k < 1;
      });
      later(700, () => set("spark", "circle-opacity", 0));
      later(350, lightFire);
    });
  }
  // ---- the fire: one unbroken animation from the strike. First the nine squares of the 2:07 pm pass, one after
  // another; they hold, ageing white to red, until the growth is asked for (the story reaching "Five days of passes",
  // or HOLD seconds, whichever is first). Then the five days of passes pile up over GROW2 seconds while the camera eases
  // out to the whole fire. It is not token-bound: leaving "start" for "pixels" keeps it running; any other mode ends it.
  const GAP = 0.32, HOLD = 17, GROW2 = 10;
  let fire = null;
  const isFirst = new Set(first.map((f) => f.i));
  function lightFire() {
    const t0 = performance.now(), me = { t0, growAt: null };
    fire = me;
    paint((g, now, a) => {
      const s3 = (now - t0) / 1000, list = [];
      for (const f of first) { const ts = f.ts / 0.18 * GAP; if (ts <= s3) list.push([f.i, Math.min(RED, (s3 - ts) * RATE)]); }
      if (me.growAt != null && s3 >= me.growAt) {
        const u = Math.min(1, (s3 - me.growAt) / GROW2), h = u * hmax;
        clock = h; tellClock(h);
        for (let i = 0; i < SQ.length; i++) {
          if (isFirst.has(i) || SQ[i].h > h) continue;
          list.push([i, Math.min(RED, (s3 - me.growAt - (SQ[i].h / hmax) * GROW2) * RATE)]);
        }
      } else if (list.length) tellClock(0);
      burn(g, a, list);
      return fire === me;
    });
    setTimeout(() => fire === me && (mode === "start" || mode === "pixels") && grow(), HOLD * 1000);
  }
  // the five days begin (once): the squares pile up, and the camera eases out to hold the whole fire
  function grow() {
    if (!fire || fire.growAt != null) return;
    fire.growAt = (performance.now() - fire.t0) / 1000;
    fitFire({ pitch: 0, bearing: 0, duration: GROW2 * 1000, easing: ease });
  }

  // ---- sat: Aqua's pass, its strip painting the globe ----
  const Q = dest(ignite, PASS.heading + 90, PASS.offset);
  const track = (km) => dest(Q, PASS.heading, km);
  const edges = (km) => {
    const a = track(km), b = bearing(a, track(km + 20));
    return [dest(a, b - 90, PASS.half), dest(a, b + 90, PASS.half)];
  };
  let strip = { L: [], R: [] };
  function drawStrip(fill, line) {
    if (strip.L.length < 2) return;
    const g = fx.ctx, P = (c) => map.project(c);
    const L = strip.L.map(P), R = strip.R.map(P);
    g.beginPath();
    L.forEach((p, k) => (k ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    for (let k = R.length - 1; k >= 0; k--) g.lineTo(R[k].x, R[k].y);
    g.closePath();
    g.fillStyle = `rgba(207, 227, 255, ${fill})`; g.fill();
    g.strokeStyle = `rgba(207, 227, 255, ${line})`; g.lineWidth = 1;
    for (const side of [L, R]) { g.beginPath(); side.forEach((p, k) => (k ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke(); }
  }
  function pass() {
    const t0 = performance.now();
    let seen = false, pingAt = 0;
    strip = { L: [], R: [] };
    tellClock(0);
    loop((now) => {
      const k = Math.min(1, (now - t0) / 1000 / PASS.seconds);
      const km = PASS.from + (PASS.to - PASS.from) * k;
      const [l, r] = edges(km);
      strip.L.push(l); strip.R.push(r);
      // the satellite, 705 km up: pushed out from the globe's centre by (R + 705) / R
      const c = map.project(map.getCenter()), p = map.project(track(km)), p2 = map.project(track(km + 50));
      const up = (RE + 705) / RE * 1.02;
      const S = { x: c.x + (p.x - c.x) * up, y: c.y + (p.y - c.y) * up };
      const pl = map.project(l), pr = map.project(r);
      fx.clear();
      drawStrip(0.08, 0.4);
      fx.drawSat({ x: S.x, y: S.y, angle: Math.atan2(p2.y - p.y, p2.x - p.x), cone: [[pl.x, pl.y], [pr.x, pr.y]], alpha: k > 0.94 ? (1 - k) / 0.06 : 1 });
      if (!seen && km >= 0) { seen = true; pingAt = now; set("speck", "circle-opacity", 1); }
      if (seen && now - pingAt < 1400) { const f = map.project(spot0); fx.ping(f.x, f.y, (now - pingAt) / 1400); }
      if (k >= 1) { beacon(now); return false; }
    });
  }
  // then the strip fades back, and the speck keeps calling
  function beacon(t0) {
    loop((now) => {
      const u = Math.min(1, (now - t0) / 900), k = ((now - t0) % 2000) / 1400, f = map.project(spot0);
      fx.clear();
      drawStrip(0.08 - 0.05 * u, 0.4 - 0.25 * u);
      if (k < 1) fx.ping(f.x, f.y, k);
    });
  }

  // ---- spot: the satellite looks closer. Brackets lock onto the speck and the camera sinks towards it in one
  // smooth dive; new brackets keep opening out of the middle as it goes, one for every equal step of zoom (so they
  // nest evenly however fast the dive is going), until the speck is one square of heat and a last bracket closes
  // around it (the square nearest to where the bolt will land; the other eight of that pass come with the lightning,
  // in "start") ----
  const at = () => { const p = map.project(spot0); return [p.x, p.y]; };
  const ZSTEP = 0.8;      // zoom levels between brackets: each is 1.74 times the one inside it
  async function zoomIn(prev) {
    const t = token, alive = () => t === token;
    const Z = narrow() ? 10.6 : 11.4 + squeeze();
    set("speck", "circle-opacity", 1);
    tellClock(0);
    // the fire to the middle first, at the satellite's height
    if (map.getZoom() > 7.5) map.jumpTo({ center: spot0, zoom: 4, pitch: 0, bearing: 0, padding: pad() });
    else {
      const moved = new Promise((r) => map.once("moveend", r));
      map.easeTo({ center: spot0, pitch: 0, bearing: 0, padding: pad(), duration: prev === "sat" ? 1600 : 900, easing: ease });
      let panning = true;
      loop(() => { fx.clear(); if (prev === "sat") drawStrip(0.03, 0.15); return panning; });   // the faded strip, while it pans
      await moved;
      panning = false;
      if (!alive()) return;
    }
    const cued = await orbitCue("z1");
    if (!alive()) return;
    if (!cued) await wait(300);
    if (!alive()) return;
    const z0 = map.getZoom(), T = 3600, t0 = performance.now();
    map.easeTo({ center: spot0, zoom: Z, duration: T, easing: ease, padding: pad() });
    const spawns = [];
    // half the square's width on screen, and the last bracket: it closes from the inner bracket's size onto the square
    const half = () => { const c = map.project(spot0), e = map.project(SQ[first[0].i].ex); return Math.abs(e.x - c.x); };
    let last = null;
    loop((now) => {
      const s2 = now - t0, zNow = map.getZoom();
      if (s2 < T - 600 && (!spawns.length || zNow - spawns[spawns.length - 1].z >= ZSTEP)) spawns.push({ t: s2, z: spawns.length ? spawns[spawns.length - 1].z + ZSTEP : zNow });
      fx.clear();
      for (const b of spawns) {
        const age = s2 - b.t, lockK = Math.min(1, age / 280);
        const r = (58 - 32 * (1 - (1 - lockK) ** 3)) * Math.pow(2, zNow - b.z);
        const alpha = Math.min(1, age / 140) * Math.max(0, 1 - (r - 26) / 260) * (s2 > T ? Math.max(0, 1 - (s2 - T) / 400) : 1);
        if (alpha > 0.01) fx.reticle(...at(), r, alpha);
      }
      if (s2 > T - 350) {
        last ??= s2;
        const k = Math.min(1, (s2 - last) / 420), fit = half() + 5;
        const r = 26 + (fit - 26) * (1 - (1 - k) ** 3);
        const alpha = Math.min(1, (s2 - last) / 120) * (s2 > T + 1400 ? Math.max(0, 1 - (s2 - T - 1400) / 600) : 1);
        if (alpha > 0.01) fx.reticle(...at(), r, alpha);
      }
      if (s2 > T + 2100) { fx.clear(); return false; }
    });
    // the speck melts into one square: white-hot, cooling to red
    later(T - 350, () => {
      set("speck", "circle-opacity", 0);
      const t1 = performance.now();
      paint((g, now, a) => {
        const s3 = (now - t1) / 1000;
        burn(g, a, [[first[0].i, Math.min(RED, s3 * RATE)]]);
        return s3 < 2 + RED / RATE;
      });
    });
  }

  // ---- pixels: every pass, one after another; each square ages as it does on the spread map ----
  function pixels(replay) {
    const t0 = performance.now() - (replay ? 0 : (PIX + 8) * 1000);
    paint((g, now, a) => {
      const s2 = (now - t0) / 1000, h = Math.min(hmax, (s2 / PIX) * hmax);
      clock = h; tellClock(h);
      const list = [];
      for (let i = 0; i < SQ.length; i++) if (SQ[i].h <= h) list.push([i, Math.min(RED, (s2 - (SQ[i].h / hmax) * PIX) * RATE)]);
      burn(g, a, list);
      return s2 < PIX + RED / RATE + 0.5;
    });
  }
  // ---- spread: five days on a loop, with the wind ----
  function spreading() {
    const t0 = performance.now(), HOLD = 2.5;
    paint((g, now, a) => {
      const s2 = (now - t0) / 1000, k = (s2 / SPREAD) % (1 + HOLD / SPREAD);
      clock = hmax * Math.min(1, k); tellClock(clock);
      const list = [];
      for (let i = 0; i < SQ.length; i++) if (SQ[i].h <= clock) list.push([i, clock - SQ[i].h]);
      burn(g, a, list);
      return true;
    });
  }

  // ---- split: the 2016 rule's pieces, one after another, each its own colour ----
  let onCount = () => {};
  let orbitCue = () => Promise.resolve(false);     // (mark) => Promise<bool>: the narrator reaching a word
  const faint = (g, a) => flat(g, a, ALL, FIRE, 0.12);
  function pieces(delay) {
    const t0 = performance.now() + delay, T = 4200, came = new Array(n16).fill(null);
    let shownCount = -1;
    onCount(0);
    paint((g, now, a) => {
      const k = Math.max(0, Math.min(1, (now - t0) / T)), m = Math.round(n16 * k * k * (3 - 2 * k));
      if (m !== shownCount) { shownCount = m; onCount(m); }
      for (let j = 0; j < m; j++) if (came[order[j]] == null) came[order[j]] = now;
      faint(g, a);
      for (let i = 0; i < SQ.length; i++) {
        const p = SQ[i].e16, c0 = came[p];
        if (c0 == null || !place(i)) continue;
        g.globalAlpha = a * 0.95 * Math.min(1, (now - c0) / 260);
        g.fillStyle = pal[p]; quad(g, i);
      }
      g.globalAlpha = 1;
      return k < 1 || now - t0 < T + 300;
    });
  }
  // ---- one: they turn orange, the smallest first, into the one fire ----
  function join() {
    const t0 = performance.now(), T = 2400, STEP = T / n16;
    const turn = (p) => (n16 - 1 - p) * STEP;          // e16 is ranked biggest first: the smallest turns first
    paint((g, now, a) => {
      const t = now - t0;
      for (let i = 0; i < SQ.length; i++) {
        if (!place(i)) continue;
        const p = SQ[i].e16, u = Math.max(0, Math.min(1, (t - turn(p)) / 380));
        if (u < 1) { g.globalAlpha = a * 0.95 * (1 - u); g.fillStyle = pal[p]; quad(g, i); }
        if (u > 0) { g.globalAlpha = a * 0.92 * u; g.fillStyle = FIRE; quad(g, i); }
      }
      g.globalAlpha = 1;
      return t < T + 500;
    });
    later(T + 300, () => { set("perim", "line-opacity", 0.9); set("perim-fill", "fill-opacity", 0.06); });
    later(T + 900, showLabel);
  }
  function showLabel() {
    const t = `SODA FIRE\n${D.fire.acres.toLocaleString("en-US")} acres`;
    map.getSource("label").setData(pt([(w + e) / 2, n + 0.012], { t, a: "bottom" }));
    set("label", "text-opacity", 1);
  }

  // ---- descend: the drone's survey, seen from outside, the way the satellite's pass was. It flies east–west
  // passes 20 m apart, 44 m up, and the ground its camera has covered lights up inside the white square. The path
  // is drawn to show the pattern (the dataset has the height and pattern, not each photo's position); each pass
  // covers the 56 m strip one photo spans across the track (Mavic 2 Pro from 44 m), and the drone is drawn many
  // times its size ----
  const SITE = { w: sw, h: sh, x0: dlon - ddx, y0: dlat - ddy };
  const ll = ([x, y]) => [SITE.x0 + x / 1000 / kx, SITE.y0 + y / 1000 / 110.57];
  const FLY = { alt: 44, across: 56.5, gap: 20, run: 30, seconds: 10 };
  const legs = [];
  for (let y = 10, k = 0; y < sh; y += FLY.gap, k++) legs.push(k % 2 ? [[sw + FLY.run, y], [-FLY.run, y]] : [[-FLY.run, y], [sw + FLY.run, y]]);
  const legLen = sw + 2 * FLY.run;
  const turnLen = FLY.gap;
  const pathLen = legs.length * legLen + (legs.length - 1) * turnLen;
  // where the drone is after `d` metres: [x, y], heading [dx, dy], and how far along its current pass (null in a turn)
  function along(d) {
    for (let k = 0; k < legs.length; k++) {
      const [a, b] = legs[k];
      if (d <= legLen || k === legs.length - 1) {
        const u = Math.min(1, d / legLen);
        return { xy: [a[0] + (b[0] - a[0]) * u, a[1]], dir: [b[0] - a[0], 0], leg: k, u };
      }
      d -= legLen;
      if (d <= turnLen) { const end = b; return { xy: [end[0], end[1] + d], dir: [0, 1], leg: k, u: 1, turning: true }; }
      d -= turnLen;
    }
  }
  function flight() {
    const t0 = performance.now(), T = FLY.seconds * 1000;
    const P = (xy) => map.project(ll(xy));
    const square = [[0, 0], [sw, 0], [sw, sh], [0, sh]];
    loop((now) => {
      const k = Math.min(1, (now - t0) / T), pos = along(k * pathLen);
      const g = fx.ctx;
      fx.clear();
      // the covered ground, pass by pass, kept inside the square
      g.save();
      g.beginPath(); square.map(P).forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.clip();
      g.fillStyle = "rgba(242, 239, 232, 0.13)";
      for (let i = 0; i <= pos.leg; i++) {
        const [a, b] = legs[i], u = i < pos.leg ? 1 : pos.u, x1 = a[0] + (b[0] - a[0]) * u, y = a[1], h = FLY.across / 2;
        const q = [[a[0], y - h], [x1, y - h], [x1, y + h], [a[0], y + h]].map(P);
        g.beginPath(); q.forEach((p, j) => (j ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.fill();
      }
      g.restore();
      // the drone, 44 m above the ground under it: lifted on screen by its height at this zoom and tilt
      const ground = P(pos.xy), east = P([pos.xy[0] + 10, pos.xy[1]]);
      const ppm = Math.hypot(east.x - ground.x, east.y - ground.y) / 10;
      const lift = FLY.alt * ppm * Math.sin(map.getPitch() * rad);
      const ahead = P([pos.xy[0] + pos.dir[0] * 0.01, pos.xy[1] + pos.dir[1] * 0.01]);
      const fade = k < 0.06 ? k / 0.06 : k > 0.94 ? (1 - k) / 0.06 : 1;
      // its camera's view, down to the strip it is photographing
      const h = FLY.across / 2, w = 19;
      const foot = [[pos.xy[0] - w, pos.xy[1] - h], [pos.xy[0] + w, pos.xy[1] - h], [pos.xy[0] + w, pos.xy[1] + h], [pos.xy[0] - w, pos.xy[1] + h]].map(P);
      fx.drawDrone({ x: ground.x, y: ground.y - lift, shadow: [ground.x, ground.y], angle: Math.atan2(ahead.y - ground.y, ahead.x - ground.x),
        size: Math.max(16, Math.min(34, ppm * 30)), foot: pos.turning ? null : foot.map((p) => [p.x, p.y]), alpha: fade, now });
      return k < 1;
    });
  }

  // ---- us: the other fires ----
  let natData = null;
  let onPct = () => {};
  function setNational(N) {
    const c = N.cols, ix = (k) => c.indexOf(k);
    let seed2 = 3;
    const rnd = () => ((seed2 = (seed2 * 16807) % 2147483647) / 2147483647);
    const fires = N.fires.map((f) => ({ c: [f[ix("lon")], f[ix("lat")]], o16: f[ix("ok16")] ? 1 : 0, ow: f[ix("okw")] ? 1 : 0, r: rnd() }));
    // running share counted correctly as the fires turn over, in the order they turn
    const sorted = fires.slice().sort((a, b) => a.r - b.r);
    let ok = fires.reduce((t, f) => t + f.o16, 0);
    const steps = [ok];
    for (const p of sorted) { ok += p.ow - p.o16; steps.push(ok); }
    natData = { n: fires.length, fires, sorted, steps };
  }
  // right under the 2016 rule: yellow, and they stay yellow. Fixed by more room: orange, with a ring that spreads.
  // Broken by it, or wrong both ways: grey.
  const YEL = hex("#ffd36e"), ORA = hex(FIRE), GRY = hex(GREY);
  let natP = -1;
  function dots(g, a) {
    const z = map.getZoom(), rr = Math.min(4, z <= 2 ? 1.6 : z <= 4 ? 1.6 + (z - 2) * 0.6 : 2.8 + (z - 4) * 0.6);
    const layers = [[], [], []];          // grey, yellow, orange: drawn in that order, so the news sits on top
    for (const f of natData.fires) {
      const turned = natP > f.r;
      const now = turned ? f.ow : f.o16;
      const cls = !now ? 0 : turned && !f.o16 ? 2 : 1;
      const al = cls === 0 ? (turned && f.o16 ? 0.8 : 0.5) : cls === 1 ? (natP > 0 ? 0.8 : 0.95) : 1;
      layers[cls].push([f, al]);
    }
    layers.forEach((L, cls) => {
      const col = [GRY, YEL, ORA][cls];
      for (const [f, al] of L) {
        const p = map.project(f.c);
        g.fillStyle = rgba(col, al * a);
        g.beginPath(); g.arc(p.x, p.y, cls === 2 ? rr * 1.15 : rr, 0, Math.PI * 2); g.fill();
        const d = natP - f.r;
        if (cls === 2 && d > 0 && d < 0.12) {          // a ring that spreads from each fire as more room fixes it
          g.strokeStyle = rgba(ORA, (0.9 - 7.5 * d) * a); g.lineWidth = 1.2;
          g.beginPath(); g.arc(p.x, p.y, 3 + 90 * d, 0, Math.PI * 2); g.stroke();
        }
      }
    });
  }
  function turnOver() {
    if (!natData) return;
    natP = -1;
    onPct(natData.steps[0] / natData.n, 0);
    let moving = false;
    paint((g, now, a) => { dots(g, a); return moving; });
    // with the narrator, the change starts on "Now watch the bright ones"; without, after a pause
    const t = token;
    Promise.all([orbitCue("flip"), wait(2600)]).then(([cued]) => t === token && later(cued ? 0 : 2400, () => {
      const t0 = performance.now(), T = 5200;
      moving = true;
      loop((now) => {
        const k = Math.min(1, (now - t0) / T);
        natP = k >= 1 ? 2 : k * 1.12;
        const m = natData.sorted.findIndex((p) => p.r >= natP);
        onPct(natData.steps[m < 0 ? natData.n : m] / natData.n, k);
        map.triggerRepaint();
        if (k >= 1) { moving = false; return false; }
      });
    }));
  }

  // ---- modes ----
  let mode = null;
  function setMode(m) {
    if (m === mode) return;
    const prev = mode;
    mode = m;
    token++;
    fx.clear();
    wind(m === "spread");
    const imagery = m === "descend", space = m === "sat" || m === "spot";   // the satellite's own view, all the way in
    const far = m === "us";
    const globe = space || m === "intro";
    set("img", "raster-opacity", imagery ? 1 : globe ? 0.85 : 0);
    set("img", "raster-brightness-max", m === "intro" ? 0.55 : space ? 0.7 : imagery ? 0.78 : 1);
    set("hill", "hillshade-exaggeration", imagery || globe ? 0 : 0.55);
    set("border", "line-opacity", imagery || m === "intro" ? 0 : space ? 0.5 : 1);
    set("states", "text-opacity", m === "intro" || imagery || space || far ? 0 : 0.75);
    set("site", "line-opacity", imagery ? 1 : 0);
    const joining = m === "one" && prev === "split";
    set("perim", "line-opacity", m === "one" && !joining ? 0.9 : m === "spread" ? 0.35 : imagery ? 0.6 : 0);
    set("perim-fill", "fill-opacity", m === "one" && !joining ? 0.06 : 0);
    set("spark", "circle-opacity", 0);
    set("speck", "circle-opacity", 0);
    set("label", "text-opacity", m === "one" && !joining ? 1 : 0);
    if (!["spot", "start", "pixels", "split", "one", "us", "spread", "descend"].includes(m)) paint(null);
    if (m !== "start" && m !== "pixels") fire = null;
    lastClock = NaN;

    if (m === "intro") {
      // the whole Earth behind the title, turning slowly westward
      const z = narrow() ? 1.1 : 1.7;
      const spin = () => {
        let lon = map.getCenter().lng, last = performance.now();
        loop((now) => { lon -= (now - last) / 1000 * 1.2; last = now; map.jumpTo({ center: [lon, GLOBE[1]] }); });
      };
      if (!prev) spin();
      else { map.flyTo({ center: GLOBE, zoom: z, pitch: 0, bearing: 0, duration: 2600, padding: { top: 0, bottom: 0, left: 0, right: 0 } }); arrive(spin); }
    } else if (m === "sat") {
      paint(null); tellClock(0);
      map.flyTo({ center: [-110.5, 40.5], zoom: narrow() ? 1.6 : 2.45 + squeeze(), pitch: 0, bearing: 0, duration: 4200, curve: 1.2, essential: true, easing: ease,
        padding: narrow() ? { top: 60, bottom: el.clientHeight * 0.3, left: 0, right: 0 } : { left: el.clientWidth * 0.3, top: 0, right: 0, bottom: 0 } });
      arrive(() => later(150, pass));
    } else if (m === "spot") {
      paint(null);
      zoomIn(prev);
    } else if (m === "start") {
      fire = null; paint(null); tellClock(null);
      map.flyTo({ center: ignite, zoom: narrow() ? 9.6 : 10.4 + squeeze(), pitch: 55, bearing: -8, duration: 2400, essential: true, easing: ease,
        padding: narrow() ? { top: 0, bottom: el.clientHeight * 0.3, left: 0, right: 0 } : { left: el.clientWidth * 0.32, top: 0, right: 0, bottom: 0 } });
      // with the narrator, the bolt lands on the word "lightning"; without, as soon as the camera arrives
      arrive(() => { const t = token; orbitCue("strike").then((cued) => t === token && later(cued ? 0 : 200, strike)); });
    } else if (m === "pixels") {
      if (fire && prev === "start") grow();          // the fire from the strike carries on; only the caption changed
      else {
        fitFire({ pitch: 0, bearing: 0, duration: 2400, easing: ease });
        const replay = ["sat", "spot", "start", "intro", null].includes(prev);
        paint(null);
        if (replay) later(1200, () => pixels(true)); else pixels(false);
      }
    } else if (m === "split" || m === "one") {
      clock = hmax; tellClock(hmax);
      // reframe unless the camera already shows the whole fire, flat
      const settled = map.getPitch() < 1 && map.getZoom() > 7 && map.getBounds().contains([(w + e) / 2, (s + n) / 2]);
      if (!settled) fitFire({ pitch: 0, bearing: 0, easing: ease });
      if (m === "split") pieces(settled ? 400 : 2400);
      else if (joining) later(400, join);
      else { paint((g, now, a) => { flat(g, a, ALL, FIRE, 0.92); return false; }); showLabel(); }
    } else if (m === "us") {
      fit([[-124.5, 25], [-67, 49]], { padding: narrow() ? { top: 70, bottom: el.clientHeight * 0.42, left: 14, right: 14 } : { ...pad(), left: Math.max(580, el.clientWidth * 0.47), right: 50 }, pitch: 0, bearing: 0, duration: 3000, easing: ease });
      paint(null); turnOver();
    } else if (m === "spread") {
      fitFire({ pitch: 35, bearing: -12, easing: ease });
      spreading();
    } else if (m === "descend") {
      paint((g, now, a) => { flat(g, a, ALL, FIRE, 0.18); return false; });
      map.flyTo({ center: [dlon, dlat], zoom: narrow() ? 16.4 : 17.2 + squeeze(), pitch: 45, bearing: -20, duration: 5200, curve: 1.6, essential: true,
        padding: narrow() ? { top: 0, bottom: el.clientHeight * 0.3, left: 0, right: 0 } : { left: el.clientWidth * 0.3, top: 0, right: 0, bottom: 0 } });
      // with the narrator, the drone takes off on "Back and forth"; without, once the camera has arrived
      arrive(() => { const t = token; orbitCue("drone").then((cued) => t === token && later(cued ? 0 : 400, flight)); });
    }
  }

  return {
    map, setMode, setNational, fx,
    set onClock(f) { onClock = f; },
    set onCount(f) { onCount = f; },
    set onPct(f) { onPct = f; },
    set cue(f) { orbitCue = f; },
    get clock() { return clock; },
    get mode() { return mode; },
    resize: () => map.resize(),
  };
}
