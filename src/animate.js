// SkyHue — scroll-reveal animations (ADDITIVE)
// ---------------------------------------------------------------------------
// This module touches no existing module. It observes the results screen
// (#results), and after every render() it:
//   • plays a hero entrance (sky settle, sun rise + pulse, headline + eyebrow
//     reveal, score count-up, 0→N meter fill) once per newly-shown result;
//   • reveals each section in TWO tiers as it scrolls into view (see below),
//     with tailored flourishes: week-ribbon dot pops, "how it adds up" bar
//     growth, the sunset-arc line drawing itself, the compass needle sweep,
//     predicted-colour swatch stagger, and stat/driver/spot card stagger.
//
// TWO-TIER REVEAL (why the timing is split):
//   The reveal both signals "there's more below" AND rewards arrival, and those
//   want opposite trigger positions. So each section reveals in two beats:
//     • CUE (Tier 1): the section CONTAINER does a soft fade+drift, fired EARLY
//       — as the section crests the fold (CUE_LINE ≈ 92% of viewport). It fires
//       before the gaze arrives ON PURPOSE: it is the cheap "keep scrolling"
//       pull, and nothing important is lost if it is under-attended.
//     • PAYLOAD (Tier 2): everything INSIDE the container (the flourishes) is
//       held until the section has climbed into the attention zone
//       (PAY_LINE ≈ 65%), then performed. These are the money shots, gated
//       behind attention.
//   Classification is automatic: DOM nesting IS the split — the container is the
//   cue, its descendants are the payload. See fireCue / firePayload.
//
//   Flash-free priming: when the cue fires we BUILD every payload animation but
//   leave it PAUSED (fill:both holds keyframe 0 → the element is primed to its
//   hidden/zeroed state using the very keyframes it will later animate). When
//   the payload line is crossed we .play() them. One source of truth, no
//   separate "initial state" table to drift out of sync.
//
// prefers-reduced-motion: reduce  → everything is shown instantly, no motion.
//
// This is a presentation-only layer, so it deliberately couples to the results
// DOM's class names (`.rhero`, `.sect`, `.addsup__seg`, `.arc__line`,
// `.wk__dot`, `.compass__ray`, `.trendsw`, …). Those names are load-bearing
// here — renaming them in the views without updating this file silently drops
// a flourish.
// ---------------------------------------------------------------------------

// Two trigger lines, as a fraction of viewport height from the top.
const CUE_LINE = 0.92; // section top crests here → Tier-1 cue (frame drifts in)
const PAY_LINE = 0.65; // section top reaches here → Tier-2 payload (flourishes)
const CUE_DUR = 700; // soft frame fade+drift; longer so it lives as it climbs
// On the FIRST paint, below-hero sections already in view hold until the hero
// headline lands (~1.3s), then cascade cue→payload — so the eye finishes the
// hero, then is drawn downward. CUE_LEAD is the extra beat that keeps the frame
// leading its own payload in that held cascade (during scroll the two are
// already separated by CUE_LINE→PAY_LINE travel, so no lead is added).
const HERO_HOLD = 1300;
const CUE_LEAD = 220;

const EASE = "cubic-bezier(0.2,0.7,0.2,1)";
const reduce = () => {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

// When `sink` is a non-null array (set only while buildPayload runs), every
// animation created here is collected into it so the caller can pause the whole
// payload up front and play it on the payload trigger. Null everywhere else, so
// the hero entrance and pulses are unaffected.
let sink = null;
function anim(el, kf, opt) {
  if (!el?.animate) return null;
  try {
    const a = el.animate(
      kf,
      Object.assign({ easing: EASE, fill: "both" }, opt),
    );
    if (sink) sink.push(a);
    return a;
  } catch {
    return null;
  }
}
const revealKf = (y = 22) => [
  { opacity: 0, transform: `translateY(${y}px)` },
  { opacity: 1, transform: "translateY(0)" },
];

// Count a numeric text node up from 0 to its final value.
const ctTokens = new WeakMap();
function countUp(el, dur = 1400, delay = 0) {
  if (!el) return;
  const to = parseInt(el.textContent, 10);
  if (!Number.isFinite(to)) return;
  const token = {};
  ctTokens.set(el, token);
  el.textContent = "0";
  const start = performance.now() + delay;
  const ease = (t) => 1 - (1 - t) ** 3;
  const step = (now) => {
    if (ctTokens.get(el) !== token) return;
    const p = Math.max(0, Math.min(1, (now - start) / dur));
    el.textContent = Math.round(ease(p) * to);
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = to;
  };
  requestAnimationFrame(step);
}

let pulses = [];
function stopPulses() {
  pulses.forEach((a) => {
    try {
      a.cancel();
    } catch {}
  });
  pulses = [];
}
function pulse(el, mag = 1.12) {
  const a = anim(
    el,
    [
      { transform: "scale(1)", opacity: 0.9 },
      { transform: `scale(${mag})`, opacity: 1 },
      { transform: "scale(1)", opacity: 0.9 },
    ],
    {
      duration: 2800,
      iterations: Infinity,
      easing: "ease-in-out",
      fill: "none",
    },
  );
  if (a) pulses.push(a);
}

// --------------------------- per-render state ------------------------------
let ioCue = null; // fires the Tier-1 cue as a section crests CUE_LINE
let ioPay = null; // fires the Tier-2 payload as a section reaches PAY_LINE
let sweepRaf = null; // coalesced safety-sweep handle
let onScroll = null;
let cued = new WeakSet(); // sections whose cue has fired
let paid = new WeakSet(); // sections whose payload has fired
let payloadAnims = new WeakMap(); // section → its paused payload animations
let liveAnims = []; // every section anim (cue + payload) of the current pass
let gen = 0; // bumped each pass; invalidates deferred plays from an old pass
let secs = []; // current result's reveal targets
let lastKey = "";
let heroAt = 0; // performance.now() by which the hero headline has landed

// How long a just-triggered reveal must wait for the hero entrance to finish.
// Zero once the hero has landed, so only the first-paint sections are held.
const heroWait = () => Math.max(0, heroAt - performance.now());

// Tier 1 — reveal the section CONTAINER (soft fade+drift), and prime its
// payload: build every flourish animation now but leave it paused, so the
// contents are held at keyframe 0 (hidden/zeroed) the instant the frame appears.
function fireCue(el) {
  if (cued.has(el)) return;
  cued.add(el);
  if (ioCue) ioCue.unobserve(el);
  const cue = anim(
    el,
    [
      { opacity: 0, transform: "translateY(20px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    { delay: heroWait(), duration: CUE_DUR },
  );
  if (cue) liveAnims.push(cue);
  buildPayload(el);
}

// Tier 2 — play the (already built + primed) payload. If the payload line was
// crossed before the cue line (a jump-to-bottom), build it here first.
function firePayload(el) {
  if (paid.has(el)) return;
  paid.add(el);
  if (ioPay) ioPay.unobserve(el);
  if (!payloadAnims.has(el)) fireCue(el);
  const list = payloadAnims.get(el) || [];
  // Capture the pass: a deferred play must not revive animations that a newer
  // render has since torn down and cancelled (play() on a cancelled anim would
  // restart it).
  const myGen = gen;
  const play = () => {
    if (myGen !== gen) return;
    list.forEach((a) => {
      try {
        a.play();
      } catch {}
    });
  };
  // A held cascade (first paint) leads the payload behind the frame by CUE_LEAD;
  // during scroll the two tiers are already separated by their trigger lines.
  const w = heroWait();
  const wait = w > 0 ? w + CUE_LEAD : 0;
  if (wait > 0) setTimeout(play, wait);
  else play();
}

// Build the payload animations for a section, paused. Idempotent per section.
function buildPayload(el) {
  if (payloadAnims.has(el)) return;
  const list = [];
  sink = list;
  try {
    paintFlourishes(el);
  } catch {
    /* keep going */
  } finally {
    sink = null;
  }
  list.forEach((a) => {
    try {
      a.pause();
    } catch {}
  });
  payloadAnims.set(el, list);
  liveAnims.push(...list);
}

// Safety net: drive both tiers for anything already past its line so a fast
// flick / jump-to-bottom never leaves a section stuck. Coalesced to one/frame.
function sweep() {
  sweepRaf = null;
  const results = document.getElementById("results");
  if (!results || results.hasAttribute("hidden")) return;
  const cueLine = innerHeight * CUE_LINE;
  const payLine = innerHeight * PAY_LINE;
  const atEnd =
    innerHeight + scrollY >= document.documentElement.scrollHeight - 4;
  secs.forEach((el) => {
    const top = el.getBoundingClientRect().top;
    try {
      if (top < cueLine) fireCue(el);
      if (atEnd || top < payLine) firePayload(el);
    } catch {}
  });
}

// ----------------------------- reveal flourishes ---------------------------
function stagger(els, base = 160, gap = 90) {
  els.forEach((c, i) => {
    anim(c, revealKf(18), { delay: base + i * gap, duration: 560 });
  });
}

// The Tier-2 payload: every flourish INSIDE a section container. Called only
// via buildPayload (with `sink` set), so each anim() here is collected, paused,
// and later played on the payload trigger. The container's own reveal is the
// Tier-1 cue (fireCue) and is deliberately NOT animated here.
function paintFlourishes(el) {
  try {
    // Card grids: reveal children in sequence.
    const grid = el.querySelector(".statgrid, .drivers, .spots");
    if (grid) stagger([...grid.children]);

    if (el.querySelector(".wk")) {
      [...el.querySelectorAll(".wk__col")].forEach((col, i) => {
        anim(col, revealKf(14), { delay: 120 + i * 70, duration: 520 });
        const dot = col.querySelector(".wk__dot");
        anim(
          dot,
          [
            { transform: "scale(0)" },
            { transform: "scale(1.35)" },
            { transform: "scale(1)" },
          ],
          {
            delay: 260 + i * 70,
            duration: 520,
            easing: "cubic-bezier(.34,1.56,.64,1)",
          },
        );
      });
    }
    const seg = el.querySelectorAll(".addsup__seg");
    seg.forEach((s, i) => {
      const w = s.style.width || getComputedStyle(s).width;
      anim(s, [{ width: "0px" }, { width: w }], {
        delay: 180 + i * 130,
        duration: 640,
      });
    });
    const line = el.querySelector(".arc__line");
    if (line) {
      let len = 320;
      try {
        len = line.getTotalLength();
      } catch {}
      line.style.strokeDasharray = len;
      line.style.strokeDashoffset = len;
      anim(line, [{ strokeDashoffset: len }, { strokeDashoffset: 0 }], {
        duration: 1200,
        easing: "ease-in-out",
      });
      const area = el.querySelector(
        ".arc [fill^='url'], .arc path[fill^='url']",
      );
      if (area)
        anim(area, [{ opacity: 0 }, { opacity: 1 }], {
          delay: 700,
          duration: 700,
        });
      el.querySelectorAll(".arc__dot").forEach((dt, i) => {
        anim(
          dt,
          [
            { opacity: 0, transform: "scale(0)" },
            { opacity: 1, transform: "scale(1)" },
          ],
          {
            delay: 900 + i * 80,
            duration: 360,
            easing: "cubic-bezier(.34,1.56,.64,1)",
          },
        );
      });
    }
    const sw = [...el.querySelectorAll(".trendsw")];
    if (sw.length)
      sw.forEach((s, i) => {
        anim(
          s,
          [
            { opacity: 0, transform: "scaleY(.2)", transformOrigin: "bottom" },
            { opacity: 1, transform: "scaleY(1)" },
          ],
          { delay: 400 + i * 70, duration: 480 },
        );
      });

    const ray = el.querySelector(".compass__ray");
    const sun = el.querySelector(".compass__sun");
    if (ray) {
      let l = 60;
      try {
        l = ray.getTotalLength();
      } catch {}
      ray.style.strokeDasharray = l;
      ray.style.strokeDashoffset = l;
      anim(ray, [{ strokeDashoffset: l }, { strokeDashoffset: 0 }], {
        duration: 700,
        easing: "ease-out",
      });
    }
    if (sun)
      anim(
        sun,
        [
          { opacity: 0, transform: "scale(0)" },
          { opacity: 1, transform: "scale(1)" },
        ],
        { delay: 600, duration: 420, easing: "cubic-bezier(.34,1.56,.64,1)" },
      );
  } catch {
    /* keep going */
  }
}

// ------------------------------- hero entrance -----------------------------
function heroEntrance(results) {
  stopPulses();
  const q = (s) => results.querySelector(s);
  anim(
    q(".rhero__sky"),
    [
      { transform: "scale(1.1)", filter: "brightness(.6) saturate(1.25)" },
      { transform: "scale(1)", filter: "brightness(1) saturate(1)" },
    ],
    { duration: 1600 },
  );
  const sun = q(".rhero__sun");
  const a = anim(
    sun,
    [
      { opacity: 0, transform: "translateY(90px) scale(.5)" },
      { opacity: 1, transform: "translateY(0) scale(1)" },
    ],
    { duration: 1300, delay: 120 },
  );
  if (a) a.onfinish = () => pulse(sun);
  anim(q(".rhero__eyebrow"), revealKf(), { delay: 360, duration: 600 });
  const hl = q(".verdict__headline");
  if (hl)
    anim(
      hl,
      [
        {
          opacity: 0,
          transform: "translateY(26px)",
          clipPath: "inset(0 0 100% 0)",
        },
        { opacity: 1, transform: "translateY(0)", clipPath: "inset(0 0 0 0)" },
      ],
      { delay: 440, duration: 900 },
    );
  const score = q(".rhero__score .score");
  if (score) countUp(score, 1500, 560);
  const meter = q(".rhero__meterfill");
  if (meter) {
    const w = meter.style.width || getComputedStyle(meter).width;
    anim(meter, [{ width: "0%" }, { width: w }], {
      delay: 560,
      duration: 1500,
    });
  }
}

// ------------------------------- orchestration -----------------------------
function teardown() {
  // Start a new generation and cancel the previous pass's section animations,
  // so a superseded render (partial → full data) can't leave orphaned paused
  // animations behind — which could win the compositing race and pin a section
  // (e.g. the week ribbon) hidden.
  gen++;
  liveAnims.forEach((a) => {
    try {
      a.cancel();
    } catch {}
  });
  liveAnims = [];
  if (ioCue) {
    ioCue.disconnect();
    ioCue = null;
  }
  if (ioPay) {
    ioPay.disconnect();
    ioPay = null;
  }
  if (sweepRaf) {
    cancelAnimationFrame(sweepRaf);
    sweepRaf = null;
  }
  if (onScroll) {
    window.removeEventListener("scroll", onScroll);
    onScroll = null;
  }
}

function setup() {
  const results = document.getElementById("results");
  if (!results || results.hasAttribute("hidden")) return;
  const content = results.querySelector(".rcontent");
  const secList = content
    ? [
        ...content.querySelectorAll(
          ".rintro, .modes, .sect, .rfoot, .topbanner",
        ),
      ]
    : [];
  if (!secList.length && !results.querySelector(".rhero")) return;

  // Signature identifying the current result. It must be built ONLY from DOM
  // that is both (a) untouched by our own animations and (b) invariant to the
  // score. A single search fires a CASCADE of re-renders as background data
  // arrives (forecast → light-path loading → spots → light-path ready), and the
  // last of those refines the score — which moves the headline verdict, the
  // meter width AND the "top sunset" banner (a section, so secList.length). Any
  // of those in the key makes each background refinement look like a brand-new
  // result: full teardown + re-prime every section to hidden + hero restart,
  // i.e. the screen flickers once per background fetch. So key ONLY on the
  // place label and the eyebrow (when · event · time): both change on a real
  // new search / event / day toggle, neither moves as the score settles. (The
  // count-up also rules out the score numeral: it mutates textContent every
  // frame, which our MutationObserver sees.)
  const loc = (results.querySelector(".rhero__loc")?.textContent || "").trim();
  const eyebrow = (
    results.querySelector(".rhero__eyebrow")?.textContent || ""
  ).trim();
  const key = `${loc}|${eyebrow}`;
  const isNew = key !== lastKey;

  // Same result, spurious re-render (our own count-up mutation, spots loading,
  // etc.): the observers from the first pass are still live and own the reveal
  // state. Tearing down here would re-hide already-revealed sections and restart
  // the hero, so bail out and leave the running pass in charge.
  if (!isNew && ioCue) return;
  lastKey = key;

  teardown();
  cued = new WeakSet();
  paid = new WeakSet();
  payloadAnims = new WeakMap();
  secs = secList;

  if (reduce()) {
    secs.forEach((/** @type {HTMLElement} */ el) => {
      el.style.opacity = "";
      el.style.transform = "";
    });
    return;
  }

  if (isNew) {
    heroEntrance(results);
    // First paint: hold below-hero reveals until the hero headline has landed,
    // then let them cascade. (headline delay 440 + duration 900 ≈ HERO_HOLD.)
    heroAt = performance.now() + HERO_HOLD;
  }

  // Prime the containers hidden; the cue's first keyframe matches this offset so
  // there is no jump when it fires. Contents are primed later, by buildPayload.
  secs.forEach((/** @type {HTMLElement} */ el) => {
    el.style.opacity = "0";
    el.style.transform = "translateY(20px)";
  });

  // Two observers, one per tier. Negative bottom rootMargin shrinks the root so
  // "intersecting" means the section top has crossed the line: 8% inset → the
  // cue at 92%, 35% inset → the payload at 65%. threshold 0 = fire on first px.
  ioCue = new IntersectionObserver(
    (ents) => {
      ents.forEach((en) => {
        if (en.isIntersecting) fireCue(en.target);
      });
    },
    {
      threshold: 0,
      rootMargin: `0px 0px -${Math.round((1 - CUE_LINE) * 100)}% 0px`,
    },
  );
  ioPay = new IntersectionObserver(
    (ents) => {
      ents.forEach((en) => {
        if (en.isIntersecting) firePayload(en.target);
      });
    },
    {
      threshold: 0,
      rootMargin: `0px 0px -${Math.round((1 - PAY_LINE) * 100)}% 0px`,
    },
  );
  secs.forEach((el) => {
    ioCue.observe(el);
    ioPay.observe(el);
  });

  // A coalesced safety sweep on scroll reveals anything already past the trigger
  // line, so a fast flick / jump-to-bottom never leaves a section stuck hidden.
  onScroll = () => {
    if (!sweepRaf) sweepRaf = requestAnimationFrame(sweep);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
}

function boot() {
  const target = document.getElementById("results") || document.body;
  const mo = new MutationObserver(() => requestAnimationFrame(setup));
  mo.observe(target, {
    attributes: true,
    attributeFilter: ["hidden"],
    childList: true,
    subtree: true,
  });
  setup();
}

if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", boot);
else boot();
