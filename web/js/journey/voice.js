// The narrator: one short spoken line for each step of the story, played when that step reaches the middle of
// the screen. This is the page's only sound. The clips live in voice/ (voice.json lists them; pipeline/40_voice.py
// makes them). If there is no voice.json yet, the page simply has no narration.
//
// A line that finishes is not repeated when you scroll back; one you scroll away from fades out, and plays
// again from the start if you return. Turning the narrator off stops it at once.
// Replies (to a guess, to each circle of the game) are queued behind the line being spoken; game lines can
// repeat, and a new circle cuts off whatever is left of the last one.

export async function initVoice() {
  let manifest = null;
  try {
    const r = await fetch("voice/voice.json", { cache: "no-cache" });
    if (r.ok) manifest = await r.json();
  } catch {}
  const clips = manifest?.clips || {};
  const done = new Set();
  // one audio element for every line: phones (iOS Safari) only let an element play on its own once a tap has
  // started it, so the tap on "Begin" unlocks it and every later line reuses it
  const el = new Audio();
  el.preload = "auto";
  let on = false, curKey = null, scene = null, queue = [], fading = 0, unlocked = false;

  // the fade runs on timers, not animation frames: those can stop while an AR session runs
  function stop(then) {
    clearTimeout(fading);
    if (!curKey || el.paused) { el.pause(); curKey = null; then?.(); return; }
    curKey = null;
    const v0 = el.volume, t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 250);
      try { el.volume = v0 * (1 - k); } catch {}
      if (k < 1) fading = setTimeout(step, 16); else { el.pause(); then?.(); }
    };
    fading = setTimeout(step, 16);
  }
  function play(key, again = false) {
    if (!on || !clips[key] || curKey === key || (done.has(key) && !again)) return;
    stop(() => {
      if (!on) return;
      curKey = key;
      el.src = `voice/${clips[key].file}`;
      try { el.volume = 1; } catch {}
      api.onplay?.(key);
      el.play().catch((e) => { api.onfail?.(key, e); curKey = null; advance(); });
    });
  }
  el.onended = () => {
    const key = curKey;
    curKey = null;
    if (!key) return;
    done.add(key);
    api.onend?.(key);
    advance();
  };
  function advance() {
    while (queue.length) {
      const q = queue.shift();
      if (clips[q.key] && (q.again || !done.has(q.key))) { play(q.key, q.again); return; }
    }
  }

  const api = {
    available: Object.keys(clips).length > 0,
    synthetic: manifest?.synthetic !== false,
    voice: manifest?.voice || "",
    get on() { return on; },
    get playing() { return curKey; },
    has: (key) => !!clips[key],
    file: (key) => clips[key]?.file,
    enable(v) {
      on = v && api.available;
      try { localStorage.setItem("voice", on ? "1" : "0"); } catch {}
      if (on && !unlocked) {                  // called from a tap: unlock the element with a silent start
        unlocked = true;
        el.src = `voice/${Object.values(clips)[0].file}`; el.muted = true;
        el.play().then(() => { el.pause(); el.muted = false; if (scene) play(scene); }).catch(() => { el.muted = false; });
        return;
      }
      if (!on) stop();
      else if (scene) play(scene);
    },
    wanted() { try { return localStorage.getItem("voice") === "1"; } catch { return false; } },
    // a new step is in the middle of the screen: say its line (and stop the last one)
    scene(name) {
      if (name === scene) return;
      scene = name;
      queue = [];
      if (!on) return;
      if (clips[name] && !done.has(name)) play(name);
      else if (curKey && curKey !== name) stop();
    },
    // lines that belong to a moment rather than a step (a reply to a guess, a circle of the game): they wait for
    // the line being spoken, unless `cut` is set; `again` lets a line be said more than once
    say(keys, { again = false, cut = false } = {}) {
      if (!on) return;
      const list = (Array.isArray(keys) ? keys : [keys]).map((key) => ({ key, again }));
      if (cut) { queue = list; if (curKey) stop(advance); else advance(); return; }
      queue.push(...list);
      if (!curKey) advance();
    },
    // resolves (true) when the line `key` reaches its mark, the moment a word starts (see 40_voice.py); at once
    // (false) if that line is not about to be spoken, so the picture goes ahead on its own timing
    cue(key, mark) {
      const at = clips[key]?.marks?.[mark];
      return new Promise((res) => {
        if (!on || at == null || (done.has(key) && curKey !== key)) return res(false);
        const t0 = performance.now();
        const check = () => {
          if (curKey === key && !el.paused && el.currentTime >= at) return res(true);
          if (curKey !== key && (scene !== key || done.has(key) || performance.now() - t0 > 3000)) return res(false);
          requestAnimationFrame(check);
        };
        check();
      });
    },
    onend: null,
    onplay: null,
    onfail: null,
  };
  return api;
}
