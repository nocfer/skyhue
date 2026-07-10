import { icon } from "./icons.js";
export function scoreHue(score) {
  return Math.round(10 + (Math.max(0, Math.min(100, score)) / 100) * 36);
}

/**
 * @param {number|string} value
 * @param {{size?:'xl'|'l'|'m'|'s'|'xs', score?:number, color?:string,
 *          title?:string, cls?:string}} [o]
 */
export function scoreNumeral(
  value,
  { size = "m", score, color, title, cls = "" } = {},
) {
  const styles = [];
  if (score != null) styles.push(`--hue:${scoreHue(score)}`);
  if (color) styles.push(`color:${color}`);
  const style = styles.length ? ` style="${styles.join(";")}"` : "";
  const t = title ? ` title="${title}"` : "";
  return `<span class="score score--${size}${cls ? " " + cls : ""}"${style}${t}>${value}</span>`;
}

/**
 * @param {{size?:'sm'|'md'|'lg', sun?:boolean, tag?:string, grad?:string, cls?:string}} [o]
 */
export function skySwatch({
  size = "md",
  sun = true,
  tag = "",
  grad = "",
  cls = "",
} = {}) {
  const style = grad ? ` style="background:${grad}"` : "";
  return `<span class="swatch swatch--${size}${cls ? " " + cls : ""}"${style}>${
    sun ? '<span class="swatch__sun"></span>' : ""
  }${tag ? `<span class="swatch__tag mono">${tag}</span>` : ""}</span>`;
}

/**
 * @param {{icon?:string, label:string, value:string, note?:string,
 *          noteAccent?:boolean}} o
 */
export function statCell({
  icon: name,
  label,
  value,
  note = "",
  noteAccent = false,
}) {
  return `<div class="stat">${name ? icon(name, { size: 15, cls: "stat__ico" }) : ""}<span class="stat__k">${label}</span><strong class="stat__v">${value}</strong>${
    note
      ? `<span class="stat__d${noteAccent ? " stat__d--accent" : ""}">${note}</span>`
      : ""
  }</div>`;
}

/**
 * @param {string} title
 * @param {{variant?:'display'|'mono', aside?:string, sub?:boolean}} [o]
 */
export function sectionHeader(
  title,
  { variant = "display", aside = "", sub = false } = {},
) {
  const headCls = `sect__head${sub ? " sect__head--sub" : ""}`;
  if (variant === "mono") {
    return `<div class="${headCls}"><h3 class="sect__title sect__title--mono mono">${title}</h3>${aside}</div>`;
  }
  return `<div class="${headCls}"><h2 class="sect__title display">${title}</h2>${aside}</div>`;
}

/**
 * @param {{label?:string, value?:string, variant?:'sky'|'golden'|'blue',
 *          score?:number, title?:string, cls?:string}} o
 */
export function chip({
  label = "",
  value = "",
  variant = "golden",
  score,
  title = "",
  cls = "",
}) {
  if (variant === "sky") {
    const style = score != null ? ` style="--hue:${scoreHue(score)}"` : "";
    const t = title ? ` title="${title}"` : "";
    return `<span class="chip chip--sky"${style}${t}>${value || label}</span>`;
  }
  return `<div class="chip chip--${variant}${cls ? " " + cls : ""}">${
    label ? `<span class="chip__k">${label}</span>` : ""
  }${value ? `<strong>${value}</strong>` : ""}</div>`;
}

/**
 * @param {string} label
 * @param {{variant?:'primary'|'outline'|'ghost', icon?:string, iconSize?:number,
 *          id?:string, type?:string, href?:string, cls?:string, attrs?:string}} [o]
 */
export function button(label, o = {}) {
  const {
    variant = "primary",
    icon: name,
    iconSize = 16,
    id,
    type = "button",
    href,
    cls = "",
    attrs = "",
  } = o;
  const classes = `btn btn--${variant}${cls ? " " + cls : ""}`;
  const inner = `${name ? icon(name, { size: iconSize }) + " " : ""}${label}`;
  const idAttr = id ? ` id="${id}"` : "";
  if (href != null)
    return `<a class="${classes}" href="${href}"${idAttr}${attrs ? " " + attrs : ""}>${inner}</a>`;
  return `<button class="${classes}" type="${type}"${idAttr}${attrs ? " " + attrs : ""}>${inner}</button>`;
}
