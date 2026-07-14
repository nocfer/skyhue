// Shared app state, the reactive store around it, and DOM handles.
//
// `state` is a single mutable object. Readers (view/share/favorites/suggest)
// import it and read fields directly; writers go through `update(patch)` so a
// redraw is a consequence of the write, never a separate call to remember (see
// the store section below). `els` caches the top-level DOM handles; it reads
// the DOM at import time, which is safe because the entry module is loaded from
// a `<script type="module">` at the end of <body> (elements already exist).
// The `typeof document` guard lets this module import cleanly under Node (for
// the store unit tests), where `document` is absent and every handle is null.

const $ = (/** @type {string} */ id) =>
  typeof document === "undefined" ? null : document.getElementById(id);

export const els = {
  form: $("search-form"),
  input: /** @type {HTMLInputElement} */ ($("search-input")),
  suggest: $("search-suggest"),
  clearBtn: $("clear-btn"),
  geoBtn: $("geo-btn"),
  results: $("results"),
  status: $("status"),
  favorites: $("favorites"),
};

export const state = {
  place: null,
  forecast: null,
  air: null, // air-quality data (may stay null if the fetch fails)
  dayIndex: 0,
  event: "sunset",
  spots: null,
  spotsError: false,
  rawSpots: null,
  rawSpotsFor: null,
  estimatedSpots: null,
  estimating: false,
  estimateError: false,
  lightPath: null,
};

export const SPOTS_EVALUATE = 14;
export const SPOTS_SHOW = 6;
export const SPOTS_SKY = 3;
export const NEAR_KM = 6;

// --- Reactive store -------------------------------------------------------
// The store wraps `state` (it does not hide it): reads stay direct, writes go
// through `update`. `update(patch)` merges the patch and notifies every
// subscriber, so "did I forget to redraw?" is structurally impossible — the
// redraw follows the write. A bare `update()` (no patch) notifies without
// changing a field: used when a value nested inside `state` was mutated in
// place (e.g. a spot's freshly-computed `skyScore`) and the view just needs to
// redraw. `render` is the sole subscriber, wired once in main.js. Note that
// the render functions themselves (`showHome`/`showResults`) write `state`
// directly rather than through `update`, because they run *inside* the notify
// cycle and going through `update` would recurse.

/** @type {Array<() => void>} */
const listeners = [];

/**
 * Merge `patch` into `state` (if given) and notify every subscriber.
 * @param {Partial<typeof state>} [patch]
 */
export function update(patch) {
  if (patch) Object.assign(state, patch);
  for (const fn of listeners.slice()) fn();
}

/**
 * Register a reaction to state changes; returns an unsubscribe function.
 * @param {() => void} fn
 */
export function subscribe(fn) {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i !== -1) listeners.splice(i, 1);
  };
}
