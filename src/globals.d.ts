// Ambient declarations for the few globals the app stashes on `window` and the
// Leaflet instance loaded from a CDN at runtime. Type-only; no runtime effect.
// Keeps checkJs (jsconfig.json) honest without scattering casts across map.js.

interface Window {
  /** Leaflet, injected by loadLeaflet() in map.js. Untyped (no local @types). */
  L?: any;
  /** Last analyzed place, shared between main.js and the full-map screen. */
  skyhueLastPlace?: any;
  /** Context handed to the full-map screen (coords, azimuth, score, spots…). */
  skyhueMapContext?: any;
  /** Set by main.js once boot succeeds; read by the self-heal watchdog. */
  __skyhueBooted?: boolean;
}
