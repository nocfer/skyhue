// ui.js — primitive di presentazione (§2 del COHERENCE_SPEC).
//
// Helper PURI che restituiscono stringhe HTML: nessun accesso al DOM, nessuno
// stato, nessuna i18n. Chi chiama passa già i testi localizzati e i numeri.
// Sono l'unica sorgente di markup per gli elementi che si ripetono variando coi
// dati (numerali punteggio, swatch, stat-cell, header di sezione, chip, card,
// bottoni). Le classi che usano vivono in styles.css e referenziano solo token.
//
// Regola: ogni numerale-punteggio passa da scoreNumeral(); ogni swatch da
// skySwatch(); ogni cella statistica da statCell(); ogni titolo di sezione da
// sectionHeader(). Così nessuna schermata può ridisegnarne una versione a mano.

import { icon } from './icons.js';

/** Tinta del punteggio: rampa calda monocromatica (rosso-brace → oro), niente
 *  verde. Condivisa da tutti i numerali e dai marker mappa. */
export function scoreHue(score) {
  return Math.round(10 + (Math.max(0, Math.min(100, score)) / 100) * 36);
}

/**
 * Numerale di punteggio (§2.5 ScoreNumeral): SEMPRE font display, colorato per
 * la rampa `--hue` (o `color` fisso per i numerali su imagery, es. share card).
 * @param {number|string} value
 * @param {{size?:'xl'|'l'|'m'|'s'|'xs', score?:number, color?:string,
 *          title?:string, cls?:string}} [o]
 */
export function scoreNumeral(value, { size = 'm', score, color, title, cls = '' } = {}) {
  const styles = [];
  if (score != null) styles.push(`--hue:${scoreHue(score)}`);
  if (color) styles.push(`color:${color}`);
  const style = styles.length ? ` style="${styles.join(';')}"` : '';
  const t = title ? ` title="${title}"` : '';
  return `<span class="score score--${size}${cls ? ' ' + cls : ''}"${style}${t}>${value}</span>`;
}

/**
 * Swatch del cielo (§2.11 SkySwatch): tessera col gradiente-firma `--sky-swatch`
 * e un puntino-sole opzionale. Usata da thumbnail, place card, righe confronto.
 * @param {{size?:'sm'|'md'|'lg', sun?:boolean, tag?:string, cls?:string}} [o]
 */
export function skySwatch({ size = 'md', sun = true, tag = '', cls = '' } = {}) {
  return `<span class="swatch swatch--${size}${cls ? ' ' + cls : ''}">${
    sun ? '<span class="swatch__sun"></span>' : ''
  }${tag ? `<span class="swatch__tag mono">${tag}</span>` : ''}</span>`;
}

/**
 * Cella statistica (§2.9 StatCell): icona + etichetta + valore display + nota.
 * Un'unica primitiva per "Conditions" (1b) e "Atmosphere" (3d).
 * @param {{icon?:string, label:string, value:string, note?:string,
 *          noteAccent?:boolean}} o
 */
export function statCell({ icon: name, label, value, note = '', noteAccent = false }) {
  return `<div class="stat">${name ? icon(name, { size: 15, cls: 'stat__ico' }) : ''}<span class="stat__k">${label}</span><strong class="stat__v">${value}</strong>${
    note ? `<span class="stat__d${noteAccent ? ' stat__d--accent' : ''}">${note}</span>` : ''
  }</div>`;
}

/**
 * Header di sezione (§2.3 SectionHeader). Variante display (default) o mono
 * (sotto-titolo tipo "ATMOSPHERE"). `aside` è un contenuto opzionale a destra.
 * @param {string} title
 * @param {{variant?:'display'|'mono', aside?:string, sub?:boolean}} [o]
 */
export function sectionHeader(title, { variant = 'display', aside = '', sub = false } = {}) {
  const headCls = `sect__head${sub ? ' sect__head--sub' : ''}`;
  if (variant === 'mono') {
    return `<div class="${headCls}"><h3 class="sect__title sect__title--mono mono">${title}</h3>${aside}</div>`;
  }
  return `<div class="${headCls}"><h2 class="sect__title display">${title}</h2>${aside}</div>`;
}

/**
 * Chip (§2.6). Variante `sky` (tinta oro + testo punteggio) oppure le light-hour
 * `golden`/`blue`. `label`/`value` sono già localizzati.
 * @param {{label?:string, value?:string, variant?:'sky'|'golden'|'blue',
 *          score?:number, cls?:string}} o
 */
export function chip({ label = '', value = '', variant = 'golden', score, title = '', cls = '' }) {
  if (variant === 'sky') {
    const style = score != null ? ` style="--hue:${scoreHue(score)}"` : '';
    const t = title ? ` title="${title}"` : '';
    return `<span class="chip chip--sky"${style}${t}>${value || label}</span>`;
  }
  return `<div class="chip chip--${variant}${cls ? ' ' + cls : ''}">${
    label ? `<span class="chip__k">${label}</span>` : ''
  }${value ? `<strong>${value}</strong>` : ''}</div>`;
}

/**
 * Card (§2.4): guscio contenitore. Varianti feature/quiet/row + sentiment.
 * @param {string} inner
 * @param {{variant?:'feature'|'quiet'|'row', sentiment?:'good'|'neutral'|'bad',
 *          cls?:string, tag?:string, attrs?:string}} [o]
 */
export function card(inner, { variant, sentiment, cls = '', tag = 'div', attrs = '' } = {}) {
  const classes = ['card'];
  if (variant) classes.push(`card--${variant}`);
  if (sentiment) classes.push(`card--sentiment card--${sentiment}`);
  if (cls) classes.push(cls);
  return `<${tag} class="${classes.join(' ')}"${attrs ? ' ' + attrs : ''}>${inner}</${tag}>`;
}

/**
 * Bottone (§2.7): primary (fill accent) / outline / ghost. `icon` è un nome di
 * icona opzionale. Restituisce un <button> (usa `href` per un <a> .btn).
 * @param {string} label
 * @param {{variant?:'primary'|'outline'|'ghost', icon?:string, iconSize?:number,
 *          id?:string, type?:string, href?:string, cls?:string, attrs?:string}} [o]
 */
export function button(label, o = {}) {
  const {
    variant = 'primary',
    icon: name,
    iconSize = 16,
    id,
    type = 'button',
    href,
    cls = '',
    attrs = '',
  } = o;
  const classes = `btn btn--${variant}${cls ? ' ' + cls : ''}`;
  const inner = `${name ? icon(name, { size: iconSize }) + ' ' : ''}${label}`;
  const idAttr = id ? ` id="${id}"` : '';
  if (href != null) return `<a class="${classes}" href="${href}"${idAttr}${attrs ? ' ' + attrs : ''}>${inner}</a>`;
  return `<button class="${classes}" type="${type}"${idAttr}${attrs ? ' ' + attrs : ''}>${inner}</button>`;
}
