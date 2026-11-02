// Small fire pictures: every hot spot of one fire, first coloured by the 2016 rule's pieces (many colours),
// then by the wider window's (one orange fire). Used on the front page ("Was that luck?") and on the proof page.

const FIRE = "#ff6a2b";
const LEFTOVER = "#6d6a64";

// the same colour walk as the Soda map (orbit.js), so "many colours" means the same thing everywhere
export function palette(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const h = (190 + i * 137.508) % 360;
    const hh = h > 10 && h < 45 ? h + 40 : h;
    out.push(`hsl(${hh.toFixed(0)}, ${i % 2 ? 55 : 70}%, ${i % 3 === 0 ? 62 : 70}%)`);
  }
  return out;
}

// one fire: { name, state, year, p16, pw, dets: [[lon, lat, hours, piece16, pieceWide], ...], perimeter? }
export function firePanel(fire, { size = 160, label = true } = {}) {
  const wrap = document.createElement("figure");
  wrap.className = "firepanel";
  const cv = document.createElement("canvas");
  wrap.append(cv);
  if (label) {
    wrap.insertAdjacentHTML("beforeend", `<figcaption><span class="fn">${fire.name}</span><span class="fs">${fire.state} · ${fire.year}</span>
      <span class="fc"><b class="a">${fire.p16}</b><i>→</i><b class="b">${fire.pw}</b></span></figcaption>`);
  }
  const ctx = cv.getContext("2d");
  const lons = fire.dets.map((d) => d[0]), lats = fire.dets.map((d) => d[1]);
  const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2, lon0 = (Math.min(...lons) + Math.max(...lons)) / 2;
  const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180), ky = 110.57;
  const span = Math.max((Math.max(...lons) - Math.min(...lons)) * kx, (Math.max(...lats) - Math.min(...lats)) * ky) * 1.12 + 2;
  const pal = palette(Math.max(...fire.dets.map((d) => d[3])) + 1);
  let k = 0, px = size, dpr = 1;

  function draw() {
    const S = px * dpr, s = S / span;                         // pixels per km
    const X = (lon) => S / 2 + (lon - lon0) * kx * s, Y = (lat) => S / 2 - (lat - lat0) * ky * s;
    ctx.clearRect(0, 0, S, S);
    if (fire.perimeter) {                                     // the official outline, faint
      ctx.strokeStyle = "rgba(242, 239, 232, .32)"; ctx.lineWidth = Math.max(1, dpr * 0.8);
      const polys = fire.perimeter.type === "Polygon" ? [fire.perimeter.coordinates] : fire.perimeter.coordinates;
      ctx.beginPath();
      for (const poly of polys) for (const ring of poly) ring.forEach(([a, b], i) => (i ? ctx.lineTo(X(a), Y(b)) : ctx.moveTo(X(a), Y(b))));
      ctx.stroke();
    }
    const w = Math.max(1.6 * dpr, s * 1.0);                   // a MODIS pixel is about 1 km across
    for (const [lon, lat, , a, b] of fire.dets) {
      const x = X(lon) - w / 2, y = Y(lat) - w / 2;
      if (k < 1) { ctx.globalAlpha = 0.9 * (1 - k); ctx.fillStyle = pal[a]; ctx.fillRect(x, y, w, w); }
      if (k > 0) { ctx.globalAlpha = 0.9 * k; ctx.fillStyle = b === 0 ? FIRE : LEFTOVER; ctx.fillRect(x, y, w, w); }
    }
    ctx.globalAlpha = 1;
  }
  function fit(width) {
    px = width; dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = cv.height = Math.round(px * dpr);
    cv.style.width = cv.style.height = `${px}px`;
    draw();
  }
  let raf = 0;
  const api = {
    el: wrap,
    fit,
    // 0 = the 2016 rule's pieces, 1 = the wider window
    set(v, ms = 0) {
      cancelAnimationFrame(raf);
      wrap.classList.toggle("merged", v === 1);
      if (!ms || matchMedia("(prefers-reduced-motion: reduce)").matches) { k = v; draw(); return; }
      const from = k, t0 = performance.now();
      const step = (t) => {
        const u = Math.min(1, (t - t0) / ms);
        k = from + (v - from) * (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
        draw();
        if (u < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    },
  };
  fit(size);
  return api;
}
