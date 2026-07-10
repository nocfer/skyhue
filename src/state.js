// Shared app state and DOM handles.
//
// `state` is a single mutable object mutated in place across the app (the
// controller in main.js drives the data pipeline; the view/share/favorites/
// suggest modules read it). `els` caches the top-level DOM handles; it reads
// the DOM at import time, which is safe because the entry module is loaded from
// a `<script type="module">` at the end of <body> (elements already exist).

export const els = {
  form: document.getElementById("search-form"),
  input: /** @type {HTMLInputElement} */ (
    document.getElementById("search-input")
  ),
  suggest: document.getElementById("search-suggest"),
  geoBtn: document.getElementById("geo-btn"),
  results: document.getElementById("results"),
  status: document.getElementById("status"),
  favorites: document.getElementById("favorites"),
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
