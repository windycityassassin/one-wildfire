// Effects drawn on a canvas over the map: the lightning strike that started the fire, the satellite that
// saw it, and the drone that flew over the burn seven years later. Both are illustrations (the strike point and the satellite's size are drawn, not measured); the
// source notes "Where the bolt is drawn" and "One pass" say so.

export function initFx(cv, el) {
  const g = cv.getContext("2d");
  let W = 0, H = 0;
  const size = () => {
    const r = Math.min(devicePixelRatio, 2);
    W = el.clientWidth; H = el.clientHeight;
    cv.width = W * r; cv.height = H * r;
    g.setTransform(r, 0, 0, r, 0, 0);
  };
  size();
  new ResizeObserver(size).observe(el);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- lightning: a jagged bolt from above the screen to (x, y), a flash, two flickers, then a spark ----
  // midpoint displacement, down to 2 px steps: the fine kinks are what make a bolt look sharp
  function jag(x0, y0, x1, y1, rough, out) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 2) { out.push([x1, y1]); return; }
    const nx = -(y1 - y0) / len, ny = (x1 - x0) / len, k = (Math.random() - 0.5) * len * rough;
    const mx = (x0 + x1) / 2 + nx * k, my = (y0 + y1) / 2 + ny * k;
    jag(x0, y0, mx, my, rough, out);
    jag(mx, my, x1, y1, rough, out);
  }
  function makeBolt(x, y) {
    const main = [[x + (Math.random() - 0.5) * 220, -30]];
    jag(main[0][0], main[0][1], x, y, 0.32, main);
    const branches = [];
    for (let k = 0; k < 5; k++) {
      const a = main[Math.floor(main.length * (0.12 + Math.random() * 0.6))];
      const l = 40 + Math.random() * 120, dir = Math.random() < 0.5 ? -1 : 1;
      const b = [a];
      jag(a[0], a[1], a[0] + dir * l * (0.4 + Math.random() * 0.5), a[1] + l, 0.4, b);
      branches.push(b);
    }
    return { main, branches };
  }
  function drawBolt(b, alpha) {
    const line = (pts, w) => { g.beginPath(); g.moveTo(...pts[0]); for (const p of pts) g.lineTo(...p); g.lineWidth = w; g.stroke(); };
    g.save();
    g.lineJoin = "miter"; g.lineCap = "butt";
    // a thin halo, then a hard white core
    g.shadowColor = `rgba(160, 180, 255, ${alpha})`; g.shadowBlur = 6;
    g.strokeStyle = `rgba(175, 195, 255, ${alpha * 0.45})`;
    line(b.main, 3); b.branches.forEach((x) => line(x, 1.6));
    g.shadowBlur = 0;
    g.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
    line(b.main, 1.7); b.branches.forEach((x) => line(x, 0.9));
    g.restore();
  }
  function flash(a) { g.fillStyle = `rgba(205, 215, 255, ${a})`; g.fillRect(0, 0, W, H); }
  let boltRaf = 0;
  // where() is asked every frame, so the strike stays on its spot if the map moves underneath
  function strike(where, onHit) {
    cancelAnimationFrame(boltRaf);
    if (reduced) { onHit?.(); return; }
    let b = null, b2 = null, hit = false;
    const t0 = performance.now();
    // hit and go: a leader, a gap, the main stroke down the same channel, then a quick fade
    const HIT = 110, frames = [[0, 0.8, 0.1], [60, 0, 0], [HIT, 1, 0.22], [170, 1, 0.05]];
    const END = 480, FADE = 220;
    const tick = (now) => {
      const t = now - t0, [x, y] = where();
      if (!b) { b = makeBolt(x, y); b2 = { main: b.main, branches: makeBolt(x, y).branches.slice(0, 3) }; }
      g.clearRect(0, 0, W, H);
      let a = 0, f = 0;
      for (const [ft, fa, ff] of frames) if (t >= ft) { a = fa; f = ff; }
      if (t > FADE) { a = Math.max(0, 1 - (t - FADE) / (END - FADE)); f = 0; }
      if (f) flash(f);
      if (a) drawBolt(t >= HIT ? b2 : b, a);
      if (!hit && t >= HIT) { hit = true; onHit?.(); }
      if (t < END) boltRaf = requestAnimationFrame(tick);
      else g.clearRect(0, 0, W, H);
    };
    boltRaf = requestAnimationFrame(tick);
  }

  // ---- the satellite: a small body with two solar wings, its beam down to the strip it scans ----
  function drawSat(s) {
    // s: { x, y, angle, cone: [[x, y], [x, y]] | null, alpha }
    const a = s.alpha ?? 1;
    if (s.cone) {
      const [[ax, ay], [bx, by]] = s.cone;
      const grad = g.createLinearGradient(s.x, s.y, (ax + bx) / 2, (ay + by) / 2);
      grad.addColorStop(0, `rgba(190, 220, 255, ${0.26 * a})`);
      grad.addColorStop(1, `rgba(190, 220, 255, ${0.03 * a})`);
      g.fillStyle = grad;
      g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(ax, ay); g.lineTo(bx, by); g.closePath(); g.fill();
      g.strokeStyle = `rgba(200, 225, 255, ${0.5 * a})`; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
    }
    g.save();
    g.translate(s.x, s.y); g.rotate(s.angle); g.globalAlpha = a;
    g.shadowColor = "rgba(0, 0, 0, .6)"; g.shadowBlur = 8;
    // wings, across the direction of travel
    for (const side of [-1, 1]) {
      g.fillStyle = "#2c4f7c";
      g.fillRect(-7, side * 9, 14, side * 26);
      g.strokeStyle = "rgba(170, 200, 240, .7)"; g.lineWidth = 0.8;
      for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(-7, side * (9 + k * 6.5)); g.lineTo(7, side * (9 + k * 6.5)); g.stroke(); }
      g.beginPath(); g.moveTo(0, side * 9); g.lineTo(0, side * 35); g.stroke();
      g.fillStyle = "#9aa3ad"; g.fillRect(-1, side * 5, 2, side * 4);
    }
    // body: gold foil
    const body = g.createLinearGradient(-9, -7, 9, 7);
    body.addColorStop(0, "#f1d48a"); body.addColorStop(1, "#a7782d");
    g.fillStyle = body;
    g.fillRect(-10, -6, 20, 12);
    g.shadowBlur = 0;
    g.fillStyle = "#e9edf2"; g.beginPath(); g.arc(10, 0, 3, 0, Math.PI * 2); g.fill();   // the instrument, facing forward
    g.restore();
  }
  // ---- the drone, seen from above: four rotors on an X frame, its camera's view down to the ground it is
  // photographing, and its shadow on the ground below ----
  function drawDrone(d) {
    // d: { x, y, shadow: [x, y], angle, size, foot: [[x, y] × 4] | null, alpha, now }
    const a = d.alpha ?? 1, s = d.size / 2;
    if (d.foot) {
      g.fillStyle = `rgba(242, 239, 232, ${0.1 * a})`;
      g.beginPath(); g.moveTo(d.x, d.y); g.lineTo(...d.foot[0]); g.lineTo(...d.foot[1]); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(d.x, d.y); g.lineTo(...d.foot[2]); g.lineTo(...d.foot[3]); g.closePath(); g.fill();
      g.strokeStyle = `rgba(242, 239, 232, ${0.7 * a})`; g.lineWidth = 1;
      g.beginPath(); d.foot.forEach((p, k) => (k ? g.lineTo(...p) : g.moveTo(...p))); g.closePath(); g.stroke();
    }
    if (d.shadow) { g.fillStyle = `rgba(0, 0, 0, ${0.35 * a})`; g.beginPath(); g.ellipse(d.shadow[0], d.shadow[1], s * 0.9, s * 0.5, 0, 0, Math.PI * 2); g.fill(); }
    g.save();
    g.translate(d.x, d.y); g.rotate(d.angle); g.globalAlpha = a;
    g.shadowColor = "rgba(0, 0, 0, .6)"; g.shadowBlur = 6;
    g.strokeStyle = "#d9d6cf"; g.lineWidth = Math.max(1.5, s * 0.14); g.lineCap = "round";
    g.beginPath(); g.moveTo(-s * 0.7, -s * 0.7); g.lineTo(s * 0.7, s * 0.7); g.moveTo(-s * 0.7, s * 0.7); g.lineTo(s * 0.7, -s * 0.7); g.stroke();
    g.shadowBlur = 0;
    for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {        // rotors: a pale blur, spinning
      g.fillStyle = "rgba(255, 255, 255, .22)";
      g.beginPath(); g.arc(sx * s * 0.7, sy * s * 0.7, s * 0.42, 0, Math.PI * 2); g.fill();
      const r = ((d.now || 0) / 40) % Math.PI;
      g.strokeStyle = "rgba(255, 255, 255, .55)"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(sx * s * 0.7 + Math.cos(r) * s * 0.4, sy * s * 0.7 + Math.sin(r) * s * 0.4);
      g.lineTo(sx * s * 0.7 - Math.cos(r) * s * 0.4, sy * s * 0.7 - Math.sin(r) * s * 0.4); g.stroke();
    }
    g.fillStyle = "#2a2c2f"; g.fillRect(-s * 0.36, -s * 0.24, s * 0.72, s * 0.48);
    g.fillStyle = "#e9edf2"; g.beginPath(); g.arc(s * 0.42, 0, Math.max(1.5, s * 0.1), 0, Math.PI * 2); g.fill();   // the camera, facing forward
    if ((d.now || 0) % 1000 < 140) { g.fillStyle = "#ff6a2b"; g.beginPath(); g.arc(-s * 0.4, 0, Math.max(1.5, s * 0.08), 0, Math.PI * 2); g.fill(); }
    g.restore();
  }

  // a ring that spreads from a point: "seen"
  function ping(x, y, k, color = "255, 140, 70") {
    g.strokeStyle = `rgba(${color}, ${(1 - k) * 0.9})`; g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, 6 + k * 46, 0, Math.PI * 2); g.stroke();
  }

  // corner brackets closing on a point: the satellite "looking closer"
  function reticle(x, y, r, a = 1) {
    const c = r * 0.38;
    g.save();
    g.strokeStyle = `rgba(207, 227, 255, ${0.85 * a})`; g.lineWidth = 1.4;
    g.shadowColor = "rgba(0, 0, 0, .7)"; g.shadowBlur = 4;
    g.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      g.moveTo(x + sx * r, y + sy * (r - c)); g.lineTo(x + sx * r, y + sy * r); g.lineTo(x + sx * (r - c), y + sy * r);
    }
    g.stroke();
    g.restore();
  }

  return {
    strike, drawSat, drawDrone, ping, reticle,
    clear() { cancelAnimationFrame(boltRaf); g.clearRect(0, 0, W, H); },
    get ctx() { return g; },
    get size() { return [W, H]; },
  };
}
