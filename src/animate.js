// SkyHue — scroll-reveal animations (ADDITIVE)
// ---------------------------------------------------------------------------
// This module touches no existing module. It observes the results screen
// (#results), and after every render() it:
//   • plays a hero entrance (sky settle, sun rise + pulse, headline + eyebrow
//     reveal, score count-up, 0→N meter fill) once per newly-shown result;
//   • reveals each section as it scrolls into view (IntersectionObserver +
//     a rAF safety sweep so a fast flick / jump-to-bottom never leaves a gap),
//     with tailored flourishes: week-ribbon dot pops, "how it adds up" bar
//     growth, the sunset-arc line drawing itself, the compass needle sweep,
//     predicted-colour swatch stagger, and stat/driver/spot card stagger.
//
// prefers-reduced-motion: reduce  → everything is shown instantly, no motion.
//
// This is a presentation-only layer, so it deliberately couples to the results
// DOM's class names (`.rhero`, `.sect`, `.addsup__seg`, `.arc__line`,
// `.wk__dot`, `.compass__ray`, `.trendsw`, …). Those names are load-bearing
// here — renaming them in the views without updating this file silently drops
// a flourish.
// ---------------------------------------------------------------------------

const EASE = "cubic-bezier(0.2,0.7,0.2,1)";
const reduce = () => {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

function anim(el, kf, opt) {
  if (!el?.animate) return null;
  try {
    return el.animate(kf, Object.assign({ easing: EASE, fill: "both" }, opt));
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
let io = null;
let sweepRaf = null; // coalesced safety-sweep handle
let onScroll = null;
let revealed = new WeakSet();
let secs = []; // current result's reveal targets
let lastKey = "";

// Reveal a section once and stop observing it.
function hit(el) {
  if (revealed.has(el)) return;
  revealed.add(el);
  if (io) io.unobserve(el);
  onReveal(el);
}

// Safety net: reveal anything already past the trigger line so a fast flick /
// jump-to-bottom never leaves a section stuck hidden. Coalesced to one per frame.
function sweep() {
  sweepRaf = null;
  const results = document.getElementById("results");
  if (!results || results.hasAttribute("hidden")) return;
  const trigger = innerHeight * 0.82;
  const atEnd =
    innerHeight + scrollY >= document.documentElement.scrollHeight - 4;
  secs.forEach((el) => {
    if (revealed.has(el)) return;
    if (atEnd || el.getBoundingClientRect().top < trigger) {
      try {
        hit(el);
      } catch {}
    }
  });
}

// ----------------------------- reveal flourishes ---------------------------
function stagger(els, base = 160, gap = 90) {
  els.forEach((c, i) => {
    anim(c, revealKf(18), { delay: base + i * gap, duration: 560 });
  });
}

function onReveal(el) {
  anim(el, revealKf(), { delay: 60, duration: 620 });
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
  if (io) {
    io.disconnect();
    io = null;
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
  // the animations don't touch: the count-up mutates the score numeral's
  // textContent (and that is a childList change our own MutationObserver sees),
  // so keying off it would make every count-up frame look like a brand-new
  // result and restart the hero — freezing the numeral at 0. The meter fill's
  // inline width is set by the app and animated via WAAPI (which doesn't
  // rewrite inline style), so it stays stable and is safe to key on.
  const meterfill = /** @type {HTMLElement} */ (
    results.querySelector(".rhero__meterfill")
  );
  const key =
    (results.querySelector(".verdict__headline")?.textContent || "") +
    "|" +
    (meterfill?.style.width || "") +
    "|" +
    secList.length;
  const isNew = key !== lastKey;

  // Same result, spurious re-render (our own count-up mutation, spots loading,
  // etc.): the observers from the first pass are still live and own the reveal
  // state. Tearing down here would re-hide already-revealed sections and restart
  // the hero, so bail out and leave the running pass in charge.
  if (!isNew && io) return;
  lastKey = key;

  teardown();
  revealed = new WeakSet();
  secs = secList;

  if (reduce()) {
    secs.forEach((/** @type {HTMLElement} */ el) => {
      el.style.opacity = "";
      el.style.transform = "";
    });
    return;
  }

  if (isNew) heroEntrance(results);

  secs.forEach((/** @type {HTMLElement} */ el) => {
    el.style.opacity = "0";
    el.style.transform = "translateY(24px)";
  });

  io = new IntersectionObserver(
    (ents) => {
      ents.forEach((en) => {
        if (en.isIntersecting) hit(en.target);
      });
    },
    { threshold: 0.1, rootMargin: "0px 0px -18% 0px" },
  );
  secs.forEach((el) => {
    io.observe(el);
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
