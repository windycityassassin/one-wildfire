// You: stand over a field circle on the burned side, tap the young shrubs you can see, and race the drone.
//
// Only 16 of the 54 burned circles have any young shrubs in them (the crew found none in the other 38),
// so those 16 come first and the game says plainly that the rest were empty. The first circle is the one
// with the most young shrubs after the story's example, so you learn what one looks like; the example
// (whose answer you have already seen) comes last; the rest follow in a fixed shuffled order.
//
// Instead of pictures to learn from, the first circle points one young shrub out on the picture itself, then
// asks whether you can see more like it; later circles offer "Show me one". A shrub that was pointed out is
// not yours to find: it is left out of your score (taps on it are ignored), and the crew's count still has it.
//
// "Check" pairs your taps with the crew's young shrubs one to one (each tap can claim at most one shrub,
// nearest pairs first, within MATCH metres), so a tap in a clump never scores twice. The scoreboard shows this
// circle only (you, the drone, the crew) and starts fresh on every circle; the totals come once at the end.

const HA = 10000;
const MATCH = 0.5;
// what's said after Check, by how it went: [narration line (voice/lines.json), the same words on the page].
// Each kind takes its turns in order, so the same reply never comes twice running.
const REPLY = {
  all: [["you-all", "Sharp eyes. Can you do it again?"], ["you-all-b", "You're good at this."],
        ["you-all-c", "Nicely done. Can you keep it up?"]],
  one: [["you-all-1", "Can you do it again?"], ["you-all-1b", "Well spotted."], ["you-all-1c", "Good eye."]],
  some: [["you-some", "Hard, isn't it?"], ["you-some-b", "The small ones hide well, don't they?"],
         ["you-some-c", "Not bad: they're easy to miss."]],
  none: [["you-none", "Hard, isn't it? They're tiny."], ["you-none-b", "Tricky, that one. They're very small."],
         ["you-none-c", "Not easy, is it? They blend right into the ground."]],
};

// nearest-first, one-to-one pairing of taps and shrubs: returns the indices of the taps that found a shrub
function match(taps, shrubs) {
  const pairs = [];
  taps.forEach((t, i) => shrubs.forEach((s, j) => {
    const d = Math.hypot(t.xy[0] - s.xy[0], t.xy[1] - s.xy[1]);
    if (d <= MATCH) pairs.push([d, i, j]);
  }));
  pairs.sort((a, b) => a[0] - b[0]);
  const ti = new Set(), sj = new Set();
  for (const [, i, j] of pairs) if (!ti.has(i) && !sj.has(j)) { ti.add(i); sj.add(j); }
  return ti;
}

// numbers that count up instead of jumping
export function countTo(el, value, ms = 600) {
  const from = Number(el.dataset.v || 0);
  el.dataset.v = value;
  if (from === value || matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = value; return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    el.textContent = Math.round(from + (value - from) * (1 - (1 - k) ** 3));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function initYou(G) {
  const S = G.site, R = S.plot_r, AREA = Math.PI * R * R;
  const byPlot = new Map();
  for (const s of S.shrubs) { if (!byPlot.has(s.cid)) byPlot.set(s.cid, []); byPlot.get(s.cid).push(s); }
  const all = S.plots.filter((p) => p.burnt).map((p) => {
    const crew = byPlot.get(p.cid) || [];
    const young = crew.filter((s) => !s.tall);
    return { ...p, crew, young, youngFound: young.filter((s) => s.found) };
  });
  const lineDist = (p) => Math.min(...S.burn.flat().map(([x, y]) => Math.hypot(x - p.xy[0], y - p.xy[1])));
  // the story's example: the circle well inside the burn with the most young shrubs
  const example = all.filter((p) => lineDist(p) > R + 2).sort((a, b) => b.young.length - a.young.length)[0];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const withYoung = all.filter((p) => p.young.length);
  const first = withYoung.filter((p) => p !== example).sort((a, b) => b.young.length - a.young.length)[0];
  const middle = withYoung.filter((p) => p !== example && p !== first).map((p) => [rnd(), p]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  const plots = [first, ...middle, example];
  const empty = all.length - withYoung.length;
  const totalYoung = withYoung.reduce((s, p) => s + p.young.length, 0);
  const totalDrone = withYoung.reduce((s, p) => s + p.youngFound.length, 0);
  const haAll = all.length * AREA / HA;
  const crewPerHa = totalYoung / haAll, dronePerHa = totalDrone / haAll;

  let i = 0, taps = [], revealed = false, active = false, finished = false;
  const turns = { all: 0, one: 0, some: 0, none: 0 };
  const $ = (s) => document.querySelector(s);
  const tools = $("#tools"), stat = $("#toolstat"), go = $("#go"), legend = $("#legend"), count = $("#gcount"), pips = $("#pips"), hint = $("#hint");

  // the shrub to point out: one growing on its own (not in a clump), as near the middle of the circle as possible
  function pickOne(p) {
    const alone = G.clumps(p.young).filter((g) => g.shrubs.length === 1).map((g) => g.shrubs[0]);
    const near = (s) => Math.hypot(s.xy[0] - p.xy[0], s.xy[1] - p.xy[1]);
    const untapped = (s) => !taps.some((t) => Math.hypot(t.xy[0] - s.xy[0], t.xy[1] - s.xy[1]) <= MATCH);
    const pool = alone.filter(untapped).length ? alone.filter(untapped) : p.young.filter(untapped).length ? p.young.filter(untapped) : p.young;
    return pool.sort((a, b) => near(a) - near(b))[0];
  }
  const TAG = "<b>A young sagebrush</b>";
  function showOne(p) {
    if (!p.shown) p.shown = pickOne(p);
    G.point(p.shown.xy, TAG);
    hint.hidden = true;
  }
  pips.innerHTML = plots.map(() => "<i></i>").join("");

  const render = (pop = false) => {
    const p = plots[i];
    G.setMarks(revealed ? { taps, young: p.young, drone: p.youngFound, pop } : { taps });
  };
  function paintPips() {
    [...pips.children].forEach((el, k) => {
      el.className = plots[k].done && !plots[k].skipped ? (plots[k].found === plots[k].young.length ? "all" : "done") : k === i && !finished ? "now" : "";
    });
  }
  // in AR, shrubs are marked by aiming the white ring and pressing Mark, not by tapping
  const firstLine = () => `Find more like it. ${api.marking ? "Aim the white ring at each one and press Mark" : "Tap each one"}, then press Check.`;
  let loadT = 0;
  function load() {
    const p = plots[i];
    taps = []; revealed = false;
    legend.hidden = true; undo.hidden = true;
    G.point(null);
    count.textContent = `Circle ${i + 1} of ${plots.length}`;
    stat.innerHTML = i === 0 ? firstLine() : "Now this circle.";
    hint.hidden = i === 0 || p.young.length < 2;
    go.textContent = "Check"; go.disabled = false;
    G.focusPlot(p.cid); G.view("plot", p.cid, 1800);
    paintPips(); render(); score();
    // the first circle: once the camera has arrived (and, with the narrator, on "Look here"), point one out
    if (i === 0) {
      const t = ++loadT;
      Promise.all([api.cue?.() ?? false, new Promise((r) => setTimeout(r, 1900))])
        .then(() => { if (t === loadT && i === 0 && !revealed && active) showOne(p); });
    }
    api?.onLoad?.({ i, last: i === plots.length - 1 });
  }
  hint.onclick = (e) => { e.preventDefault(); if (!revealed && !finished) showOne(plots[i]); };
  G.onTap = ([x, y]) => {
    if (!active || revealed || finished) return;
    const p = plots[i];
    if (Math.hypot(x - p.xy[0], y - p.xy[1]) > R + 0.3) return;
    if (p.shown && Math.hypot(x - p.shown.xy[0], y - p.shown.xy[1]) < 0.3) { G.ripple([x, y]); return; }   // that one is already found
    // every tap counts (some seedlings grow 5 cm apart, so tapping near a dot must not remove it); Undo takes one back
    taps.push({ xy: [x, y] }); G.ripple([x, y]);
    undo.hidden = false;
    render();
  };
  const undo = $("#undo");
  undo.onclick = (e) => {
    e.preventDefault();
    if (revealed || !taps.length) return;
    taps.pop();
    undo.hidden = !taps.length;
    render();
  };

  function check() {
    revealed = true;
    loadT++; G.point(null); hint.hidden = true;
    const p = plots[i];
    const others = p.young.filter((s) => s !== p.shown);
    const ok = match(taps, others);
    taps.forEach((t, k) => (t.ok = ok.has(k)));
    const n = p.young.length, f = ok.size, d = p.youngFound.length, m = others.length, given = n - m;
    p.done = true; p.found = f;
    // short: what you found, a question, and what to do next (the rings and the scoreboard say the rest)
    const of = given ? (m === 1 ? "the other one" : `the other ${m}`) : m === 1 ? "the one here" : `the ${m} here`;
    const found = !m ? "That was the only one here."
      : f === m ? `You found ${m === 1 ? "it" : m === 2 ? "both" : `all ${m}`}.`
      : f ? `You found ${f} of ${of}.` : `You didn't spot ${of} this time.`;
    const kind = !m ? null : f === m ? (m === 1 ? "one" : "all") : f ? "some" : "none";
    const [say, ask] = kind ? REPLY[kind][turns[kind]++ % REPLY[kind].length] : [null, ""];
    const next = i === plots.length - 1 ? "Press See the result." : "Press Next circle and try again.";
    // the AR opening asked how many you thought you could find here: your guess comes first
    const guessed = api.guess?.cid === p.cid ? `You guessed ${api.guess.v}. ` : "";
    stat.innerHTML = `${guessed}${found} ${ask} <span class="next">${next}</span>`;
    legend.hidden = false; undo.hidden = true;
    legend.querySelector(".grey").hidden = !taps.some((t) => t.ok === false);
    legend.querySelector(".drn").hidden = !d;
    // only when this circle has shrubs growing together, and with this circle's own number
    const big = Math.max(0, ...G.clumps(p.young).map((g) => g.shrubs.length)), clump = legend.querySelector(".clump");
    clump.hidden = big < 2;
    if (big >= 2) {
      clump.querySelector(".num").textContent = big;
      clump.querySelector("em").textContent = `${["", "", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][big] || big} growing together`;
    }
    go.textContent = i === plots.length - 1 ? "See the result" : "Next circle";
    render(true);
    score(); paintPips();
    api.onCheck?.({ k: plots.filter((q) => q.done && !q.skipped).length, n, f, d, m, say });
  }
  // the end (played through, or skipped): back up to the whole site, where the circles with young shrubs turn green
  // and every young shrub people found in them shows as a dot (G.tally); on the page, or in AR
  function overview(ms = 2400, delay = 900) {
    G.focusPlot(null); G.setMarks({}); G.point(null);
    if (G.inAR) { G.arWhole(2600); G.arTilt(0.45); }      // in AR, also tipped toward you: the circles seen more from above
    else G.view("above", null, 2600);
    G.tally(plots, ms, delay);
  }
  function finish() {
    finished = true;
    count.textContent = `All ${plots.length} circles`;
    $("#allcrew").hidden = true; undo.hidden = true; hint.hidden = true;
    overview();
    stat.innerHTML = `Every young shrub people found, in the <span class="life">${plots.length} green circles</span>. In the other ${empty}, none.`;
    legend.hidden = true;
    go.disabled = true; go.textContent = "Done";
    paintPips(); score();
    if (plots.some((q) => !q.skipped)) api.onFinish?.();
  }
  go.onclick = () => {
    if (!revealed) return check();
    if (i < plots.length - 1) { i++; load(); } else finish();
  };
  $("#allcrew").onclick = (e) => {              // for anyone who would rather not play
    e.preventDefault();
    for (const p of plots) if (!p.done) { p.done = true; p.found = 0; p.skipped = true; }
    finish();
  };

  // the scoreboard: this circle only, empty until you check it; at the end, every circle added up
  const rows = { you: $("#score .you"), drone: $("#score .drone"), crew: $("#score .crew") }, lab = $("#score .lab");
  let scored = false;        // the scoreboard stays out of the way until the first Check
  function score() {
    if (revealed || finished) scored = true;
    $("#score").hidden = !scored;
    const played = plots.filter((p) => p.done && !p.skipped), p = plots[i];
    let v = null, of = 1;
    if (finished) {
      lab.textContent = `All ${plots.length} circles with young shrubs`;
      v = { you: played.length === plots.length ? played.reduce((t, q) => t + q.found, 0) : null, drone: totalDrone, crew: totalYoung };
      of = totalYoung;
    } else {
      lab.textContent = "This circle";
      if (revealed) { v = { you: p.found, drone: p.youngFound.length, crew: p.young.length }; of = p.young.length; }
    }
    for (const k of ["you", "drone", "crew"]) {
      const b = rows[k].querySelector("b"), x = v?.[k];
      if (x == null) { b.dataset.v = 0; b.textContent = "–"; }
      else if (finished) countTo(b, x);            // the totals count up; a single circle's numbers just appear
      else { b.dataset.v = x; b.textContent = x; }
      rows[k].querySelector("i").style.width = `${x == null ? 0 : (x / of) * 100}%`;
    }
    const sum = $("#gsum");
    sum.hidden = !finished;
    // counts, not plants per hectare: the published plot size (25 m²) and the drawn circles (5 m radius) disagree
    if (finished) sum.innerHTML = `Across all ${all.length} burned circles, the crew counted <b class="life">${totalYoung}</b> young shrubs and the drone found <b class="machine">${totalDrone}</b>`
      + `${played.length === plots.length ? `. You found <b>${v.you}</b>` : ""}.`;
  }
  score();

  let started = false;
  var api = {
    // the story's example circle: down into it, then what the drone found there (exampleDrone), then the crew's
    // young shrubs around it (exampleCrew)
    example() {
      active = false;
      tools.classList.remove("on");
      G.focusPlot(example.cid); G.view("plot", example.cid, 2600);
      G.setMarks({});
    },
    exampleDrone() { G.setMarks({ young: example.young, drone: example.youngFound, crew: false, pop: "drone" }); },
    exampleCrew() { G.setMarks({ young: example.young, drone: example.youngFound, pop: "young" }); },
    show() {
      active = true;
      tools.classList.add("on");
      if (!started) { started = true; load(); }
      else if (finished) overview(1200, 300);
      else if (!finished) {
        const p = plots[i];
        G.focusPlot(p.cid); G.view("plot", p.cid, 1800); render();
        if (!revealed && (p.shown || i === 0)) setTimeout(() => active && !revealed && plots[i] === p && showOne(p), 1900);
      }
    },
    hide() { active = false; tools.classList.remove("on"); G.focusPlot(null); G.setMarks({}); G.point(null); G.tally(null); },
    results() {
      const played = plots.filter((p) => p.done && !p.skipped);
      return { circles: played.length, you: played.reduce((s, p) => s + p.found, 0), drone: played.reduce((s, p) => s + p.youngFound.length, 0), crew: played.reduce((s, p) => s + p.young.length, 0) };
    },
    stats: { crewPerHa, dronePerHa, plots, example, empty, totalYoung, totalDrone },
    get progress() { return { taps: taps.length, revealed, finished, circle: i }; },
    // set while the game is played in AR; the first circle's instruction follows it
    set marking(v) { api._marking = v; if (started && i === 0 && !revealed && !finished) stat.innerHTML = firstLine(); },
    get marking() { return !!api._marking; },
    guess: null,        // { cid, v }: how many you thought you could find in that circle (asked in the AR opening)
    onLoad: null,       // ({ i: which circle, last }) => …
    onCheck: null,      // ({ k: circles checked so far, n: crew's young shrubs, f: you found, d: drone found, m: yours to find, say: the reply's narration line, or null }) => …
    cue: null,          // () => Promise: the narrator reaching "Look here", when the first shrub is pointed out
    onFinish: null,
  };
  return api;
}
