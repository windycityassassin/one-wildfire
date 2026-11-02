// The ground: a drone-mapped site on the edge of the 2015 Soda Fire, flown seven years later.
// Surface heights (DSM) with the 1 cm orthophoto draped on top, the burn line, the field crew's plots
// and shrubs, and the drone's own shrub detections. Built by pipeline/30_drone_scene.py.
//
// The story drives it through a small API: view(name), fade(layer, opacity), droneEye(t), focusPlot(cid),
// drawLine(ms) for the fire line, and enterXR("ar", { overlay }) for playing the game on the land in front of you.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";

export const COL = {
  fire: 0xff6a2b,       // the burn line
  drone: 0x8fd3ff,      // what the drone's model detected
  found: 0xf2efe8,      // field shrubs the drone also found
  missed: 0xa6f05a,     // field shrubs the drone missed: the recovery it cannot see
  plot: 0xf2efe8,
};
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

async function getBin(url) { return new Uint16Array(await (await fetch(url)).arrayBuffer()); }

export async function initGround(el, { base = "data/drone/soda2/", quality = "hi", shiftRight = true } = {}) {
  const site = await (await fetch(base + "site.json")).json();
  const T = site.terrain[quality];
  const H16 = await getBin(base + `terrain_${quality}.bin`);
  const [W, D] = site.size;
  const cx = W / 2, cy = D / 2;

  // height in metres above zmin at local (x east, y north), bilinear
  const hAt = (x, y) => {
    const fx = Math.min(Math.max(x / T.res, 0), T.nx - 1.001), fy = Math.min(Math.max((D - y) / T.res, 0), T.ny - 1.001);
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const g = (a, b) => H16[b * T.nx + a] / 1000;
    return (g(i, j) * (1 - u) + g(i + 1, j) * u) * (1 - v) + (g(i, j + 1) * (1 - u) + g(i + 1, j + 1) * u) * v;
  };
  const zmid = hAt(cx, cy);
  // world: x east, y up, z south; origin at the site centre
  const P = (x, y, lift = 0) => new THREE.Vector3(x - cx, hAt(x, y) - zmid + lift, cy - y);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.xr.enabled = true;
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const world = new THREE.Group();          // everything that belongs to the site, so XR can move and scale it
  scene.add(world);
  let ar = null;                            // while the game is played in AR: scale, turn, where it stands, how far in
  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 3000);

  // ---- terrain ----
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(T.nx * T.ny * 3), uv = new Float32Array(T.nx * T.ny * 2);
  let hmax = 0;
  for (let j = 0; j < T.ny; j++) for (let i = 0; i < T.nx; i++) {
    const k = j * T.nx + i, x = i * T.res, y = D - j * T.res;
    const h = H16[k] / 1000 - zmid;
    hmax = Math.max(hmax, h);
    pos[k * 3] = x - cx; pos[k * 3 + 1] = h; pos[k * 3 + 2] = cy - y;
    uv[k * 2] = x / W; uv[k * 2 + 1] = y / D;
  }
  const idx = new Uint32Array((T.nx - 1) * (T.ny - 1) * 6);
  let n = 0;
  for (let j = 0; j < T.ny - 1; j++) for (let i = 0; i < T.nx - 1; i++) {
    const a = j * T.nx + i, b = a + 1, c = a + T.nx, d = c + 1;
    idx.set([a, c, b, b, c, d], n); n += 6;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const loader = new THREE.TextureLoader();
  const [tex, chmTex] = await Promise.all([loader.loadAsync(base + "ortho.jpg"), loader.loadAsync(base + "chm.png")]);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  chmTex.colorSpace = THREE.NoColorSpace;
  const U = { uDrone: { value: 0 }, uChm: { value: chmTex }, uTint: { value: new THREE.Color(COL.drone) },
    uHole: { value: new THREE.Vector4() }, uHoleOn: { value: 0 }, uFlat: { value: 0 }, uGlow: { value: 0 } };
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 });
  // "the drone's eye": the photo fades to dark and everything the canopy model calls tall glows.
  // Where the full-quality tiles are showing (see "up close"), this ground steps aside: uHole is that rectangle. And while
  // they show, its shrubs are lowered to 15% of their height like the tiles' (uFlat, from the canopy height texture), so
  // the land around the tiles matches them and its shrubs are no longer tall cones the photo smears down
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vSite; uniform sampler2D uChm; uniform float uFlat;")
      .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\nobjectNormal = normalize(mix(objectNormal, vec3(0.0, 1.0, 0.0), uFlat * 0.7));")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed.y -= uFlat * 0.85 * 1.2 * texture2D(uChm, uv).r;\nvSite = position.xz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uDrone; uniform sampler2D uChm; uniform vec3 uTint; uniform vec4 uHole; uniform float uHoleOn; uniform float uGlow; varying vec2 vSite;")
      .replace("#include <map_fragment>", `if (uHoleOn > 0.5 && vSite.x > uHole.x && vSite.x < uHole.z && vSite.y > uHole.y && vSite.y < uHole.w) discard;
        #include <map_fragment>
        float hh = texture2D(uChm, vMapUv).r;
        float lum = dot(diffuseColor.rgb, vec3(.299, .587, .114));
        vec3 dim = vec3(lum) * 0.22;
        vec3 glow = uTint * smoothstep(0.14, 0.45, hh);
        diffuseColor.rgb = mix(diffuseColor.rgb, dim + glow, uDrone);`)
      // in AR (uGlow), the height's blue shines by itself, so it stays bright while the light steps down
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += glow * uDrone * uGlow;");
  };
  const ground = new THREE.Mesh(geo, mat);
  ground.castShadow = ground.receiveShadow = true;
  const block = new THREE.Group();          // the ground and its sides
  block.add(ground);
  world.add(block);

  // the block's sides: a slice of earth, so the site reads as a specimen lifted out of the landscape
  const floor = -(hmax + 6);
  const edge = [];
  for (let i = 0; i < T.nx; i++) edge.push(i);
  for (let j = 1; j < T.ny; j++) edge.push(j * T.nx + T.nx - 1);
  for (let i = T.nx - 2; i >= 0; i--) edge.push((T.ny - 1) * T.nx + i);
  for (let j = T.ny - 2; j >= 0; j--) edge.push(j * T.nx);
  const sp = new Float32Array(edge.length * 6), sc = new Float32Array(edge.length * 6), si = [];
  const top = new THREE.Color(0x4f3d2c), bot = new THREE.Color(0x0e0b09);
  edge.forEach((k, e) => {
    sp.set([pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2], pos[k * 3], floor, pos[k * 3 + 2]], e * 6);
    sc.set([top.r, top.g, top.b, bot.r, bot.g, bot.b], e * 6);
    if (e < edge.length - 1) { const a = e * 2; si.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
  });
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  sg.setAttribute("color", new THREE.BufferAttribute(sc, 3));
  sg.setIndex(si);
  block.add(new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));

  // ---- light: low late-afternoon sun from the west, so shrubs model themselves ----
  const hemi = new THREE.HemisphereLight(0xcfdcff, 0x3a2e22, 0.8);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe6c4, 2.7);
  sun.position.set(-110, 48, 30);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -W * 0.6, right: W * 0.6, top: D * 0.6, bottom: -D * 0.6, near: 1, far: 400 });
  sun.shadow.mapSize.set(quality === "lo" ? 1024 : 4096, quality === "lo" ? 1024 : 4096);   // a quarter of the work on phones and tablets
  sun.shadow.bias = -0.0004;
  sun.shadow.radius = 3;
  world.add(sun, sun.target);

  // ---- overlays ----
  const layers = {}, fatMats = [];
  const line = (pts, color, opacity = 1, width = 1.5) => {
    const g = new LineGeometry().setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
    const m = new LineMaterial({ color, linewidth: width, transparent: true, opacity, worldUnits: false });
    m.resolution.set(el.clientWidth || 1, el.clientHeight || 1);
    fatMats.push(m);
    return new Line2(g, m);
  };
  const drape = (ring, lift) => {
    const pts = [];
    for (let k = 0; k < ring.length - 1; k++) {
      const [x0, y0] = ring[k], [x1, y1] = ring[k + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.5));
      for (let s = 0; s < steps; s++) pts.push(P(x0 + (x1 - x0) * s / steps, y0 + (y1 - y0) * s / steps, lift));
    }
    const [xl, yl] = ring[ring.length - 1];
    pts.push(P(xl, yl, lift));
    return pts;
  };
  const circle = (x, y, r, lift) => {
    const ring = [];
    for (let a = 0; a <= 72; a++) { const t = a / 72 * Math.PI * 2; ring.push([x + Math.cos(t) * r, y + Math.sin(t) * r]); }
    return drape(ring, lift);
  };
  layers.burn = new THREE.Group();
  for (const ring of site.burn) layers.burn.add(line(drape(ring, 0.25), COL.fire, 1, 3));
  layers.plots = new THREE.Group();
  layers.focus = new THREE.Group();

  const instanced = (geom, color, items, place) => {
    const m = new THREE.InstancedMesh(geom, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 }), items.length);
    const M = new THREE.Matrix4();
    items.forEach((it, k) => m.setMatrixAt(k, place(it, M)));
    return m;
  };
  const R = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  layers.drone = instanced(new THREE.TorusGeometry(0.32, 0.04, 6, 24), COL.drone, site.detections,
    ([x, y], M) => M.makeTranslation(P(x, y, 0.3)).multiply(R));
  // field shrubs on the burned side only: that is where recovery is happening, and what the story is about
  const dot = new THREE.SphereGeometry(0.2, 14, 10);
  const burntShrubs = site.shrubs.filter((s) => s.burnt);
  layers.found = instanced(dot, COL.found, burntShrubs.filter((s) => s.found), (s, M) => M.makeTranslation(P(...s.xy, 0.45)));
  layers.missed = instanced(dot, COL.missed, burntShrubs.filter((s) => !s.found), (s, M) => M.makeTranslation(P(...s.xy, 0.45)));
  // and only the burned circles
  layers.plots.clear();
  for (const p of site.plots.filter((q) => q.burnt)) { const l = line(circle(p.xy[0], p.xy[1], site.plot_r, 0.14), COL.plot, 0.55, 1.3); l.userData.xy = p.xy; layers.plots.add(l); }
  layers.marks = new THREE.Group();     // per-circle markers: your taps, and the crew's shrubs once revealed
  for (const k of ["burn", "plots", "focus", "drone", "found", "missed", "marks"]) world.add(layers[k]);

  // every layer fades rather than pops
  const opacityTargets = new Map();
  const matsOf = (obj) => { const out = []; obj.traverse((o) => o.material && out.push(o.material)); return out; };
  const fullOpacity = new Map();     // each material's own resting opacity
  for (const k of Object.keys(layers)) for (const m of matsOf(layers[k])) fullOpacity.set(m, m.opacity);
  const fade = (k, to) => {
    opacityTargets.set(k, to);
    if (to > 0) layers[k].visible = true;
    if (k === "burn") { lineDraw = null; for (const l of layers.burn.children) l.geometry.instanceCount = Infinity; }
    if (k === "plots") plotsAnim = null;
  };
  // the fire line drawing itself along the ground, start to end
  let lineDraw = null;
  const drawLine = (ms) => {
    opacityTargets.delete("burn");
    layers.burn.visible = true;
    for (const m of matsOf(layers.burn)) m.opacity = fullOpacity.get(m) ?? 1;
    for (const l of layers.burn.children) l.geometry.instanceCount = 0;
    lineDraw = { t0: performance.now(), ms };
  };
  for (const k of Object.keys(layers)) { if (k === "marks") continue; layers[k].visible = false; for (const m of matsOf(layers[k])) m.opacity = 0; }
  // the circles appearing one after another, from the middle of the site outward, each fading in over `each` ms
  // (the AR opening); `dim` is how far the others step back once one circle is chosen
  let plotsAnim = null;
  const plotsIn = (ms = 3600, each = 700) => {
    opacityTargets.delete("plots");
    layers.plots.visible = true;
    const ls = layers.plots.children, d = (l) => { const p = l.userData.xy; return Math.hypot(p[0] - cx, p[1] - cy); };
    const far = Math.max(...ls.map(d)), t0 = performance.now();
    for (const l of ls) { l.material.opacity = 0; l.userData.t = t0 + (d(l) / far) * Math.max(0, ms - each); }
    plotsAnim = { each };
  };
  function plotsStep(now) {
    let done = true;
    for (const l of layers.plots.children) {
      const k = THREE.MathUtils.clamp((now - l.userData.t) / plotsAnim.each, 0, 1);
      l.material.opacity = (fullOpacity.get(l.material) ?? 1) * ease(k);
      if (k < 1) done = false;
    }
    if (done) plotsAnim = null;
  }

  // ---- camera views ----
  const burntPlots = site.plots.filter((p) => p.burnt);
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const bx = mean(burntPlots.map((p) => p.xy[0])), by = mean(burntPlots.map((p) => p.xy[1]));
  const portrait = () => el.clientWidth < el.clientHeight * 0.9;
  // the landscape views were framed on a desktop window; on a smaller or shorter screen (a tablet held sideways) the
  // camera stands further back by the same ratio, so the block and the circle stay clear of the caption
  const back = () => (portrait() ? 1 : Math.min(1.8, Math.max(1, 1100 / el.clientWidth, 760 / el.clientHeight)));
  const away = (target, off) => ({ target, pos: target.clone().add(off.clone().multiplyScalar(back())) });
  const VIEWS = {
    // the drone's own point of view: high above the site, looking steeply down
    above: () => away(new THREE.Vector3(0, -2, 0), portrait() ? new THREE.Vector3(-110, 390, 190) : new THREE.Vector3(-80, 250, 120)),
    overview: () => away(new THREE.Vector3(0, -2, 0), portrait() ? new THREE.Vector3(-170, 252, 290) : new THREE.Vector3(-165, 142, 215)),
    closer: () => away(P(bx, by, 0), new THREE.Vector3(-38, 92, 74).multiplyScalar(portrait() ? 1.6 : 1)),
    plot: (cid) => {
      const p = site.plots.find((q) => q.cid === cid);
      const t = P(...p.xy, 0);
      // look at the circle from the south-west, with the circle left of centre so the lens has room on the right
      const off = portrait() ? new THREE.Vector3(-6, 31, 17) : new THREE.Vector3(-5, 17.5, 10);
      return away(t, off);
    },
  };
  let anim = null;
  const controls = new OrbitControls(camera, renderer.domElement);
  const view = (name, arg, dur = 2400) => {
    const v = VIEWS[name](arg);
    anim = { t0: performance.now(), dur, p0: camera.position.clone(), q0: controls.target.clone(), p1: v.pos, q1: v.target };
  };
  controls.enableDamping = true;
  controls.enableZoom = false;              // the page scrolls; zooming is the story's job
  controls.enablePan = false;
  // on a touch screen the picture fills the screen, so a finger must scroll the page, not turn the block: no
  // touch rotation (the block turns by itself), and the browser keeps vertical swipes (OrbitControls sets "none")
  if (matchMedia("(pointer: coarse)").matches) {
    controls.touches = { ONE: -1, TWO: THREE.TOUCH.DOLLY_ROTATE };     // one finger: the page scrolls; two: turn and zoom
    controls.enableZoom = true; controls.minDistance = 6; controls.maxDistance = 600; controls.zoomSpeed = 0.6;
    renderer.domElement.style.touchAction = "pan-y";
  }
  controls.maxPolarAngle = Math.PI * 0.46;
  controls.autoRotateSpeed = 0.18;
  const v0 = VIEWS.overview();
  camera.position.copy(v0.pos);
  controls.target.copy(v0.target);

  let eyeT = 0, eyeTo = 0, eyeAnim = null;
  // with `ms`, the change runs on a clock and eases in and out (the AR opening), rather than settling exponentially
  const droneEye = (t, ms) => { eyeTo = t; eyeAnim = ms ? { from: eyeT, t0: performance.now(), ms } : null; };
  // ---- up close: the site at full quality (pipeline/33_drone_tiles.py) ----
  // Around the circle being looked at, 20 m tiles of the drone's own 1 cm photo on a 10 cm surface take the place of
  // the whole-site picture (4.4 cm on a 25–50 cm surface, where a shrub becomes a smeared cone). The whole-site ground
  // is cut away under them. A block of tiles is swapped in only once all of it has loaded, so nothing flickers.
  const tileIndex = await fetch(base + "tiles/index.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const detail = new THREE.Group();
  world.add(detail);
  const REACH = quality === "lo" ? 8 : 12;          // metres around the centre: 2 × 2 tiles at most on a tablet, 3 × 3 on a desktop
  const tileCache = new Map();
  let shownKey = "", wantKey = "", shownTiles = [];
  function loadTile(t) {
    const key = `${t.i}_${t.j}`;
    if (tileCache.has(key)) return tileCache.get(key);
    const entry = { t, key, mesh: null };
    entry.ready = Promise.all([getBin(`${base}tiles/${key}.bin`), loader.loadAsync(`${base}tiles/${key}.jpg`)]).then(([hb, tex]) => {
      const { nx, ny } = t, n = nx * ny;
      // the surface, then a skirt: the edge copied (its own points, so the surface's shading is untouched) and again 1 m
      // lower, drawn unlit in the photo's colours, so no gap or dark seam shows where a tile meets the coarser ground
      const rim = [];
      for (let c = 0; c < nx; c++) rim.push(c);
      for (let r = 1; r < ny; r++) rim.push(r * nx + nx - 1);
      for (let c = nx - 2; c >= 0; c--) rim.push((ny - 1) * nx + c);
      for (let r = ny - 2; r >= 0; r--) rim.push(r * nx);
      const L = rim.length, pos = new Float32Array((n + 2 * L) * 3), uvs = new Float32Array((n + 2 * L) * 2);
      for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
        const k = r * nx + c, x = t.x + (c / (nx - 1)) * t.w, y = t.y + t.h - (r / (ny - 1)) * t.h;
        pos[k * 3] = x - cx; pos[k * 3 + 1] = hb[k] / 1000 - zmid; pos[k * 3 + 2] = cy - y;
        uvs[k * 2] = c / (nx - 1); uvs[k * 2 + 1] = 1 - r / (ny - 1);
      }
      rim.forEach((k, q) => {
        pos.set([pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]], (n + q) * 3);
        pos.set([pos[k * 3], pos[k * 3 + 1] - 1, pos[k * 3 + 2]], (n + L + q) * 3);
        uvs.set([uvs[k * 2], uvs[k * 2 + 1]], (n + q) * 2);
        uvs.set([uvs[k * 2], uvs[k * 2 + 1]], (n + L + q) * 2);
      });
      const top = (nx - 1) * (ny - 1) * 6, ix = new Uint32Array(top + L * 6);
      let m = 0;
      for (let r = 0; r < ny - 1; r++) for (let c = 0; c < nx - 1; c++) {
        const a = r * nx + c, b = a + 1, d = a + nx, e = d + 1;
        ix.set([a, d, b, b, d, e], m); m += 6;
      }
      for (let q = 0; q < L; q++) {
        const a = n + q, b = n + (q + 1) % L, a2 = a + L, b2 = b + L;
        ix.set([a, b, a2, b, b2, a2], m); m += 6;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
      g.setIndex(new THREE.BufferAttribute(ix, 1));
      g.computeVertexNormals();
      g.addGroup(0, top, 0); g.addGroup(top, L * 6, 1);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();      // sharp even when the land is seen at a low angle
      entry.mesh = new THREE.Mesh(g, [new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 }),
        new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })]);
      entry.h = hb;          // no cast shadows on it: the photo has its own, and the coarse ground's would fall on it
    }).catch(() => tileCache.delete(key));
    tileCache.set(key, entry);
    return entry;
  }
  // the block of tiles within REACH of a point (site metres)
  function tileBlock(x, y) {
    if (!tileIndex) return null;
    const T = tileIndex.tile, ni = Math.ceil(W / T), nj = Math.ceil(D / T);
    const i0 = Math.max(0, Math.floor((x - REACH) / T)), i1 = Math.min(ni - 1, Math.floor((x + REACH) / T));
    const j0 = Math.max(0, Math.floor((y - REACH) / T)), j1 = Math.min(nj - 1, Math.floor((y + REACH) / T));
    if (i0 > i1 || j0 > j1) return null;
    return { key: `${i0}.${i1}.${j0}.${j1}`, tiles: tileIndex.tiles.filter((t) => t.i >= i0 && t.i <= i1 && t.j >= j0 && t.j <= j1) };
  }
  function showBlock(b) {
    if (!b) { wantKey = ""; detail.visible = false; U.uHoleOn.value = 0; return; }
    detail.visible = true; U.uHoleOn.value = shownKey ? 1 : 0;
    if (b.key === wantKey || b.key === shownKey && !wantKey) return;
    wantKey = b.key;
    const entries = b.tiles.map(loadTile);
    Promise.all(entries.map((e) => e.ready)).then(() => {
      if (wantKey !== b.key || entries.some((e) => !e.mesh)) return;
      // only the block on show stays in memory (four 2000-pixel photos are already about 80 MB on the graphics card)
      for (const e of [...tileCache.values()]) if (!entries.includes(e) && e.mesh) {
        detail.remove(e.mesh); e.mesh.geometry.dispose(); e.mesh.material[0].map.dispose(); e.mesh.material.forEach((m) => m.dispose()); tileCache.delete(e.key);
      }
      for (const e of entries) detail.add(e.mesh);
      shownTiles = entries; shownKey = b.key; wantKey = "";
      const xs = entries.flatMap((e) => [e.t.x, e.t.x + e.t.w]), ys = entries.flatMap((e) => [e.t.y, e.t.y + e.t.h]);
      U.uHole.value.set(Math.min(...xs) - cx, cy - Math.max(...ys), Math.max(...xs) - cx, cy - Math.min(...ys));
      U.uHoleOn.value = detail.visible ? 1 : 0;
    });
  }
  // the surface height at a point: the tiles' own where they are showing, otherwise the whole-site terrain
  const hNear = (x, y) => {
    if (detail.visible) for (const e of shownTiles) {
      const t = e.t;
      if (x < t.x || x > t.x + t.w || y < t.y || y > t.y + t.h) continue;
      const fx = (x - t.x) / t.w * (t.nx - 1), fy = (t.y + t.h - y) / t.h * (t.ny - 1);
      const i = Math.min(Math.floor(fx), t.nx - 2), j = Math.min(Math.floor(fy), t.ny - 2), u = fx - i, v = fy - j;
      const g = (a, b) => e.h[b * t.nx + a] / 1000;
      return (g(i, j) * (1 - u) + g(i + 1, j) * u) * (1 - v) + (g(i, j + 1) * (1 - u) + g(i + 1, j + 1) * u) * v;
    }
    return hAt(x, y);
  };
  // a mark's place: on the surface actually showing
  const Pm = (x, y, lift = 0) => new THREE.Vector3(x - cx, hNear(x, y) - zmid + lift, cy - y);
  let focusCid = null;
  const focusPlot = (cid) => {
    focusCid = cid;
    layers.focus.clear();
    if (cid == null) return;
    const p = site.plots.find((q) => q.cid === cid);
    const l = line(circle(p.xy[0], p.xy[1], site.plot_r, 0.22), COL.missed, 1, 3.2);
    fullOpacity.set(l.material, 1); l.material.opacity = layers.focus.visible ? 1 : 0; layers.focus.add(l);
  };

  // ---- markers for one circle ----
  // every mark lies flat a few centimetres above the ground: lifted any higher, it seems to sit beside its spot when the
  // land is seen at a low angle (in AR, 20 cm of lift looked half a metre off). Your taps are small rings, so the
  // shrub you tapped stays visible inside
  const tapGeo = new THREE.TorusGeometry(0.085, 0.02, 8, 32), ringGeo = new THREE.TorusGeometry(0.26, 0.05, 8, 36);
  // marks always draw over the ground, so a ring under a big shrub's canopy is never half-buried
  const markMat = (color) => new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true });
  const youMat = markMat(COL.found), wrongMat = markMat(0x77736c), crewMat = markMat(COL.missed);
  const droneRing = new THREE.TorusGeometry(0.4, 0.035, 8, 40), droneMat = markMat(COL.drone);
  // your taps: white dots (grey once checked, if no young shrub was there); the crew's young shrubs: green rings;
  // the ones the drone also found: a blue ring around the green one.
  // Seedlings often grow in clumps a few centimetres apart, and their rings would draw on top of each other
  // (30 young shrubs looked like 11 rings), so shrubs closer than CLUMP share one ring with a green number,
  // and a blue number says how many of them the drone found. The rings then always add up to the crew's count.
  const CLUMP = 0.5;
  const flat = (geo, mat, xy, lift) => { const m = new THREE.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; m.position.copy(Pm(...xy, lift)); m.renderOrder = 10; layers.marks.add(m); return m; };
  const badges = new Map();
  const badgeMat = (n, color) => {
    const key = `${n}-${color}`;
    if (!badges.has(key)) {
      const c = document.createElement("canvas"); c.width = c.height = 128;
      const g = c.getContext("2d");
      g.fillStyle = `#${color.toString(16).padStart(6, "0")}`; g.beginPath(); g.arc(64, 64, 60, 0, 6.29); g.fill();
      g.fillStyle = "#0a0b0c"; g.font = `600 ${n > 9 ? 64 : 76}px Inter, system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(String(n), 64, 70);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      badges.set(key, new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
    }
    return badges.get(key);
  };
  const badge = (ring, n, color, side) => {
    const b = new THREE.Sprite(badgeMat(n, color));
    b.scale.set(0.3, 0.3, 1); b.position.set(0.3 * side, 0.3, 0.1); b.renderOrder = 13;
    ring.add(b);
  };
  function clumps(young) {
    const par = young.map((_, k) => k), f = (k) => (par[k] === k ? k : (par[k] = f(par[k])));
    for (let a = 0; a < young.length; a++) for (let b = a + 1; b < young.length; b++)
      if (Math.hypot(young[a].xy[0] - young[b].xy[0], young[a].xy[1] - young[b].xy[1]) < CLUMP) par[f(a)] = f(b);
    const groups = new Map();
    young.forEach((s, k) => { const r = f(k); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(s); });
    return [...groups.values()].map((g) => ({ xy: [g.reduce((t, s) => t + s.xy[0], 0) / g.length, g.reduce((t, s) => t + s.xy[1], 0) / g.length], shrubs: g }));
  }
  // pop: rings grow in one after another (and onPop fires for each, so the page can follow along)
  let onPop = null;
  // crew: false draws only the drone's rings (the story shows those first, then the crew's)
  const setMarks = ({ taps = [], young = [], drone = [], pop = false, crew = true }) => {
    layers.marks.clear();
    layers.marks.visible = true;
    const t0 = performance.now();
    const groups = clumps(young), found = new Set(drone);
    const stagger = Math.min(110, 900 / Math.max(1, groups.length));
    // pop: true (everything), or only the "young" (crew's) or "drone" rings
    const popYoung = pop === true || pop === "young", popDrone = pop === true || pop === "drone";
    let kd = 0;
    groups.forEach((g, k) => {
      if (crew) {
        const m = flat(ringGeo, crewMat, g.xy, 0.05); m.userData.kind = "young";
        if (g.shrubs.length > 1) badge(m, g.shrubs.length, COL.missed, 1);
        if (popYoung) m.userData.pop = t0 + k * stagger;
      }
      const d = g.shrubs.filter((s) => found.has(s)).length;
      if (!d) return;
      const r = flat(droneRing, droneMat, g.xy, 0.06); r.userData.kind = "drone";
      if (crew ? g.shrubs.length > 1 : d > 1) badge(r, d, COL.drone, -1);
      if (popDrone) r.userData.pop = t0 + (popYoung ? groups.length * stagger + 150 : 0) + kd++ * 220;
    });
    for (const t of taps) { const m = flat(tapGeo, t.ok === false ? wrongMat : youMat, t.xy, 0.04); m.renderOrder = 11; }
    for (const m of layers.marks.children) if (m.userData.pop != null) m.scale.setScalar(0.001);
    // marks may have been faded out (the AR opening shows the crew's rings, then lets them go): new ones show in full
    opacityTargets.delete("marks");
    for (const m of matsOf(layers.marks)) m.opacity = 1;
  };
  // ---- the tally, when the game ends: every circle where people found young shrubs turns green, one after another
  // from the middle outward, and each young shrub they found there shows as a green dot (a fixed size on screen, so
  // they can be seen with the whole site in view; a real one would be too small). A blue ring round a dot: the drone
  // found that one too. Built once, the first time ----
  const tallyLayer = new THREE.Group();
  tallyLayer.visible = false;
  world.add(tallyLayer);
  const dotTex = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.beginPath(); g.arc(32, 32, 30, 0, 6.29); g.fill();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const ringTex = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d"); g.strokeStyle = "#fff"; g.lineWidth = 7; g.beginPath(); g.arc(32, 32, 27, 0, 6.29); g.stroke();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const dots = (list, color, size, map, order) => {
    const geo = new THREE.BufferGeometry().setFromPoints(list.map((q) => Pm(...q.xy, 0.3)));
    const o = new THREE.Points(geo, new THREE.PointsMaterial({ color, size, map, sizeAttenuation: false, transparent: true, depthTest: false, opacity: 0 }));
    o.renderOrder = order;
    return o;
  };
  let tallyT = null;
  const tally = (plots, ms = 2400, delay = 0) => {
    if (!plots) { tallyT = null; tallyLayer.visible = false; return; }
    if (!tallyLayer.children.length) {
      const d = (q) => Math.hypot(q.xy[0] - cx, q.xy[1] - cy);
      for (const q of [...plots].sort((a, b) => d(a) - d(b))) {
        const g = new THREE.Group();
        g.add(line(circle(q.xy[0], q.xy[1], site.plot_r, 0.22), COL.missed, 0, 3.2));
        if (q.youngFound.length) g.add(dots(q.youngFound, COL.drone, 15, ringTex, 12));
        g.add(dots(q.young, COL.missed, 7, dotTex, 13));
        tallyLayer.add(g);
      }
    }
    const t0 = performance.now() + delay, n = tallyLayer.children.length;
    tallyLayer.children.forEach((g, k) => { g.userData.t = t0 + (n > 1 ? (k / (n - 1)) * ms : 0); g.traverse((o) => o.material && (o.material.opacity = 0)); });
    tallyLayer.visible = true; tallyT = true;
  };
  // each circle fades in over 0.5 s, its dots a moment after the circle
  function tallyStep(now) {
    let done = true;
    for (const g of tallyLayer.children) {
      g.children.forEach((o, j) => {
        const k = THREE.MathUtils.clamp((now - g.userData.t - (j ? 250 : 0)) / 500, 0, 1);
        o.material.opacity = ease(k);
        if (k < 1) done = false;
      });
    }
    if (done) tallyT = null;
  }
  // a soft ripple where you tap
  const ripples = [];
  const rippleMat = (color) => new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true });
  const ripple = (xy, color = COL.found) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.012, 6, 40), rippleMat(color));
    m.rotation.x = -Math.PI / 2; m.position.copy(Pm(...xy, 0.04)); m.renderOrder = 12;
    world.add(m); ripples.push({ m, t0: performance.now() });
  };

  // the game's guide: one shrub pointed out on the picture, a ring and a label that follow it as the camera moves
  const pointer = document.createElement("div");
  pointer.id = "pointer";
  pointer.innerHTML = '<i class="ring"></i><i class="lead"></i><span class="tag"></span>';
  el.append(pointer);
  let pointAt = null;
  const point = (xy, html) => {
    pointAt = xy;
    if (html) pointer.querySelector(".tag").innerHTML = html;
    pointer.classList.toggle("on", !!xy);
  };
  // in AR, three.js copies the device's pose and lens into `camera` as it renders, and the pointer sits in the
  // full-screen overlay, so the same projection works there with the window's size
  const placePointer = () => {
    if (!pointAt) return;
    const w = ar ? innerWidth : el.clientWidth, h = ar ? innerHeight : el.clientHeight;
    const v = world.localToWorld(Pm(...pointAt, 0.03)).project(camera);
    const x = (v.x + 1) / 2 * w, y = (1 - v.y) / 2 * h;
    pointer.style.transform = `translate(${x}px, ${y}px)`;
    pointer.classList.toggle("flip", x > w - 230);
  };
  // the two sides of the fire line, named on the land (the burned side is north of it), kept over their spot as the
  // camera moves; each sits well inside its side, between the crew's circles there
  const tags = [["Not burned", [112, 24], ""], ["Burned", [92, 116], "burnt"]].map(([text, xy, cls]) => {
    const d = document.createElement("div");
    d.className = `landtag ${cls}`; d.textContent = text;
    el.append(d);
    return { d, xy };
  });
  let sidesOn = false;
  const sides = (on) => { sidesOn = on; for (const t of tags) t.d.classList.toggle("on", on); };
  const placeTags = () => {
    if (!sidesOn) return;
    // in AR they sit in the full-screen overlay (see enterXR), so the window is the frame, as for the pointer
    const w = ar ? innerWidth : el.clientWidth, h = ar ? innerHeight : el.clientHeight;
    for (const t of tags) {
      const v = world.localToWorld(P(...t.xy, 2)).project(camera);
      t.d.style.visibility = v.z > 1 ? "hidden" : "";
      t.d.style.transform = `translate(${(v.x + 1) / 2 * w}px, ${(1 - v.y) / 2 * h}px) translate(-50%, -50%)`;
    }
  };

  // ---- picking a point on the ground (mouse, touch, or a tap on the screen in AR) ----
  const ray = new THREE.Raycaster();
  const toLocal = (v) => { const w = world.worldToLocal(v.clone()); return [w.x + cx, cy - w.z]; };
  const pickRay = (origin, dir) => {
    ray.set(origin, dir);
    // the tiles first where they are showing (the whole-site ground under them is cut away in the shader, not for rays)
    const hit = (detail.visible && ray.intersectObjects(detail.children, false)[0]) || ray.intersectObjects([ground], false)[0];
    return hit ? toLocal(hit.point) : null;
  };
  // in AR the overlay fills the screen and `camera` holds the device's pose and lens, so the window is the frame
  const pick = (clientX, clientY) => {
    const r = ar ? { left: 0, top: 0, width: innerWidth, height: innerHeight } : renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return pickRay(ray.ray.origin.clone(), ray.ray.direction.clone());
  };
  let onTap = null;
  let down = null;
  renderer.domElement.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!down || !onTap || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    const xy = pick(e.clientX, e.clientY);
    if (xy) onTap(xy);
  });

  let shift = 0.13;
  const resize = () => {
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    // on wide screens the captions sit on the left, so the picture's centre moves right
    // captions sit on the left on wide screens and along the bottom on phones: move the picture out of their way
    if (!shiftRight) camera.clearViewOffset();
    else if (w > 760) camera.setViewOffset(w, h, -w * shift, 0, w, h);
    else camera.setViewOffset(w, h, 0, h * shift * 1.4, w, h);
    camera.updateProjectionMatrix();
    for (const m of fatMats) m.resolution.set(w, h);
  };
  new ResizeObserver(resize).observe(el);
  resize();

  let last = performance.now(), paused = false;
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (paused && !renderer.xr.isPresenting) return;
    if (anim) {
      const k = Math.min(1, (now - anim.t0) / anim.dur), e = ease(k);
      camera.position.lerpVectors(anim.p0, anim.p1, e);
      controls.target.lerpVectors(anim.q0, anim.q1, e);
      camera.lookAt(controls.target);
      if (k >= 1) anim = null;
    }
    if (eyeAnim) {
      const k = Math.min(1, (now - eyeAnim.t0) / eyeAnim.ms);
      eyeT = eyeAnim.from + (eyeTo - eyeAnim.from) * ease(k);
      if (k >= 1) eyeAnim = null;
    } else eyeT += (eyeTo - eyeT) * Math.min(1, dt * 1.2);
    if (plotsAnim) plotsStep(now);
    // the full-quality tiles: around the circle in play, or (in AR) around the middle once zoomed in; never in the drone's eye
    {
      let at = null;
      if (eyeT < 0.02) {
        if (ar) { if (ar.k > 0.35) at = [ar.pivot.x + cx, cy - ar.pivot.z]; }
        else if (focusCid != null) at = site.plots.find((q) => q.cid === focusCid).xy;
      }
      showBlock(at && tileBlock(...at));
      U.uFlat.value += ((detail.visible && shownKey ? 1 : 0) - U.uFlat.value) * Math.min(1, dt * 3);
    }
    if (lineDraw) {
      const k = Math.min(1, (now - lineDraw.t0) / lineDraw.ms), e = 1 - (1 - k) ** 2;
      for (const l of layers.burn.children) l.geometry.instanceCount = Math.max(0, Math.round(l.geometry.attributes.instanceStart.count * e));
      if (k >= 1) lineDraw = null;
    }
    U.uDrone.value = eyeT;
    for (const [k, to] of opacityTargets) {
      let done = true;
      for (const m of matsOf(layers[k])) {
        const goal = to * (fullOpacity.get(m) ?? 1);
        m.opacity += (goal - m.opacity) * Math.min(1, dt * 4);
        if (Math.abs(goal - m.opacity) > 0.01) done = false; else m.opacity = goal;
      }
      if (done) { opacityTargets.delete(k); if (to === 0) layers[k].visible = false; }
    }
    if (tallyT) tallyStep(now);
    for (const m of layers.marks.children) {          // rings popping in
      if (m.userData.pop == null || now < m.userData.pop) continue;
      const k = Math.min(1, (now - m.userData.pop) / 260);
      m.scale.setScalar(Math.max(0.001, 1 + 2.70158 * (k - 1) ** 3 + 1.70158 * (k - 1) ** 2));   // ease out with a little overshoot
      if (!m.userData.popped) { m.userData.popped = true; onPop?.(m); }
      if (k >= 1) { m.scale.setScalar(1); m.userData.pop = null; }
    }
    for (let i = ripples.length - 1; i >= 0; i--) {   // tap ripples
      const r = ripples[i], k = (now - r.t0) / 520;
      if (k >= 1) { world.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); ripples.splice(i, 1); continue; }
      r.m.scale.setScalar(1 + k * 3.2); r.m.material.opacity = (1 - k) ** 1.6;
    }
    if (ar) arFrame(dt);
    else if (!anim) controls.update();
    placePointer(); placeTags();
    renderer.render(scene, camera);
    if (ar?.place && --ar.place === 0) arAnchor();          // after rendering: `camera` now holds the device's pose
  });

  // ---- AR: the same land, in front of you ----
  // The whole site appears as a table model about 60 cm wide (1:300), about a metre away where the phone or tablet
  // points (never higher than a little below eye level, so it is seen from above), with every circle and the fire
  // line on it and the circle being checked in green. After a moment it carries you into the green circle by itself
  // (1:18, the circle about 55 cm across), and each next circle slides into the same place. Two fingers pinch to zoom
  // and twist to turn, if wanted.
  // Marking is by aim, not by finger: a ring on the land follows the middle of the view; move or lean the tablet until
  // it sits on a shrub and press Mark. (A fingertip is wider than a young shrub on screen, so taps landed beside them.)
  // The page's panel comes along in the overlay (WebXR DOM Overlay), so Check and Next circle work as on screen.
  // With `preview`, there is no AR session: the page's own camera stands where a tablet would, for checking on a desktop.
  const qTurn = new THREE.Quaternion(), qTip = new THREE.Quaternion(), TILT = [-0.35, 1.05];
  const UP = new THREE.Vector3(0, 1, 0), AR_MAP = 1 / 300, AR_NEAR = 1 / 18, AR_AWAY = 1, AR_DOWN = -0.35, AR_MIN = 1 / 300, AR_MAX = 1 / 4;
  const centre = P(cx, cy, 0);
  // the aim ring (about 30 cm across at the land's real size, a shade wider than a young shrub), with a dark edge so it
  // reads on bright ground, and a dot in the middle
  const aim = new THREE.Group();
  {
    const mk = (geo, color, opacity, order) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity })); m.renderOrder = order; return m; };
    const edge = mk(new THREE.TorusGeometry(0.16, 0.04, 8, 48), 0x0a0b0c, 0.45, 14), ring = mk(new THREE.TorusGeometry(0.16, 0.022, 8, 48), 0xffffff, 1, 15);
    edge.rotation.x = ring.rotation.x = -Math.PI / 2;
    aim.add(edge, ring, mk(new THREE.SphereGeometry(0.02, 10, 8), 0xffffff, 1, 15));
    aim.visible = false;
    world.add(aim);
  }
  let aimXY = null, aiming = false;
  const toSite = new THREE.Matrix4();
  // where the middle of the view meets the land: along the camera's own forward line, stepping onto the surface showing
  function aimAt() {
    world.updateMatrixWorld();
    toSite.copy(world.matrixWorld).invert();
    const o = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    const e = new THREE.Vector3(0, 0, -1).transformDirection(camera.matrixWorld).add(o);
    o.applyMatrix4(toSite); e.applyMatrix4(toSite);
    const d = e.sub(o);
    if (d.y > -1e-6) return null;
    let h = ar.pivot.y, x = 0, y = 0;
    for (let k = 0; k < 5; k++) {
      const t = (h - o.y) / d.y;
      if (t < 0) return null;
      x = o.x + d.x * t + cx; y = cy - (o.z + d.z * t);
      if (x < 0 || x > W || y < 0 || y > D) return null;
      h = hNear(x, y) - zmid;
    }
    return [x, y];
  }
  // a zoom on a clock: scale eases on a log scale from where it is now (`then` runs when it arrives)
  const zoomTo = (to, ms, delay = 0, then = null) => {
    if (!ar) return;
    ar.auto = { t0: performance.now() + delay, from: ar.s, to: THREE.MathUtils.clamp(to, AR_MIN, AR_MAX), ms, then };
  };
  function arFrame(dt) {
    if (ar.auto) {
      const a = ar.auto, u = THREE.MathUtils.clamp((performance.now() - a.t0) / a.ms, 0, 1);
      if (u === 0) a.from = ar.s;                     // still waiting: start from wherever it is when it does start
      ar.s = a.from * Math.pow(a.to / a.from, ease(u));
      if (u >= 1) { ar.auto = null; a.then?.(); }
    }
    // moving and turning glide (Bring it here, the turn buttons); nothing jumps
    const g = 1 - Math.exp(-dt * 3);
    ar.at.lerp(ar.atGoal, g);
    ar.rot += Math.atan2(Math.sin(ar.rotGoal - ar.rot), Math.cos(ar.rotGoal - ar.rot)) * g;
    const p = focusCid != null && site.plots.find((q) => q.cid === focusCid);
    const circle = p ? P(...p.xy, 0) : centre;
    // how far in: 0 with the whole site in view, 1 at the circle's own size
    const k = ar.k = THREE.MathUtils.clamp(Math.log(ar.s / AR_MAP) / Math.log(AR_NEAR / AR_MAP), 0, 1);
    ar.pivot.lerp(centre.clone().lerp(circle, k), Math.min(1, dt * 5));
    // AR's brighter light turns the height view grey; while it shows, the light steps down so it reads black and blue
    hemi.intensity = 1.25 - 0.85 * eyeT; sun.intensity = 2.7 * (1 - 0.6 * eyeT); U.uGlow.value = 0.9;
    ar.tilt += (ar.tiltGoal - ar.tilt) * g;
    world.scale.setScalar(ar.s);
    // turned round its own up, then tipped about your left-right line (toward you: seen more from above)
    qTurn.setFromAxisAngle(UP, ar.rot); qTip.setFromAxisAngle(ar.side, ar.tilt);
    world.quaternion.copy(qTip).multiply(qTurn);
    world.position.copy(ar.at).sub(ar.pivot.clone().multiplyScalar(ar.s).applyQuaternion(world.quaternion));
    if (ar.preview) { camera.position.set(0, 0, 0); camera.lookAt(ar.look); camera.updateMatrixWorld(); }
    aimXY = aiming && k > 0.6 ? aimAt() : null;
    aim.visible = !!aimXY;
    if (aimXY) aim.position.copy(Pm(...aimXY, 0.04));
  }
  // where the device is looking now (three.js copies its pose into `camera` when it renders); the first time, the
  // whole site shows for a moment and then the land carries you into the green circle
  function arAnchor() {
    const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    const dir = new THREE.Vector3(0, 0, -1).transformDirection(camera.matrixWorld);
    const flat = new THREE.Vector3(dir.x, 0, dir.z);
    if (flat.lengthSq() < 1e-4) flat.set(0, 0, -1);
    flat.normalize();
    const pitch = Math.min(Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)), AR_DOWN);
    ar.atGoal.copy(eye).addScaledVector(flat, Math.cos(pitch) * AR_AWAY).addScaledVector(UP, Math.sin(pitch) * AR_AWAY);
    ar.rotGoal = Math.atan2(-flat.x, -flat.z);          // the site's north straight ahead
    ar.side.crossVectors(flat, UP).normalize();          // your left-right line, for tipping
    if (ar.started) return;
    // the first time: the land is put there unseen, then settles in from a touch smaller (no jump from where it was
    // drawn before the device's pose was known). Without the opening, it then carries you into the green circle;
    // with it, the land waits for you
    ar.started = true;
    ar.at.copy(ar.atGoal); ar.rot = ar.rotGoal;
    world.visible = true;
    ar.s = AR_MAP * 0.85;
    zoomTo(AR_MAP, 700, 0, ar.intro ? null : () => zoomTo(AR_NEAR, 3200, 900));
    onARPlaced?.();
  }
  // the opening's and the buttons' moves
  const arZoomBy = (f) => { if (ar) zoomTo((ar.auto?.to ?? ar.s) * f, 650); };
  const arTurn = (a) => { if (ar) ar.rotGoal += a; };
  const arTilt = (a) => { if (ar) ar.tiltGoal = THREE.MathUtils.clamp(ar.tiltGoal + a, ...TILT); };
  const arWhole = (ms = 2600, then) => zoomTo(AR_MAP, ms, 0, then);
  const arCircle = (ms = 3800, then) => zoomTo(AR_NEAR, ms, 0, then);
  // fetch the full-quality tiles around a circle ahead of time, so they are ready before the land gets close
  const prefetch = (cid) => { const p = site.plots.find((q) => q.cid === cid), b = p && tileBlock(...p.xy); if (b) b.tiles.forEach(loadTile); };
  let onARPlaced = null;
  let onXREnd = null, leaveAR = null;
  // intro: the opening plays (see main.js): the land stays at the whole site until the player goes in
  async function enterXR(mode = "ar", { overlay, preview = false, intro = false } = {}) {
    let session = null;
    if (!preview) {
      session = await navigator.xr.requestSession("immersive-ar",
        overlay ? { optionalFeatures: ["dom-overlay"], domOverlay: { root: overlay } } : {});
      renderer.xr.setReferenceSpaceType("local");
      // draw at the screen's own resolution (the default is lower), up to twice the default
      const native = globalThis.XRWebGLLayer?.getNativeFramebufferScaleFactor?.(session) || 1;
      renderer.xr.setFramebufferScaleFactor(Math.min(2, Math.max(1, native)));
      await renderer.xr.setSession(session);
    }
    // the photo's own colours: no film-style tone curve over the camera picture, which made the land look dull
    const look = { tm: renderer.toneMapping, hemi: hemi.intensity };
    renderer.toneMapping = THREE.NoToneMapping; hemi.intensity = 1.25;
    const saved = { pos: world.position.clone(), scale: world.scale.clone(), rot: world.rotation.y, shadow: sun.castShadow,
      cam: camera.position.clone(), target: controls.target.clone(), enabled: controls.enabled, eye: eyeTo };
    sun.castShadow = false;
    eyeAnim = null; eyeTo = eyeT = U.uDrone.value = 0;
    // the land as the page left it: the photo, the fire line and every circle; the green one is the circle being
    // checked. With the opening too, all of it is there from the first frame
    for (const k of ["burn", "plots", "focus"]) {
      opacityTargets.delete(k); layers[k].visible = true;
      for (const m of matsOf(layers[k])) m.opacity = fullOpacity.get(m) ?? 1;
    }
    lineDraw = plotsAnim = null;
    for (const l of layers.burn.children) l.geometry.instanceCount = Infinity;
    for (const k of ["drone", "found", "missed"]) layers[k].visible = false;
    anim = null; controls.enabled = false;
    const at0 = new THREE.Vector3(0, -0.34, -0.94);
    ar = { s: AR_MAP, rot: 0, rotGoal: 0, at: at0.clone(), atGoal: at0.clone(), look: at0.clone(), pivot: centre.clone(),
      place: 2, k: 0, auto: null, started: false, preview, intro, tilt: 0, tiltGoal: 0, side: new THREE.Vector3(1, 0, 0) };
    world.visible = false;                            // until it has a place in front of the device
    if (preview) { camera.fov = 55; camera.clearViewOffset(); camera.updateProjectionMatrix(); }     // about a tablet camera's view
    if (overlay) overlay.append(pointer, ...tags.map((t) => t.d));
    // two fingers: pinch to zoom, twist to turn (and the land stops carrying you, if it still was). Single taps do
    // nothing to the land: shrubs are marked by aim (see above)
    let g0 = null;
    const two = (e) => { const [a, b] = e.touches; return { d: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY), ang: Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX) }; };
    const zoom = (s) => { ar.auto = null; ar.s = THREE.MathUtils.clamp(s, AR_MIN, AR_MAX); };
    const start = (e) => { if (e.touches.length === 2) { ar.auto = null; g0 = { ...two(e), s: ar.s, rot: ar.rot }; } };
    const move = (e) => {
      if (!g0 || e.touches.length < 2) return;
      e.preventDefault();
      const n = two(e);
      zoom(g0.s * n.d / g0.d);
      ar.rot = ar.rotGoal = g0.rot - (n.ang - g0.ang);     // the fingers lead directly
    };
    const end = (e) => { if (e.touches.length < 2) g0 = null; };
    const wheel = (e) => { e.preventDefault(); zoom(ar.s * Math.exp(-e.deltaY * 0.002)); };
    const noSelect = (e) => e.preventDefault();          // no XR "select" either
    const on = [["touchstart", start, { passive: true }], ["touchmove", move, { passive: false }], ["touchend", end, { passive: true }],
      ["touchcancel", end, { passive: true }], ["wheel", wheel, { passive: false }], ["beforexrselect", noSelect]];
    if (overlay) for (const [t, f, o] of on) overlay.addEventListener(t, f, o);
    leaveAR = () => {
      if (!ar) return;
      ar = null; leaveAR = null; aim.visible = false; aimXY = null; world.visible = true;
      eyeAnim = plotsAnim = null; lineDraw = null;
      for (const l of layers.burn.children) l.geometry.instanceCount = Infinity;
      world.position.copy(saved.pos); world.scale.copy(saved.scale); world.rotation.set(0, saved.rot, 0); sides(false);
      sun.castShadow = saved.shadow; eyeTo = saved.eye;
      renderer.toneMapping = look.tm; hemi.intensity = look.hemi; sun.intensity = 2.7; U.uGlow.value = 0;
      camera.fov = 38;
      camera.position.copy(saved.cam); controls.target.copy(saved.target); controls.enabled = saved.enabled; camera.lookAt(controls.target);
      el.append(pointer, ...tags.map((t) => t.d));
      if (overlay) for (const [t, f] of on) overlay.removeEventListener(t, f);
      resize();
      onXREnd?.();
    };
    session?.addEventListener("end", () => leaveAR?.());
    return session;
  }
  const exitXR = () => { const s = renderer.xr.getSession(); if (s) s.end(); else leaveAR?.(); };
  const arHere = () => { if (ar) ar.place = 1; };
  const markAim = () => { if (ar && aimXY && onTap) onTap([...aimXY]); };
  // for the page's trace (?debug): what the AR scene is doing
  const arState = () => ar && { scale: `1:${Math.round(1 / ar.s)}`, at: ar.at.toArray().map((v) => +v.toFixed(2)),
    eye: new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld).toArray().map((v) => +v.toFixed(2)),
    land: ground.visible && block.visible, circle: focusCid, presenting: renderer.xr.isPresenting };

  return {
    site, scene, camera, controls, renderer, layers, P, hAt,
    view, fade, droneEye, focusPlot, enterXR, exitXR, arHere, markAim, arState, resize,
    plotsIn, arZoomBy, arTurn, arTilt, arWhole, arCircle, prefetch, tally,
    set onARPlaced(f) { onARPlaced = f; },
    set aiming(v) { aiming = v; },
    get aimReady() { return !!aimXY; },
    get arAuto() { return !!ar?.auto || !!ar?.place; }, setMarks, pick, ripple, clumps, point, drawLine, sides,
    get inAR() { return !!ar; },
    get arZoom() { return ar ? ar.k : 0; },          // 0: the whole site in view, 1: zoomed in to the circle
    set onXREnd(f) { onXREnd = f; },
    set onTap(f) { onTap = f; },
    set onPop(f) { onPop = f; },
    set interactive(on) { controls.enabled = on; },
    set autoRotate(on) { controls.autoRotate = on; },
    set paused(v) { paused = v; },
    set shift(v) { shift = v; resize(); },
  };
}
