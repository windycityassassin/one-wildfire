// The journey: one fixed stage (a map, then the drone's 3D block), driven by captions as they scroll past.
// Around it: a narrator (off until asked for), two guesses, the game (on screen, or in AR where the device has it),
// and a source behind every claim.
import { initOrbit } from "./orbit.js";
import { initYou, countTo } from "./you.js";
import { initVoice } from "./voice.js";
import { initRefs } from "./refs.js";

const $ = (s) => document.querySelector(s);
// a trace of what the page decides (step, line, page turn): shown in the corner with ?xr or ?debug in the address
const DEBUG = /[?&](xr|debug)\b/.test(location.search);
const trace = [];
window.__trace = trace;
const dbg = (m) => {
  trace.push(`${(performance.now() / 1000).toFixed(1)}s ${m}`); if (trace.length > 60) trace.shift();
  if (DEBUG) { paintTrace(); fetch(`__t/${encodeURIComponent(trace[trace.length - 1])}`, { cache: "no-store" }).catch(() => {}); }
};
let traceEl = null;
function paintTrace() {
  if (!traceEl) {
    traceEl = document.createElement("div");
    traceEl.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:9;font:11px/1.35 ui-monospace,monospace;color:#ece8e1;background:rgba(0,0,0,.72);padding:8px 10px;border-radius:8px;max-width:72vw;white-space:pre;pointer-events:none";
    document.body.append(traceEl);
  }
  traceEl.textContent = trace.slice(-7).join("\n");
}
const $$ = (s) => [...document.querySelectorAll(s)];
const stage = $("#stage");
const voice = await initVoice();
initRefs();
window.__voice = voice;
voice.onplay = (key) => dbg(`line: ${key}`);
voice.onfail = (key, e) => dbg(`line refused: ${key} (${e?.name || e})`);
if (DEBUG) dbg(`${innerWidth}×${innerHeight} ${matchMedia("(pointer: coarse)").matches ? "touch" : "mouse"}`);

const D = await (await fetch("data/soda/soda.json")).json();
$("#n16").textContent = D.events.rule2016;
$("#n0").textContent = D.dets.filter((d) => d[2] === 0).length;

// ---- clock (local time at the fire) ----
const fmtDay = new Intl.DateTimeFormat("en-US", { timeZone: D.fire.tz, month: "short", day: "numeric" });
const fmtTime = new Intl.DateTimeFormat("en-US", { timeZone: D.fire.tz, hour: "numeric", minute: "2-digit", timeZoneName: "short" });
const clockEl = $("#clock");
const CLOCKED = ["sat", "spot", "start", "pixels", "spread"];
const setClock = (h) => {
  if (CLOCKED.includes(current)) clockEl.classList.add("on");
  if (h == null) {          // before the first sighting: the day, but no hour
    clockEl.querySelector("b").textContent = fmtDay.format(new Date(D.t0));
    clockEl.querySelector("span").textContent = "earlier that day";
    return;
  }
  const t = new Date(D.t0 + h * 3600000);
  clockEl.querySelector("b").textContent = fmtDay.format(t);
  clockEl.querySelector("span").textContent = fmtTime.format(t);
};

// ---- the 1,431 US fires, for "Was that luck?" ----
let current = null;          // the step in the middle of the screen
let visit = 0;               // goes up on every step change, so a timer from an earlier visit to a step can't fire
let orbitReadyResolve;
const orbitReady = new Promise((r) => (orbitReadyResolve = r));
fetch("data/proof/national.json").then((r) => r.json()).then((N) => orbitReady.then((o) => o.setNational(N)));

// ---- the narrator: the hero's two buttons, and a toggle that stays in the corner ----
const snd = $("#snd");
function setVoice(on) {
  voice.enable(on);
  snd.setAttribute("aria-pressed", voice.on ? "true" : "false");
  snd.title = voice.on ? "Narration on" : "Narration off";
}
snd.onclick = () => { setVoice(!voice.on); quiet = began && !voice.on; if (quiet) quietTurn(current); else clearTimeout(quietTimer); };
let autoScrolling = false, autoTimer = 0;
const toStep = (name) => {
  const el = $(`[data-step="${name}"] .cap`) || $(`[data-step="${name}"] .in`) || $(`[data-step="${name}"]`);
  const c = el.getBoundingClientRect();
  autoScrolling = true; clearTimeout(autoTimer); autoTimer = setTimeout(() => (autoScrolling = false), 1500);
  scrollTo({ top: scrollY + c.top + c.height / 2 - innerHeight / 2, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
};
const toFirst = () => toStep("sat");
// With the narrator on, the page turns its own pages: when a step's line ends, the next step scrolls into view.
// Steps that ask something wait for the answer (and move on once the reply has been spoken); the game waits for
// its last circle. A reader who scrolls by hand in the meantime is left alone.
const WAITS = { pixels: ["fires-1", "fires-10", "fires-40"], count: ["crew-right", "crew-wrong", "crew-answer"], you: ["done"], end: [] };
// "Begin quietly" also turns the pages, at the narrator's pace (each step stays as long as its line would last), and
// the questions wait for an answer. Anyone who scrolls by hand takes over, as with the narrator.
let quiet = false, began = false, quietTimer = 0;
const moving = () => voice.on || quiet;
const durs = {};
const clipSeconds = (key) => new Promise((res) => {
  const f = voice.file(key);
  if (!f) return res(12);
  if (durs[key]) return res(durs[key]);
  const a = new Audio(); a.preload = "metadata"; a.src = `voice/${f}`;
  a.onloadedmetadata = () => { durs[key] = a.duration; res(a.duration); };
  a.onerror = () => res(12);
});
function quietTurn(name) {
  clearTimeout(quietTimer);
  if (!quiet || WAITS[name]) return;
  clipSeconds(name).then((s) => { if (quiet && current === name) quietTimer = setTimeout(() => onward(name, 0), s * 1000); });
}
const quietAfter = (name, ms) => { if (quiet) { clearTimeout(quietTimer); quietTimer = setTimeout(() => onward(name, 0), ms); } };
let lastHand = 0;
const byHand = () => { lastHand = performance.now(); };
addEventListener("wheel", byHand, { passive: true });
// a finger dragging the map or the 3D block is looking, not scrolling: only a touch that moves the page counts
addEventListener("touchmove", (e) => { if (!stage.contains(e.target)) byHand(); }, { passive: true });
addEventListener("scroll", () => { if (!autoScrolling) byHand(); }, { passive: true });
addEventListener("keydown", (e) => { if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", " ", "Home", "End"].includes(e.key)) byHand(); });
function onward(from, delay = 900) {
  const all = $$("[data-step]"), i = all.findIndex((s) => s.dataset.step === from), next = all[i + 1];
  if (!next) return;
  // keep trying while a hand is on the page; give up only if the narrator is off or the reader has moved on
  const tryGo = () => {
    if (!moving() || current !== from) return dbg(`stay (${!moving() ? "not playing" : "now at " + current})`);
    if (performance.now() - lastHand < 2500) { dbg("hand busy, retry"); setTimeout(tryGo, 1000); return; }
    if (ground?.inAR) { setTimeout(tryGo, 1000); return; }          // the game is being played in AR: wait for it to end
    dbg(`turn → ${next.dataset.step}`);
    toStep(next.dataset.step);
  };
  setTimeout(tryGo, delay);
}
voice.onend = (key) => {
  dbg(`line ended: ${key}`);
  if (!current) return;
  const waits = WAITS[current];
  if (waits ? waits.includes(key) : key === current) onward(current, key === "spot" ? 1600 : 900);
};
$("#begin-sound").onclick = () => { began = true; quiet = false; setVoice(true); if (!voice.has("intro")) toFirst(); };
$("#begin-quiet").onclick = () => { began = true; setVoice(false); quiet = true; dbg("quiet autoplay"); toFirst(); };
if (!voice.available) {                       // no recording yet: no narration buttons
  $("#begin-sound").hidden = true; snd.hidden = true;
  $("#begin-quiet").textContent = "Begin"; $("#begin-quiet").classList.add("solid");
}

// ---- guesses ----
const guesses = {};
function guess(name, onPick) {
  const box = $(`.guess[data-guess="${name}"]`);
  box.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || box.classList.contains("done")) return;
    box.classList.add("done");
    b.classList.add("picked");
    guesses[name] = Number(b.dataset.v);
    onPick?.(Number(b.dataset.v), box);
  });
  return box;
}
// the answer to this one is the story's next turn, so it is not given away here: just a nod, and a nudge on
guess("fires", (v) => {
  voice.say(`fires-${v}`);
  quietAfter("pixels", 4000);
  const el = $("#lock-fires");
  el.textContent = `${v === 1 ? "One" : `About ${v}`}. Hold that thought, and keep scrolling: the computer is about to answer too.`;
  el.hidden = false;
});
function firesFeedback() {
  const g = guesses.fires, el = $("#fb-fires");
  if (g == null || !el.hidden) return;
  el.textContent = g === 1 ? "You said one. The computer did not." : g === 40 ? "You said about 40, the same as the computer. From space, that is how it looks." : "You said about 10. The real answer was simpler.";
  el.hidden = false;
}
// "count": the drone's few, then the question of what people on foot found; the answer brings the crew's rings
let crewShown = false;
const later = (id) => $(id).classList.add("in");
function showCrew(picked) {
  if (crewShown || !you) return;
  crewShown = true;
  const box = $('.guess[data-guess="crew"]'), n = you.stats.example.young.length;
  later("#count-drone"); later("#count-ask");
  box.classList.add("done");
  box.querySelector(`button[data-v="${n}"]`)?.classList.add("right");
  $("#crew-ans").hidden = false; $("#crew-more").hidden = false;
  if (current === "count") {
    you.exampleCrew();
    voice.say(picked == null ? "crew-answer" : picked === n ? "crew-right" : "crew-wrong");
    quietAfter("count", 9000);
  }
}
guess("crew", (v) => showCrew(v));

// ---- stage ----
const orbit = await initOrbit($("#map"), D);
orbit.onClock = setClock;
orbit.onCount = (m) => { $("#n16").textContent = m; };
orbit.onPct = (p) => { $("#pct").textContent = `${Math.round(p * 100)}%`; };
// marks in the narrator's lines that pictures wait for (see voice/lines.json)
const MARKS = { z1: "spot", z2: "spot", z3: "spot", strike: "start", flip: "us", drone: "descend", eye: "missed", line: "missed", circle: "count", ask: "count" };
// a picture waits for its word; without the narrator (or if the word has gone by), it goes after `ms`
const onCue = (mark, ms, f) => { const n = visit, here = () => visit === n; voice.cue(MARKS[mark], mark).then((cued) => here() && setTimeout(() => here() && f(), cued ? 0 : ms)); };
orbit.cue = (mark) => voice.cue(MARKS[mark], mark);
orbitReadyResolve(orbit);
window.__orbit = orbit;
let ground = null, you = null;
let arOK = false, arAsked = false;       // the device can do AR; the question has been answered
const groundReady = (async () => {
  const { initGround } = await import("../ground.js");
  // phones and tablets get the lighter terrain mesh (a quarter of the triangles), so the block still moves smoothly
  const light = matchMedia("(pointer: coarse)").matches || (navigator.hardwareConcurrency || 8) <= 4;
  ground = await initGround($("#ground"), { quality: light ? "lo" : "hi" });
  ground.paused = true;
  ground.onXREnd = backFromAR;
  const y16 = ground.site.summary.burnt.short;
  $("#pyoung").textContent = `${Math.round(y16.p * 100)} in 100`;
  you = initYou(ground);
  // the narrator follows the game: a word as each circle opens, then what the crew and the drone found there
  // and how you did (the first time, also what the rings mean)
  you.onLoad = () => voice.say([], { cut: true });           // a new circle: whatever was being said stops
  you.cue = () => voice.cue("you", "point");
  you.onCheck = ({ k, say }) => {
    const keys = say ? [say] : [];                            // you.js picks the reply, so the voice and the page agree
    if (k === 1) keys.unshift("check");                       // the first time: what the rings mean
    voice.say(keys, { again: true, cut: true });
  };
  you.onFinish = () => { voice.say("done", { cut: true }); quietAfter("you", 3000); };
  window.__you = you; window.__ground = ground;
  const ex = you.stats.example, n = ex.young.length, d = ex.youngFound.length;
  $("#myoung").textContent = n;
  $("#myf").textContent = d || "none";
  const opts = [...new Set([d, Math.round(n / 3), n])].sort((a, b) => a - b);     // as many as the drone, more, or many more
  $("#crew-opts").innerHTML = opts.map((v) => `<button data-v="${v}">${v}</button>`).join("");
  // AR only where the browser can do it (Chrome on an ARCore phone or tablet): then the game asks first
  let vr = false, ar = false;
  if (navigator.xr) {
    [vr, ar] = await Promise.all([navigator.xr.isSessionSupported("immersive-vr").catch(() => false),
      navigator.xr.isSessionSupported("immersive-ar").catch(() => false)]);
  }
  arOK = ar;
  // ?xr in the address: say in the corner what this browser reports, for testing on a phone or headset
  if (new URLSearchParams(location.search).has("xr")) {
    const d = document.createElement("div");
    d.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:9;font:12px/1.4 system-ui;color:#ece8e1;background:rgba(0,0,0,.7);padding:8px 10px;border-radius:8px;max-width:70vw";
    d.textContent = `WebXR: ${navigator.xr ? "available" : "not in this browser"} · VR: ${vr ? "yes" : "no"} · AR: ${ar ? "yes" : "no"} · secure: ${isSecureContext ? "yes" : "no"}`;
    d.style.bottom = "";
    d.style.top = "12px";
    document.body.append(d);
  }
  return ground;
})();

// ---- the next part in AR: asked just before the game starts, only where the device can do it. Yes: the whole site
// appears in front of you, the game panel moves into the AR overlay, and the page stands still behind it. No (or Exit
// AR at any point): the game carries on here, on screen, from wherever it is ----
const arUI = $("#ar-ui"), toolsHome = $("#tools").parentNode, toolsNext = $("#tools").nextSibling;
function startGame() {
  $("#ar-offer").hidden = true; $("#ar-intro").hidden = true; $("#tools").hidden = false;
  $("#you-turn").hidden = false; $("#you-next").hidden = true;
  voice.scene("you");                    // the game's first line waits for the game, not for the question
  you.show();
}
$("#ar-no").onclick = () => { arAsked = true; startGame(); };     // the game, here on screen
let arTrace = 0;
async function goAR(preview = false) {
  arAsked = true;
  const intro = !arIntroDone;
  $("#ar-offer").hidden = true; $("#ar-intro").hidden = true;
  $("#you-turn").hidden = false; $("#you-next").hidden = true;
  if (!intro) startGame();
  else {                                 // nothing of the game yet but its circle, in green: no rings, no pointer
    you.hide(); ground.focusPlot(you.stats.plots[you.progress.circle].cid);
    introOn = true; arSay("Point the tablet at a table or the floor. The land will appear there.", true);
  }
  arUI.classList.add("on");
  $("#ar-panel").append($("#tools"));
  $("#ar-panel").hidden = intro;
  const placed = new Promise((r) => { ground.onARPlaced = r; });
  try {
    await ground.enterXR("ar", { overlay: arUI, preview, intro });
    you.marking = true;
    dbg("AR on");
    clearInterval(arTrace);
    arTrace = setInterval(() => (ground.inAR ? dbg(`AR ${JSON.stringify(ground.arState())}`) : clearInterval(arTrace)), 3000);
    coach();
    if (intro) arOpening(placed);
  } catch (e) { dbg(`AR refused: ${e?.name || e}${e?.message ? ` (${e.message})` : ""}`); backFromAR(); }
}

// ---- the AR opening, the first time only. Nothing to wait through: the land appears as the last page left it (the
// photo, the orange line, every circle, the one to play in green), the card at the bottom left (where the game's
// panel will be) is there from the start, and the controls work at once. You go into the green circle when you
// choose (its button, or + until you are there); then the young shrubs people found there light up and the card
// asks how many you think you can find, spoken by the narrator ----
let arIntroDone = false, introOn = false, openRun = 0;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function arSay(html, now = false) {
  const card = $("#ar-story"), t = $("#st-text");
  card.hidden = false;
  if (now) { t.innerHTML = html; return; }
  t.classList.add("swap");
  setTimeout(() => { t.innerHTML = html; t.classList.remove("swap"); }, 280);
}
// the card's buttons (in the place the question's answers use)
function arOpts(items) {
  const box = $("#ar-ask");
  box.querySelector(".opts").innerHTML = items.map(([label], i) => `<button data-i="${i}">${label}</button>`).join("");
  box.querySelectorAll("button").forEach((b) => (b.onclick = () => items[b.dataset.i][1]()));
  box.hidden = false;
}
async function arOpening(placed) {
  const run = ++openRun, on = () => run === openRun && ground.inAR;
  const G = ground, p = you.stats.plots[you.progress.circle];
  introOn = true;
  G.prefetch(p.cid);
  await placed;
  if (!on()) return;
  arSay(`The land you just saw. Turn it, tip it and come closer with the buttons on the right.`);
  await wait(280); if (!on()) return;
  // on when you say: the button, or zooming in yourself (+ heads for the green circle)
  await new Promise((go) => {
    arOpts([[`Go into the <span class="life">green circle</span>`, go]]);
    const poll = () => (!on() || G.arZoom > 0.85 ? go() : setTimeout(poll, 200));
    poll();
  });
  if (!on()) return;
  $("#ar-ask").hidden = true;
  arSay(`Down into the <span class="life">green circle</span>.`);
  // arrived when the land is at the circle's size, however it got there (a + or a pinch mid-glide replaces the glide)
  G.arCircle(2600);
  await new Promise((r) => { const poll = () => (!on() || G.arZoom > 0.97 ? r() : setTimeout(poll, 100)); poll(); });
  if (!on()) return;
  arAsk(p);
}
// the question: how many people found here, but not where (showing their rings first gave the answer away)
function arAsk(p) {
  const run = openRun, on = () => run === openRun && ground.inAR;
  const n = p.young.length;
  const opts = [...new Set([Math.max(1, Math.round(n / 4)), Math.round(n / 2), n])].filter((v) => v > 0).sort((a, b) => a - b);
  arSay(`People on foot found <span class="life">${n} young shrub${n === 1 ? "" : "s"}</span> in this circle. How many do you think you can find?`);
  if (n === 8) voice.scene("ar-ask");        // the spoken line says "eight": the first circle, as it always is here
  const box = $("#ar-ask");
  box.querySelector(".opts").innerHTML = opts.map((v) => `<button data-v="${v}">${v === n ? `All ${n}` : v}</button>`).join("");
  setTimeout(() => { if (on()) box.hidden = false; }, 600);
  for (const b of box.querySelectorAll("button")) b.onclick = () => {
    const v = Number(b.dataset.v);
    you.guess = { cid: p.cid, v };
    box.hidden = true;
    arSay(v === n ? "All of them? Let's see." : `${v}? Let's see.`);
    setTimeout(() => { if (ground.inAR) arPlay(); }, 1300);
  };
}
// the opening is over: the card gives way to the game's panel, in the same place
function arPlay() {
  openRun++; introOn = false; arIntroDone = true;
  $("#ar-story").hidden = true; $("#ar-ask").hidden = true;
  $("#ar-panel").hidden = false;
  startGame();
}
// the controls on the right: closer and further; a pad to turn the land round (left, right) and tip it toward you
// or back (up, down), so it can be seen from any side and any height
$("#ar-in").onclick = () => ground.arZoomBy(1.8);
$("#ar-out").onclick = () => ground.arZoomBy(1 / 1.8);
$("#ar-left").onclick = () => ground.arTurn(Math.PI / 6);
$("#ar-right").onclick = () => ground.arTurn(-Math.PI / 6);
$("#ar-up").onclick = () => ground.arTilt(0.22);
$("#ar-down").onclick = () => ground.arTilt(-0.22);
// before AR starts: what to look for, and the three things to do
$("#ar-yes").onclick = () => { $("#ar-offer").hidden = true; $("#ar-intro").hidden = false; };
$("#ar-back").onclick = () => { $("#ar-intro").hidden = true; $("#ar-offer").hidden = false; };
$("#ar-start").onclick = () => goAR();
// in AR: a line at the top says what is happening and, in the circle, how to mark; the Mark button marks where the
// white ring is. Once the circle is checked, the panel says the rest, so the line and the button step aside
function coach() {
  const box = $("#ar-coach"), say = $("#ar-say"), look = $("#ar-look"), mark = $("#ar-mark");
  let last = null;
  const tick = () => {
    if (!ground.inAR) { mark.hidden = true; return; }
    if (introOn) { ground.aiming = false; mark.hidden = true; box.hidden = true; last = "intro"; setTimeout(tick, 150); return; }     // the opening has its own card
    const g = you.progress, playing = !g.finished && !g.revealed;
    ground.aiming = playing;
    const now = !playing ? "" : ground.arZoom < 0.6 ? (ground.arAuto ? "going" : "zoom") : "look";
    if (now !== last) {
      last = now;
      box.hidden = !now; look.hidden = now !== "look"; mark.hidden = now !== "look";
      say.textContent = { going: "This is the whole site. Taking you to the green circle.", zoom: "Press + (or pinch outward) to go back into the green circle.",
        look: "Move the tablet until the white ring sits on a young sagebrush like these, then press Mark." }[now] || "";
    }
    mark.disabled = !ground.aimReady;
    setTimeout(tick, 150);
  };
  tick();
}
$("#ar-mark").onclick = () => ground.markAim();
$("#ar-exit").onclick = () => ground.exitXR();
$("#ar-here").onclick = () => ground.arHere();
// for testing on a desktop (?debug): show the question, or the AR scene as a tablet would see it (no camera feed)
if (DEBUG) { window.__askAR = () => { arOK = true; arAsked = false; }; window.__previewAR = () => goAR(true); window.__tapAR = (x, y) => { const o = $("#ar-ui"), T = (n) => [new Touch({ identifier: 1, target: o, clientX: x, clientY: y })]; o.dispatchEvent(new TouchEvent("touchstart", { touches: T(), changedTouches: T(), bubbles: true })); o.dispatchEvent(new TouchEvent("touchend", { touches: [], changedTouches: T(), bubbles: true })); }; }
function backFromAR() {
  you.marking = false;
  arUI.classList.remove("on");
  toolsHome.insertBefore($("#tools"), toolsNext);
  // left during the opening: it stops, and the game starts here on screen
  const opening = introOn;
  openRun++; introOn = false; $("#ar-story").hidden = true; $("#ar-ask").hidden = true; $("#ar-panel").hidden = false;
  if (current !== "you") return;
  if (opening || !arIntroDone) { ground.droneEye(0); ground.fade("burn", 1); ground.fade("plots", 1); ground.fade("focus", 1); startGame(); }
  else you.show();     // the same circle, on screen
}

// ---- your answers, shown at the close once you've played a part: each next to the real one ----
function run() {
  const r = you?.results(), blocks = [];
  const fires = (v) => (v === 1 ? "one" : `about ${v}`);
  if (guesses.fires != null) blocks.push(`<div class="q"><div class="qq">How many fires was the Soda Fire?</div><div class="cmp">
    <span>You said<b>${fires(guesses.fires)}</b></span><span>The 2016 rule<b>${D.events.rule2016}</b></span><span>Really<b class="fire">1</b></span></div></div>`);
  if (guesses.crew != null && you) {
    const ex = you.stats.example;
    blocks.push(`<div class="q"><div class="qq">The drone found ${ex.youngFound.length} young shrubs in one circle. How many did people on foot find?</div><div class="cmp">
      <span>You guessed<b>${guesses.crew}</b></span><span>People found<b class="life">${ex.young.length}</b></span></div></div>`);
  }
  if (r?.circles) {
    const bar = (who, k, v) => `<div class="row ${k}"><span class="w">${who}</span><span class="bar"><i style="width:${r.crew ? (v / r.crew) * 100 : 0}%"></i></span><b>${v}</b></div>`;
    blocks.push(`<div class="q"><div class="qq">Young shrubs found in the ${r.circles === 1 ? "circle" : `${r.circles} circles`} you checked</div>
      ${bar("You", "you", r.you)}${bar("Drone", "drone", r.drone)}${bar("Field crew", "crew", r.crew)}</div>`);
  }
  const el = $("#run");
  el.hidden = !blocks.length;
  el.innerHTML = `<div class="t">Your answers</div>` + blocks.join("");
}

// ---- steps ----
const steps = $$("[data-step]");
let answerTimer = null;

async function enter(name) {
  if (name === current || ground?.inAR) return;      // while AR is on, the page behind it stands still
  current = name; visit++;
  dbg(`step: ${name}`);
  quietTurn(name);
  voice.scene(name === "you" && arOK && !arAsked ? "you-ask" : name);     // the game's line waits for the AR question
  for (const el of $$(`[data-step="${name}"] [data-count]`)) { el.dataset.v = 0; countTo(el, Number(el.dataset.count), 900); }
  if (name === "one") setTimeout(firesFeedback, 900);
  if (name === "end") run();
  const atGround = ["missed", "count", "you"].includes(name);
  ground?.sides(false);
  if (!["spot", "pixels", "spread"].includes(name)) clockEl.classList.remove("on");   // start and sat show it once their clock runs
  clearTimeout(answerTimer);

  if (name === "end") { if (you) you.hide(); return; }   // the last picture stays behind the close
  if (!atGround) {
    stage.classList.remove("at-ground");
    if (ground) { ground.paused = true; you.hide(); }
    orbit.setMode(name);
    return;
  }
  toGround(name);
}

async function toGround(name) {
  const G = await groundReady;
  if (current !== name) return;
  stage.classList.add("at-ground");
  G.paused = false;
  G.resize();
  const L = (k, on) => G.fade(k, on ? 1 : 0);
  if (name === "missed") {
    // the drone's point of view: from high above, the photo gives way to height (blue) on "It sees height", and
    // the fire line draws itself on "The orange line"
    you.hide();
    G.view("above", null, 2600); G.droneEye(0); G.autoRotate = true; G.interactive = true;
    L("burn", 0); L("plots", 0); L("drone", 0); L("found", 0); L("missed", 0); L("focus", 0);
    onCue("eye", 2200, () => G.droneEye(1));
    onCue("line", 4800, () => G.drawLine(2600));
  } else if (name === "count") {
    // one page, carrying on from the drone's view: the same height picture with the line, its two sides named; on
    // "In this one circle" down into the circle, where the drone's few rings appear; on "People walked" the question
    you.hide();
    G.view("above", null, 2000); G.droneEye(1); G.autoRotate = false; G.interactive = true;
    L("burn", 1); L("plots", 0); L("drone", 0); L("found", 0); L("missed", 0); L("focus", 0);
    // every visit starts from the first beat: only the two sides. (Scrolling back here used to show every line of
    // the page at once, over the two sides, until the next beat split them apart again)
    G.sides(true); $("#count-sides").classList.remove("gone");
    for (const id of ["#count-drone", "#count-ask"]) $(id).classList.remove("in");
    $("#crew-ans").hidden = $("#crew-more").hidden = true;
    const n = visit;
    onCue("circle", 6000, () => {
      // the sides have made their point: their sentence steps aside, so the circle's words and the question fit
      G.sides(false); G.droneEye(0); L("plots", 1); L("focus", 1); $("#count-sides").classList.add("gone");
      you.example(); later("#count-drone");
      setTimeout(() => visit === n && (crewShown ? you.exampleCrew() : you.exampleDrone()), 2600);
    });
    onCue("ask", 11000, () => {
      later("#count-ask");
      if (crewShown) { $("#crew-ans").hidden = $("#crew-more").hidden = false; }     // answered on an earlier visit
      else answerTimer = setTimeout(() => showCrew(), 20000);      // no guess? the answer arrives anyway
    });
  } else if (name === "you") {
    G.droneEye(0); G.autoRotate = false; G.interactive = true;
    L("burn", 1); L("plots", 1); L("drone", 0); L("found", 0); L("missed", 0); L("focus", 1);
    // where AR is possible, ask first (once), from high above with nothing of the game shown yet: no circle picked,
    // no rings, no "Your turn." Only the answer starts it, here or in AR. Otherwise straight into the game
    if (arOK && !arAsked) {
      you.hide(); L("focus", 0);
      $("#you-turn").hidden = true; $("#you-next").hidden = false;
      $("#ar-offer").hidden = false; $("#ar-intro").hidden = true; $("#tools").hidden = true;
      G.view("above", null, 2400);
    } else if (!G.inAR) startGame();
  }
  stage.classList.toggle("tapping", name === "you");
  G.shift = ["you", "missed", "count"].includes(name) ? 0.2 : 0.13;
}

// whichever step crosses the middle of the screen is the current one
const io = new IntersectionObserver((es) => {
  for (const e of es) if (e.isIntersecting) enter(e.target.dataset.step);
}, { rootMargin: "-50% 0px -50% 0px" });
steps.forEach((s) => io.observe(s));

// ---- the rail: whose eyes the page is looking through, on a log scale from the satellite's 705 km down to a person's
// eyes at 1.6 m (so the stations sit at 0%, 74.5% and 100%). Every page of satellite data sits at 705 km; from
// "descend" on, the drone's pictures sit at 44 m (the dot rides down with the camera's 5.2 s flight); you, at 1.6 m,
// only in AR, where you hold the land yourself. The game on the page, and the end, are still the drone's photo.
// In AR the rail moves into the AR layer, the only part of the page the tablet shows then ----
const dot = $(".dot"), stns = $$("#alt .stn"), alt = $("#alt");
const TOP = 705000, EYE = 1.6, STN = [TOP, 44, EYE], SPAN = Math.log(TOP / EYE);
const place = (m) => Math.log(TOP / m) / SPAN;
const DRONE = ["descend", "missed", "count", "you", "end"];
const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - (2 - 2 * k) ** 2 / 2);
let shown = 0, from = 0, to = 0, t0 = 0, dur = 1;
function altitude() {
  const inAR = !!ground?.inAR;
  if (inAR !== (alt.parentNode === arUI)) inAR ? arUI.append(alt) : document.body.insertBefore(alt, clockEl);
  const a = place(inAR ? EYE : DRONE.includes(current) ? 44 : TOP);
  if (a !== to) { from = shown; to = a; t0 = performance.now(); dur = current === "descend" && !inAR ? 5200 : 1600; }
  shown = from + (to - from) * ease(Math.min(1, (performance.now() - t0) / dur));
  const narrow = innerWidth <= 760 || inAR;          // flat, as on a phone
  if (narrow) { dot.style.left = `${shown * 100}%`; dot.style.top = ""; stns.forEach((s, i) => (s.style.left = `${place(STN[i]) * 100}%`)); }
  else { dot.style.top = `${shown * 100}%`; dot.style.left = ""; stns.forEach((s) => (s.style.left = "")); }
  stns.forEach((s, i) => s.classList.toggle("here", Math.abs(shown - place(STN[i])) < 0.06));
  requestAnimationFrame(altitude);
}
requestAnimationFrame(altitude);
enter("intro");

