import { clamp } from './score.js';

/**
 * @param {Object} f
 * @param {number} score
 * @returns {Array<{h:number, s:number, l:number}>}
 */
export function skyGradient(f, score) {
  const block = Math.max(f.lowBlock ?? 0, f.overcast ?? 0); // 0..1 quanto è "chiuso"
  const vivid = clamp(
    (score / 100) * (0.6 + 0.4 * (f.drama ?? 0)) + 0.15 * (f.aerosolEnhance ?? 0),
    0,
    1
  );

  const sat = (base) => Math.round(base * (1 - 0.75 * block) * (0.5 + 0.5 * vivid));

  return [
    { h: 250, s: sat(55), l: Math.round(22 + 6 * (1 - block)) },
    { h: Math.round(315 - 25 * vivid), s: sat(65), l: Math.round(30 + 10 * vivid) },
    { h: 18, s: sat(85), l: Math.round(45 + 8 * vivid) },
    { h: 42, s: sat(90), l: Math.round(55 + 10 * vivid) }
  ];
}

export function skyGradientCss(stops) {
  const parts = stops.map((s, i) => {
    const pos = Math.round((i / (stops.length - 1)) * 100);
    return `hsl(${s.h} ${s.s}% ${s.l}%) ${pos}%`;
  });
  return `linear-gradient(180deg, ${parts.join(', ')})`;
}
