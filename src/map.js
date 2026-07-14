import {
  fetchForecast,
  fetchAirQuality,
  nextSunset,
  conditionsAtTime,
  airAtTime,
} from "./api.js";
import { computeSunsetScore, scoreLabel } from "./score.js";
import { sunPosition, azimuthToCardinal } from "./astronomy.js";
import {
  destinationPoint,
  SAMPLE_DISTANCES,
  evaluateHorizon,
  spotVerdict,
  fetchElevations,
  nearbySpots,
  kindInfo,
} from "./spots.js";
import { icon } from "./icons.js";
import { scoreNumeral, skySwatch, button, scoreHue } from "./ui.js";
import { t, cardinal, getLang } from "./i18n.js";

const LEAFLET_CSS =
  "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js";

const TILE_DARK =
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILE_OPTS = {
  subdomains: "abcd",
  maxZoom: 20,
  attribution: "© OpenStreetMap © CARTO",
};

function tileUrl() {
  return TILE_DARK;
}

const els = {
  appView: document.getElementById("app-view"),
  mapView: document.getElementById("map-view"),
  canvas: document.getElementById("leaflet"),
  panel: document.getElementById("map-panel"),
  back: document.getElementById("map-back"),
};

let map = null;
let marker = null;
let visCircle = null;
let contextLayer = null;
let tapLayer = null;
let legendControl = null;
let bigTile = null;
let leafletLoading = null;
let evalToken = 0;
let evalAbort = null;
let tapTimer = null;
// A stalled CDN never fires `onerror`, so without a timeout the promise (and any
// `await loadLeaflet()`) would hang forever. Reject after this so callers' catch
// paths run and the map degrades to its "connection required" message.
const LEAFLET_TIMEOUT_MS = 8000;
export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletLoading) return leafletLoading;
  leafletLoading = new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const settle = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(arg);
    };
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = LEAFLET_CSS;
    // A failed stylesheet leaves the map unstyled but usable; warn, don't reject.
    link.onerror = () => console.warn("Leaflet CSS failed to load");
    document.head.appendChild(link);
    const script = document.createElement("script");
    script.src = LEAFLET_JS;
    script.onload = () => settle(resolve, window.L);
    script.onerror = () => settle(reject, new Error("Unable to load map"));
    document.head.appendChild(script);
    timer = setTimeout(
      () => settle(reject, new Error("Map load timed out")),
      LEAFLET_TIMEOUT_MS,
    );
  });
  // Clear the memo on failure so a later call can retry instead of being poisoned
  // forever by a single stalled/failed load.
  leafletLoading.catch(() => {
    leafletLoading = null;
  });
  return leafletLoading;
}

function scoreColor(score) {
  return `hsl(${Math.round(10 + (score / 100) * 36)}, 80%, 58%)`;
}

const IMG = {
  gold: "#ffce6f",
  accent: "#ff8a52",
  vis: "#6ea0ff",
};

const SENT = { good: "#ffce6f", bad: "#d85a3c", neutral: "#9c9086" };
function spotPopupHtml(s) {
  const scores = [];
  if (s.verdict?.score != null)
    scores.push(`${t("mappop.view")} <strong>${s.verdict.score}</strong>`);
  if (s.skyScore != null)
    scores.push(`${t("mappop.sky")} <strong>${s.skyScore}</strong>`);
  const meta = [];
  if (Number.isFinite(s.dist))
    meta.push(
      `${s.dist < 10 ? s.dist.toFixed(1) : Math.round(s.dist)} ${t("unit.km")}`,
    );
  if (s.dir) meta.push(t("mappop.towards", { dir: cardinal(s.dir) }));
  if (Number.isFinite(s.driveMin)) meta.push(`~${s.driveMin} ${t("unit.min")}`);
  const url = `https://www.openstreetmap.org/?mlat=${s.lat.toFixed(5)}&mlon=${s.lon.toFixed(
    5,
  )}#map=15/${s.lat.toFixed(4)}/${s.lon.toFixed(4)}`;
  const name = s.name || t(kindInfo(s.kind).labelKey);
  return `<div class="mappop">
    <strong class="mappop__name">${name}</strong>
    ${scores.length ? `<div class="mappop__scores">${scores.join(" · ")}</div>` : ""}
    ${s.verdict?.code ? `<div class="mappop__verdict spot--${s.verdict.sentiment}">${t("verdict." + s.verdict.code)}</div>` : ""}
    ${meta.length ? `<div class="mappop__meta">${meta.join(" · ")}</div>` : ""}
    <a href="${url}" target="_blank" rel="noopener">${t("spot.openOsm")}</a>
  </div>`;
}

/** Add a colored, clickable marker per suggested spot to a Leaflet group.
 *  Called by buildSunsetOverlays, and again on its own when a tap's background
 *  Overpass search resolves after the point was already drawn. */
function addSpotMarkers(L, group, spots, onSpotClick) {
  (spots || []).forEach((s) => {
    const c = SENT[s.verdict?.sentiment] || SENT.neutral;
    const m = L.marker([s.lat, s.lon], {
      icon: L.divIcon({
        className: "spotmark",
        html: `<span class="spotmark__dot" style="--c:${c}"></span>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      }),
    })
      .addTo(group)
      .bindPopup(spotPopupHtml(s));
    if (onSpotClick) m.on("click", () => onSpotClick(s));
  });
}

/**
 * Draws all the "sunset" overlays into a Leaflet group: ray towards the sun
 * (halo + dashes), sun at the horizon, visibility circle, markers for the
 * suggested spots and marker for the analyzed point. Shared between the
 * mini-map and the big map so the two behave the same way.
 * @param {*} L Leaflet
 * @param {*} group featureGroup to add the layers to
 * @param {{lat,lon,azimuth,score,event,visibility,spots,onSpotClick?}} o
 */
function buildSunsetOverlays(
  L,
  group,
  { lat, lon, azimuth, score, event, visibility, spots, onSpotClick },
) {
  const color = scoreColor(score);
  // Place the sun exactly on the rim of tonight's visibility circle, so the
  // ray always reaches the dashed edge and the three read as one statement:
  // hazy air pulls the sun in close, clear air pushes it to the horizon of
  // what you can see. Falls back to a fixed 12 km when we have no visibility
  // reading (the circle isn't drawn then either).
  const hasVis = Number.isFinite(visibility) && visibility > 0;
  const sunKm = hasVis ? visibility / 1000 : 12;
  const end = destinationPoint(lat, lon, azimuth, sunKm);
  const ray = [
    [lat, lon],
    [end.lat, end.lon],
  ];
  // Ray towards the sun: soft warm halo + amber dashes (mock 2b/3d).
  L.polyline(ray, {
    color: IMG.gold,
    weight: 9,
    opacity: 0.16,
    lineCap: "round",
  }).addTo(group);
  L.polyline(ray, {
    color: IMG.gold,
    weight: 2.5,
    opacity: 0.85,
    dashArray: "6 6",
    lineCap: "round",
  }).addTo(group);

  // Visibility circle: how far the atmosphere lets you see clearly.
  if (hasVis) {
    L.circle([lat, lon], {
      radius: visibility,
      color: IMG.vis,
      weight: 1,
      opacity: 0.5,
      fillColor: IMG.vis,
      fillOpacity: 0.06,
      dashArray: "4 6",
    }).addTo(group);
  }

  // Markers for the suggested spots, colored by view quality. Extracted so a
  // tap can render the point immediately and add these later, when the (slow)
  // Overpass spot search resolves — see evaluatePoint.
  addSpotMarkers(L, group, spots, onSpotClick);

  // The sun at the horizon, at the end of the ray (glow via CSS).
  L.marker([end.lat, end.lon], {
    icon: L.divIcon({
      className: "sunmark",
      html: '<span class="sunmark__glow"></span>',
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    }),
    interactive: false,
    keyboard: false,
  }).addTo(group);

  // Analyzed point: score bubble (gold, dark text) above a dot tinted by
  // score, with a white ring and halo.
  L.marker([lat, lon], {
    icon: L.divIcon({
      className: "skymark",
      html: `<span class="skymark__score">${score}</span><span class="skymark__dot" style="--c:${color}"></span>`,
      iconSize: [44, 48],
      iconAnchor: [22, 44],
    }),
  })
    .addTo(group)
    .bindPopup(
      t("map.markerPopup", {
        score,
        event: t("event." + (event === "sunrise" ? "sunrise" : "sunset")),
        dir: cardinal(azimuthToCardinal(azimuth)),
        deg: Math.round(azimuth),
      }),
    );
}

// Detail mini-map: a single Leaflet instance, reused as long as the point
// doesn't change (render() rebuilds the card several times as data arrives).
let mini = { map: null, container: null, key: null, tile: null };

/**
 * Mounts (or reuses) a Leaflet mini-map inside `mount`: OSM tiles, a marker
 * colored by score and a dashed ray towards the sun's azimuth, so you can see
 * at a glance where the sun will sit on the horizon.
 * @param {HTMLElement} mount container (already sized) to mount into
 * @param {{lat:number, lon:number, azimuth:number, score:number, event:string,
 *          visibility?:number, spots?:Array<any>, onExpand?:Function}} o
 */
export async function mountMiniMap(
  mount,
  { lat, lon, azimuth, score, event, visibility, spots, onExpand },
) {
  if (!mount) return;
  const L = await loadLeaflet(); // memoized: the first await is the only network cost
  const spotSig = (spots || []).length;
  const key = `${lat.toFixed(4)}|${lon.toFixed(4)}|${Math.round(azimuth)}|${score}|${event}|${Math.round(
    visibility || 0,
  )}|${spotSig}|${getLang()}`;

  // Same state as a previous render: reuse the existing Leaflet container.
  // lit preserves the mount node (#detail-map) across re-renders, so use
  // replaceChildren — not appendChild — to make the reused container the sole
  // child and drop any stale one left behind by a prior render.
  if (mini.container && mini.key === key) {
    mount.replaceChildren(mini.container);
    mini.map.invalidateSize();
    return;
  }

  // Different state (or first mount): rebuild. replaceChildren (not appendChild)
  // so the container `mini.map.remove()` left in the persistent mount node is
  // dropped instead of stacking a second map — which doubled the map height.
  if (mini.map) mini.map.remove();
  const container = document.createElement("div");
  container.className = "map";
  mount.replaceChildren(container);
  const map = L.map(container, {
    zoomControl: false,
    dragging: false, // static preview: doesn't trap the page scroll
    scrollWheelZoom: false,
    doubleClickZoom: false,
    keyboard: false,
    // Static preview → never animate. A queued zoom transition whose
    // `transitionend` fires after the card re-renders (render() rebuilds it as
    // spots/light-path data arrive) would run `_onZoomTransitionEnd` against a
    // detached pane and throw `_leaflet_pos`. No animation, no stray callback.
    zoomAnimation: false,
    fadeAnimation: false,
    markerZoomAnimation: false,
  }).setView([lat, lon], 12);
  compactAttribution(L, map);
  const tile = L.tileLayer(tileUrl(), TILE_OPTS).addTo(map);
  const overlays = L.featureGroup().addTo(map);

  buildSunsetOverlays(L, overlays, {
    lat,
    lon,
    azimuth,
    score,
    event,
    visibility,
    spots,
  });

  // A click on the map area (not on a marker: Leaflet doesn't propagate marker
  // clicks to the map's 'click') expands to the big in-app map.
  if (onExpand) {
    container.classList.add("map-slot--clickable");
    map.on("click", onExpand);
  }

  // Frame everything (point, ray, visibility circle, suggested spots).
  map.fitBounds(overlays.getBounds(), {
    padding: [28, 28],
    maxZoom: 12,
    animate: false,
  });

  mini = { map, container, key, tile };
}

/** Initial center: last analyzed place, otherwise the center of Italy. */
function initialCenter() {
  const p = window.skyhueLastPlace;
  if (p && Number.isFinite(p.latitude))
    return { lat: p.latitude, lon: p.longitude, zoom: 12 };
  return { lat: 41.9, lon: 12.5, zoom: 6 };
}

/**
 * Collapses the attribution into an "ⓘ" icon that expands on tap (or on
 * hover on desktop). The OSM/CARTO credit stays present — required by the
 * terms of use — but doesn't clutter the map. Also removes the default
 * "Leaflet" prefix.
 */
function compactAttribution(L, m) {
  m.attributionControl.setPrefix(false);
  const el = m.attributionControl.getContainer();
  if (!el) return;
  el.classList.add("attr-collapsed");
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.setAttribute("aria-label", t("map.attribution"));
  // Don't let the tap propagate to the map (would cause a spurious "point picked").
  L.DomEvent.disableClickPropagation(el);
  const toggle = () => el.classList.toggle("attr-open");
  L.DomEvent.on(el, "click", (e) => {
    if (e.target.closest("a")) return; // let the credit links open
    toggle();
  });
  L.DomEvent.on(el, "keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  });
}

async function ensureMap() {
  const L = await loadLeaflet();
  if (map) return;
  const c = initialCenter();
  map = L.map(els.canvas, { zoomControl: true }).setView(
    [c.lat, c.lon],
    c.zoom,
  );
  compactAttribution(L, map);
  bigTile = L.tileLayer(tileUrl(), TILE_OPTS).addTo(map);
  map.on("click", (e) => selectPoint(e.latlng.lat, e.latlng.lng));
  addLegend(L);
}

/** Symbol legend, mounted once as a Leaflet control. */
function addLegend(L) {
  if (legendControl) return;
  const Legend = L.Control.extend({
    options: { position: "bottomleft" },
    onAdd() {
      const el = L.DomUtil.create("details", "maplegend");
      el.open = true;
      el.innerHTML = `
        <summary class="maplegend__title">${t("map.legend")}</summary>
        <div class="maplegend__body">
          <div class="maplegend__row"><span class="maplegend__ico maplegend__ico--point"></span> ${t("map.legend.point")}</div>
          <div class="maplegend__row"><span class="maplegend__ico maplegend__ico--sun"></span> ${t("map.legend.sun")}</div>
          <div class="maplegend__row"><span class="maplegend__ico maplegend__ico--ray"></span> ${t("map.legend.ray")}</div>
          <div class="maplegend__row"><span class="maplegend__dot" style="--c:${SENT.good}"></span> ${t("map.legend.good")}</div>
          <div class="maplegend__row"><span class="maplegend__dot" style="--c:${SENT.neutral}"></span> ${t("map.legend.neutral")}</div>
          <div class="maplegend__row"><span class="maplegend__dot" style="--c:${SENT.bad}"></span> ${t("map.legend.bad")}</div>
          <div class="maplegend__row"><span class="maplegend__ico maplegend__ico--vis"></span> ${t("map.legend.visibility")}</div>
        </div>`;
      // Don't let clicks/scrolls pass from the legend to the map below.
      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.disableScrollPropagation(el);
      return el;
    },
  });
  legendControl = new Legend();
  legendControl.addTo(map);
}

/**
 * Draws on the big canvas the context received from main.js (`skyhueMapContext`):
 * analyzed point, ray towards the sun, visibility circle and ALL the suggested
 * spots (clickable to be evaluated), then frames it all. Rebuilt on every open
 * so, when the place changes, no stale markers are left behind.
 */
function renderContext() {
  if (!map || !window.L) return;
  const L = window.L;

  // Clear the previous tap state and the previous context.
  if (tapTimer) {
    clearTimeout(tapTimer);
    tapTimer = null;
  }
  if (contextLayer) {
    contextLayer.remove();
    contextLayer = null;
  }
  if (tapLayer) {
    tapLayer.remove();
    tapLayer = null;
  }
  if (marker) {
    map.removeLayer(marker);
    marker = null;
  }
  if (visCircle) {
    map.removeLayer(visCircle);
    visCircle = null;
  }

  const ctx = window.skyhueMapContext;
  if (!ctx || !Number.isFinite(ctx.lat)) return;

  contextLayer = L.featureGroup().addTo(map);
  buildSunsetOverlays(L, contextLayer, {
    lat: ctx.lat,
    lon: ctx.lon,
    azimuth: ctx.azimuth,
    score: ctx.score,
    event: ctx.event,
    visibility: ctx.visibility,
    spots: ctx.spots,
    onSpotClick: (s) => selectPoint(s.lat, s.lon),
  });

  const bounds = contextLayer.getBounds();
  if (bounds.isValid())
    map.fitBounds(bounds, { padding: [42, 42], maxZoom: 13, animate: false });
}

/**
 * Removes every layer left by a previous tap: the pick marker, the visibility
 * circle and the full sunset overlays (ray, score bubble, suggested spots).
 * Called before each new tap so points don't pile up on the map while the new
 * evaluation is still in flight.
 */
function clearTap() {
  if (marker) {
    map.removeLayer(marker);
    marker = null;
  }
  if (visCircle) {
    map.removeLayer(visCircle);
    visCircle = null;
  }
  if (tapLayer) {
    tapLayer.remove();
    tapLayer = null;
  }
}

/**
 * Handles the tap on a point: instant marker feedback, then a debounced fly +
 * evaluation. Debouncing coalesces a rapid burst of taps into a single fly +
 * evaluation — without it, each tap fired its own zoom animation and overlay
 * rebuild, and a burst stacked them faster than they tore down (event listeners
 * spiked into the thousands and the main thread thrashed with layout work).
 */
function selectPoint(lat, lon) {
  const L = window.L;
  // Instant, cheap feedback: wipe the previous tap and drop the pick marker
  // right where the user tapped, before any async/animated work.
  clearTap();
  marker = L.circleMarker([lat, lon], {
    radius: 9,
    color: IMG.accent,
    weight: 3,
    fillColor: IMG.accent,
    fillOpacity: 0.5,
    className: "tapmark",
  }).addTo(map);
  marker.bringToFront();
  // Debounce the expensive part (animated fly + fetches + overlay rebuild): only
  // the last tap of a rapid burst runs it. evaluatePoint still aborts/supersedes
  // its own in-flight work for taps spaced further apart than this window.
  if (tapTimer) clearTimeout(tapTimer);
  tapTimer = setTimeout(() => {
    tapTimer = null;
    // Smooth transition to the chosen point (without pulling the zoom out too much).
    map.flyTo([lat, lon], Math.max(map.getZoom(), 12), { duration: 0.6 });
    evaluatePoint(lat, lon);
  }, 150);
}

/** Evaluates a point: score for the current event, sun direction and view towards the sun. */
async function evaluatePoint(lat, lon) {
  // Cancel the previous evaluation still in flight: tapping several points in
  // a row, superseded requests (including the expensive Overpass queries) get
  // aborted instead of piling up and saturating the network.
  if (evalAbort) evalAbort.abort();
  evalAbort = new AbortController();
  const { signal } = evalAbort;
  const token = ++evalToken;
  els.panel.hidden = false;
  els.panel.innerHTML = `<p class="muted">${t("mp.calc")}</p>`;
  try {
    const [forecast, air] = await Promise.all([
      fetchForecast(lat, lon, { signal }),
      fetchAirQuality(lat, lon, { signal }).catch(() => null),
    ]);
    // Score the event the app is currently in (sunrise/sunset); a direct
    // #map deep-link has no context and defaults to sunset.
    const event =
      window.skyhueMapContext?.event === "sunrise" ? "sunrise" : "sunset";
    const iso = nextSunset(forecast, new Date())[event];
    const cond = { ...conditionsAtTime(forecast, iso), ...airAtTime(air, iso) };
    const { score } = computeSunsetScore(cond);
    const eventDate = new Date(iso);
    const sun = sunPosition(eventDate, lat, lon);

    // The view verdict needs terrain elevations along the ray toward the sun.
    // That's a fast, bounded fetch — await it. The nearby-spot search, by
    // contrast, is an Overpass query (slow, sometimes many seconds); it must NOT
    // gate the score/verdict/point, so it runs in the background below and its
    // markers are added when it lands.
    let horizon = null;
    try {
      const pts = SAMPLE_DISTANCES.map((d) =>
        d === 0 ? { lat, lon } : destinationPoint(lat, lon, sun.azimuth, d),
      );
      const el = await fetchElevations(pts, { signal });
      const ahead = SAMPLE_DISTANCES.slice(1).map((distKm, k) => ({
        distKm,
        elev: el[k + 1],
      }));
      horizon = evaluateHorizon(el[0], ahead);
    } catch (err) {
      if (err?.name === "AbortError" || signal.aborted) return; // superseded by a new tap
      console.warn("Elevations not available:", err);
    }
    const verdict = spotVerdict("viewpoint", horizon);

    if (token !== evalToken) return; // superseded by a more recent tap

    // Render the point + score + verdict now — no waiting on the spot search.
    clearTap(); // the pick marker is replaced by the score-colored dot below
    tapLayer = window.L.featureGroup().addTo(map);
    const layer = tapLayer;
    buildSunsetOverlays(window.L, layer, {
      lat,
      lon,
      azimuth: sun.azimuth,
      score,
      event,
      visibility: cond.visibility,
      spots: [],
      onSpotClick: (s) => selectPoint(s.lat, s.lon),
    });

    renderPanel({
      lat,
      lon,
      eventDate,
      score,
      sun,
      verdict,
      visibility: cond.visibility,
      elevation: forecast.elevation,
    });

    // Background: the slow Overpass spot search. Add its markers to the layer
    // already on the map, if this evaluation is still the current one.
    nearbySpots(lat, lon, sun.azimuth, { signal })
      .then((near) => {
        if (token !== evalToken || signal.aborted || !near?.length) return;
        addSpotMarkers(window.L, layer, near, (s) => selectPoint(s.lat, s.lon));
      })
      .catch((err) => {
        if (err?.name !== "AbortError")
          console.warn("Nearby spots not available:", err);
      });
  } catch (err) {
    if (err?.name === "AbortError" || signal.aborted || token !== evalToken)
      return;
    els.panel.innerHTML = `<p class="muted">${t("mp.na")}</p>`;
  }
}

function renderPanel({
  lat,
  lon,
  eventDate,
  score,
  sun,
  verdict,
  visibility,
  elevation,
}) {
  const coords = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"} · ${Math.abs(
    lon,
  ).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
  const dir = cardinal(azimuthToCardinal(sun.azimuth));
  els.panel.innerHTML = `
    <span class="mp__handle" aria-hidden="true"></span>
    <div class="mp__head">
      ${skySwatch({ size: "md" })}
      <div class="mp__title">
        <strong>${t("map.pointName")}</strong>
        <span class="mp__coords mono">${coords}</span>
      </div>
      <div class="mp__scorebox">
        ${scoreNumeral(score, { size: "l", score, cls: "mp__score" })}
        <span class="mp__label">${t("label." + scoreLabel(score))}</span>
      </div>
    </div>
    <p class="mp__verdict spot--${verdict.sentiment}" style="--hue:${scoreHue(
      verdict.score ?? score,
    )}">${icon(verdict.icon, { size: 16 })} ${t(
      "verdict." + verdict.code,
    )} — ${t("mappop.towards", { dir })} (${Math.round(sun.azimuth)}°)</p>
    ${button(t("mp.openDetail"), { variant: "primary", id: "mp-open", cls: "mp__open" })}
  `;
  const open = document.getElementById("mp-open");
  open.addEventListener("click", () => {
    window.dispatchEvent(
      new CustomEvent("skyhue:analyze", {
        detail: {
          latitude: lat,
          longitude: lon,
          label: t("map.pointLabel", {
            lat: lat.toFixed(3),
            lon: lon.toFixed(3),
          }),
        },
      }),
    );
    goToApp();
  });
}

// --- Routing between the two screens ------------------------------------------

function showMap() {
  els.appView.hidden = true;
  els.mapView.hidden = false;
  // Hide the panel from the previous tap: the map opens "clean".
  els.panel.hidden = true;
  ensureMap()
    .then(() => {
      // The canvas just became visible: recompute its size before drawing/
      // framing, otherwise Leaflet starts at size 0.
      map.invalidateSize();
      renderContext();
    })
    .catch(() => {
      els.panel.hidden = false;
      els.panel.innerHTML = `<p class="muted">${t("map.loadError")}</p>`;
    });
}

function goToApp() {
  if (location.hash === "#map") location.hash = "";
  else applyRoute();
}

function applyRoute() {
  if (location.hash === "#map") {
    showMap();
  } else {
    if (tapTimer) {
      clearTimeout(tapTimer); // don't let a pending tap fire on the hidden map
      tapTimer = null;
    }
    els.mapView.hidden = true;
    els.appView.hidden = false;
  }
}

if (els.mapView) {
  window.addEventListener("hashchange", applyRoute);
  if (els.back) els.back.addEventListener("click", () => history.back());
  applyRoute();
}

// Theme change: swap the light/dark tiles on the big map and on the mini-map
// (the overlays are warm-tinted, consistent with both themes).
window.addEventListener("skyhue:themechange", () => {
  const url = tileUrl();
  if (bigTile) bigTile.setUrl(url);
  if (mini.tile) mini.tile.setUrl(url);
});

// Language change: regenerate the legend and redraw the context (popups and
// panel get recreated with the new strings on the next interaction/tap).
window.addEventListener("skyhue:langchange", () => {
  if (!map || !window.L) return;
  if (legendControl) {
    map.removeControl(legendControl);
    legendControl = null;
  }
  addLegend(window.L);
  renderContext();
});
