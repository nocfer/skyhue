import { clamp } from "./score.js";

/**
 * Score-driven sunset backdrop. The sky is built from the app's own dark ground
 * and warms as it descends toward the horizon — no blue/violet cap (a deliberate
 * "black → warm" choice, not a literal sky). Two things move with the score:
 *  - the warm band RISES: a poor sky is near-black with a thin ember at the
 *    horizon; a great one floods warm colour upward and saturates it;
 *  - the hues stay in a tight warm arc (near-black → red → orange → gold), so
 *    the ramp never crosses through magenta (the old muddy/violet artefact).
 *
 * @param {Object} f    score factors (drama, lowBlock, overcast, aerosolEnhance)
 * @param {number} score 0..100
 * @returns {Array<{h:number, s:number, l:number, p:number}>} 4 stops, top→bottom
 */
export function skyGradient(f, score) {
  const block = Math.max(f.lowBlock ?? 0, f.overcast ?? 0);
  const vivid = clamp(
    (score / 100) * (0.6 + 0.4 * (f.drama ?? 0)) + 0.15 * (f.aerosolEnhance ?? 0),
    0,
    1,
  );
  // A blocked horizon (low cloud / overcast) suppresses the warmth: the band
  // stays thin and dim, so a bad sky reads as near-black — clean, never muddy.
  const v = clamp(vivid * (1 - 0.55 * block), 0, 1);

  // Positions where the warm band begins: low score keeps the near-black high
  // and the colour a sliver at the bottom; high score lifts it up the frame.
  const redPos = Math.round(44 + 38 * (1 - v)); // 44%..82%
  const orgPos = Math.round(72 + 20 * (1 - v)); // 72%..92%

  return [
    // Warm near-black apex — same hue family as the band so the black→red ramp
    // never passes through magenta. Matches --bg in darkness; the hero melt
    // hides the tiny hue offset.
    { h: 10, s: 32, l: 6, p: 0 },
    {
      h: Math.round(12 - 9 * v),
      s: Math.round(46 + 18 * v),
      l: Math.round(40 + 5 * v),
      p: redPos,
    },
    {
      h: Math.round(24 - 4 * v),
      s: Math.round(60 + 18 * v),
      l: Math.round(48 + 5 * v),
      p: orgPos,
    },
    {
      h: Math.round(44 - 2 * v),
      s: Math.round(58 + 22 * v),
      l: Math.round(59 + 3 * v),
      p: 100,
    },
  ];
}

export function skyGradientCss(stops) {
  const parts = stops.map((s, i) => {
    const pos = s.p != null ? s.p : Math.round((i / (stops.length - 1)) * 100);
    return `hsl(${s.h} ${s.s}% ${s.l}%) ${pos}%`;
  });
  return `linear-gradient(180deg, ${parts.join(", ")})`;
}
