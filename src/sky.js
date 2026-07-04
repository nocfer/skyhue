// sky.js — genera la palette attesa del cielo dai fattori del punteggio.
// Funzione pura e testabile: mappa condizioni → colori (stop HSL).
import { clamp } from './score.js';

/**
 * Calcola gli stop di colore (dall'alto verso l'orizzonte) del cielo previsto.
 * Più il punteggio e la "drammaticità" sono alti, più i colori sono saturi e
 * caldi; nuvole basse o cielo coperto smorzano tutto verso il grigio.
 *
 * @param {Object} f fattori restituiti da computeSunsetScore
 * @param {number} score punteggio 0-100
 * @returns {Array<{h:number, s:number, l:number}>} 4 stop dall'alto in basso
 */
export function skyGradient(f, score) {
  const block = Math.max(f.lowBlock ?? 0, f.overcast ?? 0); // 0..1 quanto è "chiuso"
  const vivid = clamp(
    (score / 100) * (0.6 + 0.4 * (f.drama ?? 0)) + 0.15 * (f.aerosolEnhance ?? 0),
    0,
    1
  );

  // Saturazione: crolla se il cielo è bloccato, cresce con la vividezza.
  const sat = (base) => Math.round(base * (1 - 0.75 * block) * (0.5 + 0.5 * vivid));

  return [
    { h: 250, s: sat(55), l: Math.round(22 + 6 * (1 - block)) }, // cielo alto (indaco)
    { h: Math.round(315 - 25 * vivid), s: sat(65), l: Math.round(30 + 10 * vivid) }, // magenta
    { h: 18, s: sat(85), l: Math.round(45 + 8 * vivid) }, // arancio-rosso
    { h: 42, s: sat(90), l: Math.round(55 + 10 * vivid) }, // oro all'orizzonte
  ];
}

/** Converte gli stop in una stringa CSS linear-gradient verticale. */
export function skyGradientCss(stops) {
  const parts = stops.map((s, i) => {
    const pos = Math.round((i / (stops.length - 1)) * 100);
    return `hsl(${s.h} ${s.s}% ${s.l}%) ${pos}%`;
  });
  return `linear-gradient(180deg, ${parts.join(', ')})`;
}
