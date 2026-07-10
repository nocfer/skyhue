import {
  geocode,
  fetchForecast,
  fetchAirQuality,
  airAtTime,
  conditionsAtTime,
  conditionsWindow,
  nextSunset,
  dailyList,
  coordsLabel,
} from "./api.js";
import {
  computeSunsetScore,
  scoreLabel,
  explainScore,
  scoreUpside,
  scoreCeiling,
  WEIGHTS,
} from "./score.js";
import { fetchLightPath, lightPathClearAt } from "./lightpath.js";
import {
  sunPosition,
  azimuthToCardinal,
  moonPhase,
  moonPhaseName,
  moonIllumination,
  twilightTimes,
} from "./astronomy.js";
import {
  getFavorites,
  isFavorite,
  toggleFavorite,
  removeFavorite,
} from "./store.js";
import { skyGradient, skyGradientCss } from "./sky.js";
import { icon, ICONS } from "./icons.js";
import {
  scoreHue,
  scoreNumeral,
  skySwatch,
  statCell,
  sectionHeader,
  chip,
  button,
} from "./ui.js";
import { mountMiniMap } from "./map.js";
import {
  t,
  cardinal,
  initLang,
  getLang,
  setLang,
  applyStaticI18n,
} from "./i18n.js";
import {
  fetchSunsetSpots,
  distanceKm,
  bearing,
  kindInfo,
  destinationPoint,
  SAMPLE_DISTANCES,
  evaluateHorizon,
  spotVerdict,
  fetchElevations,
  angleDiff,
  driveMinutes,
  gridCandidates,
  prescoreGrid,
  horizonDistanceKm,
  reverseGeocode,
} from "./spots.js";

const els = {
  form: document.getElementById("search-form"),
  input: document.getElementById("search-input"),
  suggest: document.getElementById("search-suggest"),
  geoBtn: document.getElementById("geo-btn"),
  results: document.getElementById("results"),
  status: document.getElementById("status"),
  favorites: document.getElementById("favorites"),
};

const state = {
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
const SPOTS_EVALUATE = 14;
const SPOTS_SHOW = 6;
const SPOTS_SKY = 3;
const NEAR_KM = 6;
function eventNoun(ev) {
  return t("event." + ev);
}

function setStatus(msg, kind = "info") {
  els.status.textContent = msg || "";
  els.status.dataset.kind = kind;
}

/** Fetch data for a place and show the result. */
async function analyze(place) {
  setStatus(t("status.fetching", { label: place.label }), "info");
  els.results.innerHTML = "";
  try {
    // Weather and air quality in parallel; air is optional and non-blocking.
    const [forecast, air] = await Promise.all([
      fetchForecast(place.latitude, place.longitude),
      fetchAirQuality(place.latitude, place.longitude).catch(() => null),
    ]);
    const { dayIndex } = nextSunset(forecast, new Date());
    state.place = place;
    window.skyhueLastPlace = {
      latitude: place.latitude,
      longitude: place.longitude,
    };
    state.forecast = forecast;
    state.air = air;
    state.dayIndex = dayIndex;
    state.spots = null;
    state.spotsError = false;
    state.estimatedSpots = null;
    state.estimating = false;
    state.estimateError = false;
    state.lightPath = null;
    render();
    setStatus("", "info");
    loadSpots(place); // in background: doesn't block the main view
    loadLightPath(place); // same: the azimuth needs the just-arrived forecast
  } catch (err) {
    console.error(err);
    setStatus(t("status.error", { msg: err.message }), "error");
  }
}

/** Load scenic viewpoints (OSM) in the background and rate their outlook. */
async function loadSpots(place) {
  try {
    const raw = await fetchSunsetSpots(place.latitude, place.longitude);
    if (state.place !== place) return; // the user switched place in the meantime
    state.rawSpots = raw;
    state.rawSpotsFor = place;
    await evaluateSpots();
  } catch (err) {
    console.warn("Scenic spots not available:", err);
    if (state.place !== place) return;
    state.spotsError = true;
    render();
  }
}

/** Sun azimuth for the currently selected event and day. */
function currentAzimuth() {
  const { forecast, place, event, dayIndex } = state;
  const iso = dailyList(forecast)[dayIndex][event];
  return sunPosition(new Date(iso), place.latitude, place.longitude).azimuth;
}

/**
 * Load in the background the clouds along the ray toward the sun (light
 * path). The 4 forecasts cover 7 days of hours, so a single round serves
 * score, timeline and multi-day strip; the selected day's azimuth is reused
 * for the whole week (drift ≤ ~3° ≈ 13 km sideways at 250 km, less than
 * one model cell). Failure → score without this factor.
 */
async function loadLightPath(place) {
  const { event } = state;
  state.lightPath = {
    status: "loading",
    place,
    event,
    azimuth: null,
    data: null,
  };
  try {
    const azimuth = currentAzimuth();
    const data = await fetchLightPath(place.latitude, place.longitude, azimuth);
    if (state.place !== place || state.event !== event) return; // superseded
    const valid = data.points.filter((p) => p.forecast).length;
    state.lightPath =
      valid >= 2
        ? { status: "ready", place, event, azimuth, data }
        : { status: "error", place, event, azimuth, data: null };
    render();
  } catch (err) {
    console.warn("Light path not available:", err);
    if (state.place !== place || state.event !== event) return;
    state.lightPath = {
      status: "error",
      place,
      event,
      azimuth: null,
      data: null,
    };
    render();
  }
}

/** Light-path clearness (0-1) at the ISO instant, or null if the samples
 *  aren't available (yet) → score without this factor. */
function pathClearAt(iso) {
  const lp = state.lightPath;
  if (!lp || lp.status !== "ready" || lp.place !== state.place) return null;
  return lightPathClearAt(lp.data, state.forecast, iso);
}

/**
 * Rate the raw spots' outlook toward the sun (obstructions + open sea),
 * using terrain elevations sampled along the azimuth. Reuses rawSpots, so
 * switching sunrise/sunset recomputes without re-querying OSM.
 */
async function evaluateSpots() {
  const place = state.place;
  const raw = state.rawSpots;
  if (!raw) return;
  if (raw.length === 0) {
    state.spots = [];
    render();
    return;
  }

  const azimuth = currentAzimuth();

  // Direction-optimized pre-selection: within NEAR_KM keep everything; beyond,
  // we pay a higher "cost" if the point isn't toward the sunset. So, even with
  // a wide radius, we evaluate (the costly part: elevations) only the most promising.
  const nearest = raw
    .map((s) => {
      const dist = distanceKm(place.latitude, place.longitude, s.lat, s.lon);
      const dirDiff = angleDiff(
        bearing(place.latitude, place.longitude, s.lat, s.lon),
        azimuth,
      );
      const offSunset = dist > NEAR_KM && dirDiff > 90 ? 2 : 1; // penalize far points "on the wrong side"
      return { ...s, dist, dirDiff, cost: dist * offSunset };
    })
    .sort((a, b) => a.cost - b.cost)
    .slice(0, SPOTS_EVALUATE);

  const evaluated = await refineCandidates(nearest, azimuth, place);
  if (state.place !== place) return;

  // Sort by final score (outlook − distance), then by proximity.
  evaluated.sort((a, b) => b.finalScore - a.finalScore || a.dist - b.dist);
  state.spots = evaluated;
  render();

  // In background: compute the sky score directly at the finalist points.
  loadSky(state.spots, place);
}

/**
 * Shared refinement: for each candidate sample the terrain along the ray
 * toward the sun, rate the outlook and compute verdict + final score.
 * Used by both OSM spots and the coordinate-based estimate.
 */
async function refineCandidates(candidates, azimuth, place) {
  const points = [];
  for (const s of candidates) {
    for (const d of SAMPLE_DISTANCES) {
      points.push(
        d === 0
          ? { lat: s.lat, lon: s.lon }
          : destinationPoint(s.lat, s.lon, azimuth, d),
      );
    }
  }
  let elevations = null;
  try {
    elevations = await fetchElevations(points);
  } catch (err) {
    console.warn(
      "Elevations not available, skipping the view evaluation:",
      err,
    );
  }
  const n = SAMPLE_DISTANCES.length;
  return candidates.map((s, i) => {
    let horizon = null;
    let elev = null;
    if (elevations && elevations.length >= (i + 1) * n) {
      elev = elevations[i * n];
      const ahead = SAMPLE_DISTANCES.slice(1).map((distKm, k) => ({
        distKm,
        elev: elevations[i * n + 1 + k],
      }));
      horizon = evaluateHorizon(elev, ahead);
    }
    const verdict = spotVerdict(s.kind, horizon);
    const dist =
      s.dist ?? distanceKm(place.latitude, place.longitude, s.lat, s.lon);
    const finalScore = verdict.score - Math.max(0, dist - NEAR_KM) * 0.4;
    return {
      ...s,
      dist,
      elev,
      dir: azimuthToCardinal(
        bearing(place.latitude, place.longitude, s.lat, s.lon),
      ),
      driveMin: driveMinutes(dist),
      verdict,
      finalScore,
    };
  });
}

/**
 * "From coordinates" search (on demand): generate a grid of points, pre-
 * select those on land near the coast from elevations alone, then refine
 * the best with the same outlook rating used for mapped spots.
 */
async function scanCoordinates() {
  const place = state.place;
  if (!place || state.estimating) return;
  state.estimating = true;
  state.estimateError = false;
  render();
  try {
    const azimuth = currentAzimuth();
    const radius = 20;
    const perSide = 9;
    const grid = gridCandidates(
      place.latitude,
      place.longitude,
      radius,
      perSide,
    );
    const gelev = await fetchElevations(grid);
    if (state.place !== place) return;
    const step = (2 * radius) / (perSide - 1);
    const candidates = prescoreGrid(grid, gelev, step)
      .filter((p) => p.prescore > -Infinity)
      .sort((a, b) => b.prescore - a.prescore)
      .slice(0, SPOTS_EVALUATE)
      .map((p) => ({ lat: p.lat, lon: p.lon, kind: "estimate", name: null }));
    const evaluated = await refineCandidates(candidates, azimuth, place);
    if (state.place !== place) return;
    evaluated.sort((a, b) => b.finalScore - a.finalScore || a.dist - b.dist);
    state.estimatedSpots = evaluated.slice(0, SPOTS_SHOW);
    state.estimating = false;
    render();
    loadSky(state.estimatedSpots, place);
    nameEstimatedSpots(state.estimatedSpots, place);
  } catch (err) {
    console.warn("Coordinate scan failed:", err);
    if (state.place !== place) return;
    state.estimating = false;
    state.estimateError = true;
    render();
  }
}

/**
 * For the top finalists of a list fetch the weather at the point and compute
 * its Sunset Score, so each destination shows both outlook and sky quality.
 */
/**
 * Name the first estimated points via reverse geocoding (Nominatim),
 * sequentially to respect the rate limit. Updates the name and re-renders.
 */
async function nameEstimatedSpots(spots, place) {
  const top = (spots || []).filter((s) => s.kind === "estimate").slice(0, 3);
  for (const s of top) {
    try {
      const name = await reverseGeocode(s.lat, s.lon, getLang());
      if (name) s.name = name;
    } catch (err) {
      /* keeps the "estimated point" name */
    }
  }
  if (state.place !== place) return;
  render();
}

async function loadSky(list, place) {
  const top = (list || []).slice(0, SPOTS_SKY);
  if (!top.length) return;
  const scores = await Promise.all(
    top.map(async (s) => {
      try {
        const f = await fetchForecast(s.lat, s.lon);
        const day = dailyList(f)[state.dayIndex] ?? dailyList(f)[0];
        const iso = day[state.event];
        const cond = {
          ...conditionsAtTime(f, iso),
          ...airAtTime(state.air, iso),
        };
        return computeSunsetScore(cond).score;
      } catch (err) {
        console.warn("Sky score for the spot not available:", err);
        return null;
      }
    }),
  );
  if (state.place !== place) return;
  top.forEach((s, i) => {
    s.skyScore = scores[i];
  });

  // Fold the forecast colors into the ranking: a point with a great outlook
  // but a mediocre sky must not stay on top for the view alone. For finalists
  // whose sky we know we use a combined score (outlook weighs more than the
  // sky, which is nearly uniform over the area, minus the distance penalty);
  // the others keep finalScore, on a comparable scale.
  top.forEach((s) => {
    if (s.skyScore == null) return;
    const distPenalty = Math.max(0, s.dist - NEAR_KM) * 0.4;
    s.overallScore = 0.6 * s.verdict.score + 0.4 * s.skyScore - distPenalty;
  });
  list.sort(
    (a, b) =>
      (b.overallScore ?? b.finalScore) - (a.overallScore ?? a.finalScore) ||
      a.dist - b.dist,
  );
  render();
}

/** Compute score + explanation for a day's event (sunrise/sunset). */
function evaluateDay(dayIndex) {
  const { forecast, place, event } = state;
  const day = dailyList(forecast)[dayIndex];
  const eventIso = day[event];
  const cond = {
    ...conditionsAtTime(forecast, eventIso),
    ...airAtTime(state.air, eventIso),
    pathClear: pathClearAt(eventIso),
  };
  const { score, factors } = computeSunsetScore(cond);
  const notes = explainScore(factors);
  const eventDate = new Date(eventIso);
  const sun = sunPosition(eventDate, place.latitude, place.longitude);
  const phase = moonPhase(eventDate);

  // Timeline: how sky conditions evolve in the hours around the event.
  // We keep the factors too, so each hour can draw its own swatch.
  const timeline = conditionsWindow(forecast, eventIso, 2, 2).map((c) => {
    const hourCond = {
      ...c,
      ...airAtTime(state.air, c.time),
      pathClear: pathClearAt(c.time),
    };
    const { score: s, factors: f } = computeSunsetScore(hourCond);
    return {
      time: new Date(c.time),
      score: s,
      factors: f,
      isCenter: c.isCenter,
    };
  });

  return {
    day,
    eventDate,
    cond,
    score,
    factors,
    notes,
    sun,
    phase,
    timeline,
    event,
    place,
  };
}

function locale() {
  return getLang() === "en" ? "en-GB" : "it-IT";
}

function fmtTime(date) {
  return date.toLocaleTimeString(locale(), {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDay(date) {
  return date.toLocaleDateString(locale(), {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function fmtWeekdayShort(date) {
  return date.toLocaleDateString(locale(), { weekday: "short" });
}

function fmtWeekdayLong(date) {
  return date.toLocaleDateString(locale(), { weekday: "long" });
}

/**
 * Leaflet mini-map of the analyzed point: an empty container (Leaflet is
 * mounted onto it by `mountMiniMap` after DOM insertion) + "Expand" chip and
 * button that open the in-app big map with all points marked.
 */
function mapEmbedHtml() {
  return `
    <div class="map-wrap">
      <div class="map-slot" id="detail-map"></div>
      <span class="map-slot__expand" aria-hidden="true">${icon("maximize", {
        size: 15,
      })} ${t("detail.expand")}</span>
    </div>
    ${button(t("detail.openMap"), { variant: "primary", icon: "map", id: "open-bigmap", cls: "map__open" })}`;
}

/** Card for a suggested spot (used for both POIs and estimated points).
 *  `factors` (of the analyzed point) drives the thumbnail gradient:
 *  forecast sky over the spot's sky score; obstructed outlooks → muted
 *  tile without sun. */
function spotRowHtml(s, factors) {
  const info = kindInfo(s.kind);
  const dist = s.dist < 10 ? s.dist.toFixed(1) : Math.round(s.dist);
  const v = s.verdict;
  const est = s.kind === "estimate";
  const isBad = v.sentiment === "bad";
  const gradScore = isBad
    ? Math.min(s.skyScore ?? 30, 30)
    : (s.skyScore ?? v.score);
  const grad = factors ? skyGradientCss(skyGradient(factors, gradScore)) : "";
  const url = `https://www.openstreetmap.org/?mlat=${s.lat.toFixed(5)}&mlon=${s.lon.toFixed(
    5,
  )}#map=15/${s.lat.toFixed(4)}/${s.lon.toFixed(4)}`;
  // "sky NN" pill: the expected color at the point (shown for obstructed outlooks too).
  const skyPill =
    s.skyScore != null
      ? chip({
          variant: "sky",
          value: t("spot.sky", { n: s.skyScore }),
          score: s.skyScore,
          title: t("spot.skyTitle"),
        })
      : "";
  const quota =
    est && s.elev != null ? ` · ${Math.round(s.elev)} ${t("unit.m")}` : "";
  const kindLabel = est ? t("kind.estimate") : t(info.labelKey);
  const meta = `${kindLabel} · ${dist} ${t("unit.km")} · ~${s.driveMin} ${t("unit.min")} · ${cardinal(
    s.dir,
  )}${quota}`;
  return `<li class="spot spot--${v.sentiment}" style="--hue:${scoreHue(v.score)}">
    ${skySwatch({ size: "lg", grad, sun: !isBad, tag: est ? t("spot.estTag") : "" })}
    <div class="spot__body">
      <a class="spot__name" href="${url}" target="_blank" rel="noopener">${escapeHtml(
        s.name || t(info.labelKey),
      )}</a>
      <span class="spot__verdict">${icon(v.icon, { size: 15 })} ${t(
        "verdict." + v.code,
      )}<span class="spot__kind" title="${escapeHtml(kindLabel)}">${icon(
        info.icon,
        {
          size: 14,
        },
      )}</span></span>
      <span class="spot__meta mono">${meta}</span>
    </div>
    <div class="spot__scores">
      ${scoreNumeral(v.score, { size: "m", score: v.score, title: t("spot.viewQuality") })}
      ${skyPill}
    </div>
  </li>`;
}

/** "From coordinates" estimate block (button + optional list). */
function estimateBlockHtml(factors) {
  let list = "";
  if (state.estimateError) {
    list = `<p class="muted">${t("spots.estimateError")}</p>`;
  } else if (state.estimatedSpots && state.estimatedSpots.length) {
    list = `<ul class="spots">${state.estimatedSpots
      .map((s) => spotRowHtml(s, factors))
      .join("")}</ul>
      <p class="muted spots__hint">${t("spots.estimateHint")}</p>`;
  } else if (state.estimatedSpots && state.estimatedSpots.length === 0) {
    list = `<p class="muted">${t("spots.estimateNone")}</p>`;
  }
  return `
    ${button(state.estimating ? t("spots.scanning") : t("spots.scan"), {
      variant: "outline",
      icon: state.estimating ? undefined : "compass",
      cls: "scan-btn",
      attrs: state.estimating ? "disabled" : "",
    })}
    ${list}`;
}

/** "Where to go watch it" section: nearby viewpoints (dual score). */
function spotsSectionHtml(place, sun, factors) {
  const dirNote = t("spots.dirNote", {
    verb: t(state.event === "sunset" ? "verb.sets" : "verb.rises"),
    dir: cardinal(azimuthToCardinal(sun.azimuth)),
    deg: Math.round(sun.azimuth),
  });

  let body = "";
  let more = "";
  if (state.spotsError) {
    body = `<p class="sect__note">${t("spots.error")}</p>`;
  } else if (state.spots === null) {
    body = `<p class="sect__note">${t("spots.loading")}</p>`;
  } else if (state.spots.length === 0) {
    body = `<p class="sect__note">${t("spots.none")}</p>`;
  } else {
    const shown = state.spots.slice(0, SPOTS_EVALUATE);
    body = `<ul class="spots is-collapsed" id="spots-list">${shown
      .map((s) => spotRowHtml(s, factors))
      .join("")}</ul>`;
    if (shown.length > 3) {
      more = `<button type="button" class="linkbtn" id="spots-more" data-more="${t(
        "spots.seeAll",
        {
          n: shown.length,
        },
      )}" data-less="${t("why.showLess")}">${t("spots.seeAll", { n: shown.length })}</button>`;
    }
  }

  return `
    <section class="sect">
      ${sectionHeader(t("section.spots"))}
      <p class="sect__cap">${dirNote}</p>
      <p class="dualscore mono">${t("spot.dualLegend")}</p>
      ${body}
      ${more}
      <div class="estimate">${estimateBlockHtml(factors)}</div>
    </section>`;
}

/** SVG compass with the sun placed at its azimuth (0°=N, 90°=E, …). */
function compassSvg(azimuth) {
  const cx = 70;
  const cy = 70;
  const r = 54;
  const rad = (azimuth * Math.PI) / 180;
  const sx = (cx + r * Math.sin(rad)).toFixed(1);
  const sy = (cy - r * Math.cos(rad)).toFixed(1);
  return `
    <svg viewBox="0 0 140 140" class="compass" role="img" aria-label="${t("stat.direction")}">
      <circle cx="70" cy="70" r="54" class="compass__ring" />
      <line x1="70" y1="70" x2="${sx}" y2="${sy}" class="compass__ray" />
      <circle cx="${sx}" cy="${sy}" r="9" class="compass__sun" />
      <circle cx="70" cy="70" r="3" class="compass__center" />
      <text x="70" y="22" class="compass__lbl">${cardinal("N")}</text>
      <text x="122" y="75" class="compass__lbl">${cardinal("E")}</text>
      <text x="70" y="132" class="compass__lbl">${cardinal("S")}</text>
      <text x="18" y="75" class="compass__lbl">${cardinal("O")}</text>
    </svg>`;
}

/** Show the home (no place). If focusSearch, move the cursor into the
 *  search bar (used by the "search" button in the results hero). */
function showHome(focusSearch) {
  state.forecast = null;
  state.place = null;
  state.spots = null;
  state.rawSpots = null;
  els.results.hidden = true;
  els.results.innerHTML = "";
  const home = document.getElementById("home");
  if (home) home.hidden = false;
  renderFavorites();
  window.scrollTo(0, 0);
  if (focusSearch === true)
    setTimeout(() => els.input && els.input.focus(), 50);
}

/** Show the results screen (hides the home). */
function showResults() {
  const home = document.getElementById("home");
  if (home) home.hidden = true;
  els.results.hidden = false;
}

/** Switch event (sunrise/sunset) and re-render keeping all toggles in sync. */
function setEvent(ev) {
  if (ev !== "sunset" && ev !== "sunrise") return;
  state.event = ev;
  document
    .querySelectorAll(".mode")
    .forEach((b) => b.classList.toggle("mode--active", b.dataset.event === ev));
  // The azimuth changes a lot between sunrise and sunset: re-rate the spots'
  // outlook and resample the light path (nearly opposite ray).
  if (state.rawSpots && state.rawSpotsFor === state.place) {
    state.spots = null;
    state.spotsError = false;
  }
  state.lightPath = null;
  if (state.forecast) render();
  if (state.forecast) loadLightPath(state.place); // usually a cache hit: instant
  if (state.rawSpots && state.rawSpotsFor === state.place) evaluateSpots();
  if (!state.forecast) renderFavorites(); // refresh the favorites' scores on the home
}

/** Wire up the sunrise/sunset buttons contained in `root`. */
function bindModes(root) {
  root.querySelectorAll(".mode").forEach((btn) => {
    btn.addEventListener("click", () => setEvent(btn.dataset.event));
  });
}

/** Redraw the whole view from state: home (no place) or
 *  results (sky hero + sections in a single scroll). */
function render() {
  if (!state.forecast) {
    showHome();
    return;
  }
  showResults();

  const { forecast } = state;
  const days = dailyList(forecast);
  const scored = days.map((d) => {
    const cond = {
      ...conditionsAtTime(forecast, d[state.event]),
      ...airAtTime(state.air, d[state.event]),
      pathClear: pathClearAt(d[state.event]),
    };
    return {
      d,
      score: computeSunsetScore(cond).score,
      date: new Date(d[state.event]),
    };
  });

  renderResults(evaluateDay(state.dayIndex), scored);
}

/** Localized cardinal name from the azimuth. */
function dirName(azimuth) {
  return cardinal(azimuthToCardinal(azimuth));
}

/** True when the date falls on the current calendar day. */
function isToday(date) {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

/** Contextual eyebrow word ("Tonight" only for today's sunset, otherwise the day). */
function whenWord(date, event) {
  return event === "sunset" && state.dayIndex === 0 && isToday(date)
    ? t("time.tonight")
    : fmtWeekdayShort(date);
}

/* ---------- Sky hero (results screen 1b) ---------- */
function heroHtml({ eventDate, score, event }) {
  const { place } = state;
  const label = scoreLabel(score);
  // Low scores: less vivid sky (desaturate + darken proportionally).
  const satu = (0.4 + 0.6 * (score / 100)).toFixed(2);
  const bright = (0.72 + 0.28 * (score / 100)).toFixed(2);
  return `
    <header class="rhero" style="--hue:${scoreHue(score)}">
      <div class="rhero__sky" style="filter:saturate(${satu}) brightness(${bright})"></div>
      <div class="grain" aria-hidden="true"></div>
      <div class="rhero__melt"></div>
      <span class="rhero__sun" aria-hidden="true"></span>
      <div class="rhero__top">
        <button type="button" class="rhero__loc" id="rhero-loc" aria-label="${t("rhero.change")}">
          ${icon("pin", { size: 16 })}<span>${escapeHtml(place.label)}</span>${icon(
            "chevron-down",
            {
              size: 16,
            },
          )}
        </button>
        <div class="rhero__actions">
          <button type="button" class="gcircle" id="rhero-search" aria-label="${t("rhero.searchAria")}">${icon(
            "search",
            { size: 17 },
          )}</button>
          <button type="button" class="gcircle" id="rhero-share" aria-label="${t("detail.shareAria")}">${icon(
            "share",
            { size: 16 },
          )}</button>
          <button type="button" class="gcircle fav-toggle" aria-pressed="${isFavorite(
            place,
          )}" aria-label="${t("detail.favSave")}">${icon("star", {
            size: 17,
            fill: isFavorite(place),
          })}</button>
          <div class="menu">${moreMenuHtml()}</div>
        </div>
      </div>
      <div class="rhero__verdict">
        <p class="rhero__eyebrow mono">${whenWord(eventDate, event)} · ${eventNoun(
          event,
        )} ${fmtTime(eventDate)}</p>
        <h1 class="verdict__headline">${t("headline." + label + "." + event)}</h1>
        <p class="rhero__score">${scoreNumeral(score, {
          size: "l",
          score,
        })}<span>${t("results.scoreOutOf")}</span></p>
        <div class="rhero__meter" role="presentation" aria-hidden="true">
          <span class="rhero__meterfill" style="width:${Math.max(0, Math.min(100, score))}%"></span>
        </div>
      </div>
    </header>`;
}

function introHtml({ score, sun }) {
  // The direction is highlighted in gold (mock 1b: "The sun sets to the <NW>").
  return `<p class="rintro">${t("intro." + scoreLabel(score), {
    dir: `<strong>${dirName(sun.azimuth)}</strong>`,
    verb: t(state.event === "sunset" ? "verb.sets" : "verb.rises"),
  })}</p>`;
}

/* Compact sunrise/sunset toggle on the results screen. */
function eventToggleHtml() {
  const mk = (ev, ico) =>
    `<button type="button" class="mode${state.event === ev ? " mode--active" : ""}" data-event="${ev}">${icon(
      ico,
      { size: 15 },
    )} <span>${t("event." + ev)}</span></button>`;
  return `<div class="modes modes--compact" role="group" aria-label="${t(
    "mode.groupAria",
  )}">${mk("sunset", "sunset")}${mk("sunrise", "sunrise")}</div>`;
}

/* "This week": 7-day ribbon with dot + colored number. */
function weekRibbonHtml(scored, bestDayIndex = null) {
  // Weekly summary: the caption uses the maximum; the glow highlights only
  // the "banner-worthy" day (≥85 and not today), or none if it doesn't qualify.
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a), scored[0]);
  const cols = scored
    .map(({ d, score, date }) => {
      const isBest = bestDayIndex != null && d.dayIndex === bestDayIndex;
      const active = d.dayIndex === state.dayIndex;
      // Dot sized by the score (7–11px), color from the warm ramp.
      const dotSize = (7 + 4 * (score / 100)).toFixed(1);
      return `
      <button class="wk__col${active ? " wk__col--active" : ""}${
        isBest ? " wk__col--best" : ""
      }" data-day="${d.dayIndex}" style="--hue:${scoreHue(score)};--dsz:${dotSize}px">
        ${scoreNumeral(score, { size: "xs", score, cls: "wk__score" })}
        <span class="wk__dot"></span>
        <span class="wk__day">${fmtWeekdayShort(date)}</span>
      </button>`;
    })
    .join("");
  return `
    <section class="sect sect--week">
      ${sectionHeader(t("section.week"))}
      <p class="sect__cap">${t("week.caption", {
        day: fmtWeekdayShort(best.date),
        score: best.score,
      })}</p>
      <div class="wk">${cols}</div>
    </section>`;
}

/* "Conditions": 2×2 weather cards with a short descriptor. */
function condDesc(type, v) {
  const key =
    type === "high"
      ? v >= 20 && v <= 75
        ? "litCirrus"
        : v > 75
          ? "heavyHigh"
          : "fewHigh"
      : type === "low"
        ? v < 15
          ? "clearHorizon"
          : v < 40
            ? "someLow"
            : "blockedLow"
        : type === "vis"
          ? v >= 20
            ? "crispAir"
            : v >= 10
              ? "okVis"
              : "hazyVis"
          : type === "path"
            ? v >= 0.8
              ? "pathClear"
              : v >= 0.45
                ? "pathPartial"
                : "pathBlocked"
            : v <= 50
              ? "dryAir"
              : v <= 70
                ? "okHum"
                : "humidAir";
  // Amber note only for the truly favorable descriptors (mock 1b).
  const positive =
    key === "litCirrus" || key === "clearHorizon" || key === "pathClear";
  return { text: t("desc." + key), positive };
}

/** "Light path" cell: loading state, error, or percent clear.
 *  The thresholds match the explanatory notes (explainScore). */
function lightPathCell(cond) {
  const lp = state.lightPath;
  let value = "—";
  let note = t("desc.pathUnknown");
  let noteAccent = false;
  if (lp && lp.status === "loading") {
    value = "…";
    note = t("desc.pathLoading");
  } else if (cond.pathClear !== null && cond.pathClear !== undefined) {
    value = Math.round(cond.pathClear * 100) + "%";
    const d = condDesc("path", cond.pathClear);
    note = d.text;
    noteAccent = d.positive;
  }
  return statCell({
    icon: "compass",
    label: t("stat.lightPath"),
    value,
    note,
    noteAccent,
  });
}

function conditionsHtml(cond) {
  const visKm = cond.visibility / 1000;
  const cell = (icon, label, type, v, value) => {
    const d = condDesc(type, v);
    return statCell({
      icon,
      label,
      value,
      note: d.text,
      noteAccent: d.positive,
    });
  };
  return `
    <section class="sect">
      ${sectionHeader(t("section.conditions"))}
      <div class="statgrid">
        ${cell("cloud-sun", t("cond.highCloud"), "high", cond.cloudCoverHigh, Math.round(cond.cloudCoverHigh) + "%")}
        ${cell("cloud", t("cond.lowCloud"), "low", cond.cloudCoverLow, Math.round(cond.cloudCoverLow) + "%")}
        ${cell("eye", t("stat.visibility"), "vis", visKm, visKm.toFixed(0) + " km")}
        ${cell("droplet", t("stat.humidity"), "hum", cond.humidity, Math.round(cond.humidity) + "%")}
        ${lightPathCell(cond)}
      </div>
      ${(() => {
        const mid = Math.round(cond.cloudCoverMid ?? 0);
        return mid >= 5
          ? `<p class="sect__cap cond__mid">${t("cond.midNote", { mid })}</p>`
          : "";
      })()}
    </section>`;
}

// Icons for the counterfactual "what's missing to climb" levers (scoreUpside).
const UPSIDE_ICONS = {
  cirrus: "cloud-sun",
  horizon: "sunset",
  clearAir: "wind",
  haze: "haze",
  path: "compass",
};

/* "Why this score": "how it breaks down" bar + factor cards (top 3 + show all). */
function whyHtml({ score, factors, notes, cond }) {
  const b0 = WEIGHTS.base * 100;
  const d0 = WEIGHTS.drama * 100 * (factors.drama ?? 0);
  const c0 = WEIGHTS.clarity * 100 * (factors.clarity ?? 0);
  const rawSum = b0 + d0 + c0 || 1;
  const k = score / rawSum; // rescale the components to the final score (penalties included)
  const base = Math.round(b0 * k);
  const drama = Math.round(d0 * k);
  const clarity = Math.max(0, score - base - drama);
  const pct = (n) => ((n / Math.max(score, 1)) * 100).toFixed(1);

  const cards = notes
    .map((n, i) => {
      const p = { ...n.params };
      if (n.code === "hazeBad") {
        p.pm25note =
          p.pm25 != null ? t("explain.hazeBad.pm25", { pm25: p.pm25 }) : "";
      }
      return `
      <li class="driver driver--${n.sentiment}${i >= 3 ? " driver--extra" : ""}">
        <span class="driver__ico">${icon(n.icon, { size: 20 })}</span>
        <div>
          <strong>${t("explain." + n.code + ".title", p)}</strong>
          <p>${t("explain." + n.code + ".detail", p)}</p>
        </div>
      </li>`;
    })
    .join("");

  const more =
    notes.length > 3
      ? `<button type="button" class="linkbtn" id="why-more" data-more="${t(
          "why.showAll",
          {
            n: notes.length,
          },
        )}" data-less="${t("why.showLess")}">${t("why.showAll", { n: notes.length })}</button>`
      : "";

  // Counterfactual levers: what's missing (on its own) for a higher score.
  const upside = scoreUpside(cond);
  const ceiling = scoreCeiling(cond);
  const missing = upside.length
    ? `
      ${sectionHeader(t("why.missing"), { variant: "mono", sub: true })}
      <ul class="drivers">
        ${upside
          .map(
            (u) => `
        <li class="driver driver--upside">
          <span class="driver__ico">${icon(UPSIDE_ICONS[u.code], { size: 20 })}</span>
          <div>
            <strong>${t("upside." + u.code + ".title", {
              gain: `<b class="driver__gain">+${u.gain}</b>`,
            })}</strong>
            <p>${t("upside." + u.code + ".detail", { target: u.target })}</p>
          </div>
        </li>`,
          )
          .join("")}
      </ul>
      <p class="sect__cap">${t("why.missingFoot", { ceiling })}</p>`
    : "";

  // Subtitle: how many factors play in our favor tonight (mock 3a).
  const goodCount = notes.filter((n) => n.sentiment === "good").length;
  const sub = goodCount
    ? `<p class="sect__cap">${t(goodCount === 1 ? "why.subOne" : "why.sub", { n: goodCount })}</p>`
    : "";

  return `
    <section class="sect">
      ${sectionHeader(t("section.why"))}
      ${sub}
      <div class="addsup">
        <div class="addsup__head"><span class="mono">${t("why.addsUp")}</span>${scoreNumeral(
          score,
          { size: "s", score, cls: "addsup__score" },
        )}</div>
        <div class="addsup__bar">
          <span class="addsup__seg addsup__seg--base" style="width:${pct(base)}%"></span>
          <span class="addsup__seg addsup__seg--drama" style="width:${pct(drama)}%"></span>
          <span class="addsup__seg addsup__seg--clarity" style="width:${pct(clarity)}%"></span>
        </div>
        <div class="addsup__legend">
          <span><i class="dotc dotc--base"></i>${t("why.baseline")} ${base}</span>
          <span><i class="dotc dotc--drama"></i>${t("why.drama")} +${drama}</span>
          <span><i class="dotc dotc--clarity"></i>${t("why.clarity")} +${clarity}</span>
        </div>
      </div>
      <ul class="drivers is-collapsed" id="drivers">${cards}</ul>
      ${more}
      <p class="why-legend">
        <span class="why-legend__c why-legend__c--good"></span>${t("why.legendGood")}
        <span class="why-legend__c why-legend__c--neutral"></span>${t("why.legendNeutral")}
        <span class="why-legend__c why-legend__c--bad"></span>${t("why.legendBad")}
      </p>
      ${missing}
    </section>`;
}

/* "Tonight's arc": SVG area chart + forecast color swatch per hour. */
function areaChartSvg(timeline) {
  const W = 320;
  const H = 132;
  const padX = 14;
  const padTop = 26;
  const padBot = 22;
  const n = timeline.length;
  const x = (i) => padX + (i * (W - 2 * padX)) / Math.max(1, n - 1);
  const y = (s) => padTop + (1 - s / 100) * (H - padTop - padBot);
  const pts = timeline.map((c, i) => [x(i), y(c.score)]);

  // Smooth path (quadratics through midpoints).
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const mx = (px + cx) / 2;
    d += ` Q ${px} ${py} ${mx} ${(py + cy) / 2} T ${cx} ${cy}`;
  }
  const area = `${d} L ${pts[n - 1][0]} ${H - padBot} L ${pts[0][0]} ${H - padBot} Z`;

  const grid = [25, 50, 75]
    .map(
      (g) =>
        `<line x1="${padX}" x2="${W - padX}" y1="${y(g)}" y2="${y(g)}" class="arc__grid"/>`,
    )
    .join("");

  const dots = timeline
    .map((c, i) => {
      if (c.isCenter) return "";
      return `<circle cx="${pts[i][0]}" cy="${pts[i][1]}" r="4" class="arc__dot"/>`;
    })
    .join("");

  const ci = timeline.findIndex((c) => c.isCenter);
  const center = ci >= 0 ? pts[ci] : null;
  const guide = center
    ? `<line x1="${center[0]}" x2="${center[0]}" y1="${y(timeline[ci].score)}" y2="${
        H - padBot
      }" class="arc__guide"/>
       <circle cx="${center[0]}" cy="${center[1]}" r="10" class="arc__halo"/>
       <circle cx="${center[0]}" cy="${center[1]}" r="6" class="arc__mark"/>
       <text x="${center[0]}" y="${center[1] - 14}" class="arc__val">${timeline[ci].score}</text>`
    : "";

  const labels = timeline
    .map(
      (c, i) =>
        `<text x="${pts[i][0]}" y="${H - 6}" class="arc__x${
          c.isCenter ? " arc__x--center" : ""
        }">${fmtTime(c.time)}</text>`,
    )
    .join("");

  return `<svg viewBox="0 0 ${W} ${H}" class="arc" role="img" aria-label="${t(
    "section.trend",
    {
      when: t(state.event === "sunset" ? "when.sunset" : "when.sunrise"),
    },
  )}">
    <defs><linearGradient id="arcfill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-opacity="0.5"/>
      <stop offset="1" stop-opacity="0"/>
    </linearGradient></defs>
    ${grid}
    <path d="${area}" fill="url(#arcfill)"/>
    <path d="${d}" class="arc__line"/>
    ${dots}${guide}${labels}
  </svg>`;
}

function hourlyHtml({ timeline }, tw, event) {
  const swatches = timeline
    .map(
      (c) =>
        `<span class="trendsw${c.isCenter ? " trendsw--center" : ""}" style="background:${skyGradientCss(
          skyGradient(c.factors, c.score),
        )}"></span>`,
    )
    .join("");
  return `
    <section class="sect">
      ${sectionHeader(
        t("trend.arc", {
          when: t(state.event === "sunset" ? "when.sunset2" : "when.sunrise2"),
        }),
      )}
      <p class="sect__cap">${t("trend.hint", {
        when: t(state.event === "sunset" ? "when.sunset2" : "when.sunrise2"),
      })}</p>
      <div class="arc-card">${areaChartSvg(timeline)}</div>
      <div class="swatches">
        <span class="swatches__k mono">${t("trend.predicted")}</span>
        <div class="swatches__row">${swatches}</div>
      </div>
      ${lightChipsHtml(tw, event)}
    </section>`;
}

/* Golden/blue hour chips (reused in "Where to look" and the hourly trend). */
function lightChipsHtml(tw, event) {
  const fmtRange = (a, b) => (a && b ? `${fmtTime(a)}–${fmtTime(b)}` : "—");
  const goldenRange =
    event === "sunset"
      ? fmtRange(tw.golden, tw.event)
      : fmtRange(tw.event, tw.golden);
  const blueRange =
    event === "sunset"
      ? fmtRange(tw.event, tw.blue)
      : fmtRange(tw.blue, tw.event);
  return `<div class="chips">
        ${chip({ variant: "golden", label: t("light.golden"), value: goldenRange })}
        ${chip({ variant: "blue", label: t("light.blue"), value: blueRange })}
      </div>`;
}

/* "Where to look": compass + direction text + golden/blue hour chips. */
function lookAtHtml(sun, tw, event) {
  return `
    <section class="sect">
      ${sectionHeader(t("section.lookAt"))}
      <div class="lookat">
        ${compassSvg(sun.azimuth)}
        <div class="lookat__body">
          <p class="lookat__dir">${dirName(sun.azimuth)}, ${Math.round(sun.azimuth)}°</p>
          <p class="lookat__txt">${t("lookAt.text", {
            verb: t(event === "sunset" ? "verb.sets" : "verb.rises"),
            dir: dirName(sun.azimuth),
            deg: Math.round(sun.azimuth),
          })}</p>
        </div>
      </div>
      ${lightChipsHtml(tw, event)}
    </section>`;
}

/* "The point" (3d): mini-map + grid note + 2×2 Atmosphere grid. */
function pointHtml({ cond, phase, factors }) {
  const { place } = state;
  const grid = state.forecast;
  const gridNote =
    grid && Number.isFinite(grid.latitude)
      ? t("grid.note", {
          reqLat: place.latitude.toFixed(3),
          reqLon: place.longitude.toFixed(3),
          gLat: grid.latitude.toFixed(3),
          gLon: grid.longitude.toFixed(3),
        })
      : "";

  const atmo = (name, label, value, cap, accent = false) =>
    statCell({ icon: name, label, value, note: cap, noteAccent: accent });

  // Same thresholds explainScore() uses, so this caption can never contradict
  // the "why" cards.
  const aerosolTone =
    (factors?.aerosolHaze ?? 0) >= 0.5
      ? "bad"
      : (factors?.aerosolEnhance ?? 0) >= 0.6
        ? "good"
        : "neutral";
  const aerosolCard =
    cond.aerosol != null
      ? atmo(
          "haze",
          t("stat.aerosol"),
          `AOD ${cond.aerosol.toFixed(2)} · ${cond.pm25 != null ? Math.round(cond.pm25) + " µg" : "—"}`,
          t("atmo.aerosolCap." + aerosolTone),
          aerosolTone === "good",
        )
      : "";
  const horizonCard = Number.isFinite(grid?.elevation)
    ? atmo(
        "mountain",
        t("atmo.horizon"),
        `~${horizonDistanceKm(grid.elevation).toFixed(0)} km`,
        t("atmo.horizonCap", { m: Math.round(grid.elevation) }),
      )
    : "";

  return `
    <section class="sect">
      ${sectionHeader(t("section.point"))}
      ${mapEmbedHtml()}
      ${gridNote ? `<p class="gridnote mono">${gridNote}</p>` : ""}
      ${sectionHeader(t("section.atmosphere"), { variant: "mono", sub: true })}
      <div class="statgrid">
        ${aerosolCard}
        ${atmo("moon", t("stat.moon"), Math.round(moonIllumination(phase) * 100) + "%", t("moon." + moonPhaseName(phase)))}
        ${horizonCard}
        ${atmo("thermometer", t("stat.temp"), Math.round(cond.temperature) + "°C", t("atmo.tempCap." + state.event))}
      </div>
    </section>`;
}

/** Assemble the results screen and wire up the handlers. */
function renderResults(data, scored) {
  const { place, event } = data;
  const { eventDate, score, factors, sun } = data;
  const tw = twilightTimes(eventDate, place.latitude, place.longitude);

  // "Top sunset incoming" banner (best day ≥85 and not today).
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a), scored[0]);
  const bannerBest =
    best && best.score >= 85 && best.d.dayIndex >= 1 ? best : null;
  const bannerHtml = bannerBest
    ? `<button type="button" class="topbanner" id="topbanner">${icon("flame", {
        size: 18,
      })} <span>${t("banner.top", {
        noun: eventNoun(event),
        day: fmtWeekdayLong(best.date),
        score: best.score,
      })}</span></button>`
    : "";

  els.results.innerHTML = `
    ${heroHtml(data)}
    <div class="rcontent">
      ${bannerHtml}
      ${introHtml(data)}
      ${eventToggleHtml()}
      ${weekRibbonHtml(scored, bannerBest ? bannerBest.d.dayIndex : null)}
      <div class="rcol rcol--a">
        ${whyHtml(data)}
        ${lookAtHtml(sun, tw, event)}
        ${pointHtml(data)}
      </div>
      <div class="rcol rcol--b">
        ${hourlyHtml(data, tw, event)}
        ${conditionsHtml(data.cond)}
        ${spotsSectionHtml(place, sun, data.factors)}
      </div>
      <footer class="rfoot"><p data-i18n-html="foot.credits">${t("foot.credits")}</p></footer>
    </div>`;

  // --- Handler ---
  // Back to the home (new search / change place).
  els.results.querySelector("#rhero-loc")?.addEventListener("click", showHome);
  els.results
    .querySelector("#rhero-search")
    ?.addEventListener("click", () => showHome(true));
  els.results
    .querySelector("#rhero-share")
    ?.addEventListener("click", () => openShareSheet(data));

  // "More options" menu (theme + language), mirrored from the home.
  const resMenu = els.results.querySelector(".menu");
  if (resMenu) bindMoreMenu(resMenu);

  // Favorite (star in the hero).
  const favBtn = els.results.querySelector(".fav-toggle");
  if (favBtn) {
    favBtn.classList.toggle("fav-toggle--on", isFavorite(place));
    favBtn.addEventListener("click", () => {
      const saved = toggleFavorite(place);
      favBtn.innerHTML = icon("star", { size: 17, fill: saved });
      favBtn.classList.toggle("fav-toggle--on", saved);
      favBtn.setAttribute("aria-pressed", String(saved));
      renderFavorites();
    });
  }

  // Sunrise/sunset toggle (compact variant in the results).
  bindModes(els.results);

  // Banner → jump to the best day.
  els.results.querySelector("#topbanner")?.addEventListener("click", () => {
    state.dayIndex = best.d.dayIndex;
    render();
  });

  // Week ribbon → switch day.
  els.results.querySelectorAll(".wk__col").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.dayIndex = Number(btn.dataset.day);
      render();
    });
  });

  // "Show all" factors.
  const whyMore = els.results.querySelector("#why-more");
  const drivers = els.results.querySelector("#drivers");
  if (whyMore && drivers) {
    whyMore.addEventListener("click", () => {
      const collapsed = drivers.classList.toggle("is-collapsed");
      whyMore.textContent = collapsed
        ? whyMore.dataset.more
        : whyMore.dataset.less;
    });
  }

  // "Search unmapped points too".
  const scanBtn = els.results.querySelector(".scan-btn");
  if (scanBtn) scanBtn.addEventListener("click", scanCoordinates);

  // "See all points".
  const spotsMore = els.results.querySelector("#spots-more");
  const spotsList = els.results.querySelector("#spots-list");
  if (spotsMore && spotsList) {
    spotsMore.addEventListener("click", () => {
      const collapsed = spotsList.classList.toggle("is-collapsed");
      spotsMore.textContent = collapsed
        ? spotsMore.dataset.more
        : spotsMore.dataset.less;
    });
  }

  // Context for the big map (refreshed on every render).
  const mapCtx = {
    lat: place.latitude,
    lon: place.longitude,
    azimuth: sun.azimuth,
    score,
    event,
    visibility: data.cond.visibility,
    spots: Array.isArray(state.spots) ? state.spots : [],
  };
  lastMapContext = mapCtx;
  els.results
    .querySelector("#open-bigmap")
    ?.addEventListener("click", openBigMap);

  mountMiniMap(els.results.querySelector("#detail-map"), {
    ...mapCtx,
    onExpand: openBigMap,
  }).catch((err) => console.warn("Mini-map not available:", err));

  els.results.scrollTop = 0;
}

// Last known map context (current place/event/day): the big map
// reads it from window.skyhueMapContext when opened.
let lastMapContext = null;

/** Open the in-app big map with the current context (all points marked). */
function openBigMap() {
  if (lastMapContext) window.skyhueMapContext = lastMapContext;
  location.hash = "#map";
}

/** Build a shareable link to the current state (place + event). */
function buildShareUrl() {
  const { place, event } = state;
  const url = new URL(location.origin + location.pathname);
  url.searchParams.set("lat", place.latitude.toFixed(4));
  url.searchParams.set("lon", place.longitude.toFixed(4));
  url.searchParams.set("label", place.label);
  url.searchParams.set("event", event);
  return url.toString();
}

/** Share via the Web Share API, falling back to clipboard copy. */
async function shareCurrent(score) {
  const url = buildShareUrl();
  const text = t("share.text", {
    noun: eventNoun(state.event),
    score,
    label: state.place.label,
  });
  try {
    if (navigator.share) {
      await navigator.share({ title: "SkyHue", text, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    setStatus(t("status.linkCopied"), "info");
  } catch {
    // Last resort: show the URL in the status bar.
    setStatus(url, "info");
  }
}

/** Fonts for the share canvas: same families as the app (with
 *  system fallbacks), so the PNG mirrors the brand identity. */
const IMG_DISPLAY = "'Bricolage Grotesque', system-ui, sans-serif";
const IMG_UI = "'Space Grotesk', system-ui, -apple-system, sans-serif";
const IMG_MONO = "'JetBrains Mono', ui-monospace, monospace";

/** Draw an `icons.js` icon on the canvas (stroke, like in the app): no
 *  system emoji, identical rendering everywhere. */
function drawCanvasIcon(ctx, name, x, y, size, color) {
  const body = ICONS[name] || ICONS.help;
  const ds = [...body.matchAll(/d="([^"]+)"/g)].map((m) => m[1]);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.9;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const d of ds) ctx.stroke(new Path2D(d));
  ctx.restore();
}

/**
 * Generate an image (canvas) with the Sunset Score, place, time and sun
 * direction, over the expected sky gradient, and share it (Web Share API
 * with a file) or download it as a fallback. No external dependencies.
 */
async function shareImage({
  place,
  score,
  factors,
  eventDate,
  event,
  sun,
  download = false,
}) {
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Background: expected sky gradient (same stops as the preview).
  const stops = skyGradient(factors, score);
  const hsl = (s) => `hsl(${s.h} ${s.s}% ${s.l}%)`;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, hsl(stops[0]));
  g.addColorStop(0.55, hsl(stops[1]));
  g.addColorStop(0.8, hsl(stops[2]));
  g.addColorStop(1, hsl(stops[3]));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const noun = eventNoun(event);

  // Ensure the webfonts before drawing, so the PNG uses Bricolage/Space
  // Grotesk like the app (falls back to system fonts if loading fails).
  try {
    if (document.fonts) {
      await Promise.all([
        document.fonts.load('800 330px "Bricolage Grotesque"'),
        document.fonts.load('700 66px "Bricolage Grotesque"'),
        document.fonts.load('600 46px "Bricolage Grotesque"'),
        document.fonts.load('600 54px "Space Grotesk"'),
        document.fonts.load('400 40px "Space Grotesk"'),
        document.fonts.load('400 34px "JetBrains Mono"'),
      ]);
    }
  } catch {
    /* continue with system fonts */
  }

  // Brand: "sunset" icon + SkyHue wordmark (no system emoji),
  // centered as in the preview.
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = `600 46px ${IMG_DISPLAY}`;
  const brand = "SkyHue";
  const brandIco = 42;
  const brandGap = 16;
  const brandW = brandIco + brandGap + ctx.measureText(brand).width;
  const brandX = (W - brandW) / 2;
  drawCanvasIcon(ctx, "sunset", brandX, 62, brandIco, "rgba(255,255,255,0.92)");
  ctx.fillText(brand, brandX + brandIco + brandGap, 96);
  ctx.textAlign = "center";

  // Same soft shadow as the preview: numeral readable on light gradients.
  ctx.save();
  ctx.shadowColor = "rgba(60,10,20,0.4)";
  ctx.shadowBlur = 54;
  ctx.shadowOffsetY = 9;
  ctx.fillStyle = "#fff";
  ctx.font = `800 330px ${IMG_DISPLAY}`;
  ctx.fillText(String(score), W / 2, H / 2 + 30);
  ctx.restore();

  ctx.font = `700 66px ${IMG_DISPLAY}`;
  ctx.fillText(t("label." + scoreLabel(score)), W / 2, H / 2 + 150);

  // Place (shrink the font if too wide).
  let labelSize = 54;
  ctx.font = `600 ${labelSize}px ${IMG_UI}`;
  while (ctx.measureText(place.label).width > W - 120 && labelSize > 28) {
    labelSize -= 3;
    ctx.font = `600 ${labelSize}px ${IMG_UI}`;
  }
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.fillText(place.label, W / 2, H - 250);

  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = `400 40px ${IMG_UI}`;
  ctx.fillText(
    t("share.imgTime", {
      noun,
      time: fmtTime(eventDate),
      day: fmtDay(eventDate),
    }),
    W / 2,
    H - 185,
  );
  ctx.fillText(
    `${t("stat.direction")}: ${cardinal(azimuthToCardinal(sun.azimuth))} (${Math.round(sun.azimuth)}°)`,
    W / 2,
    H - 135,
  );

  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = `400 34px ${IMG_MONO}`;
  ctx.fillText("nocfer.github.io/skyhue", W / 2, H - 64);

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) {
    setStatus(t("status.imgError"), "error");
    return;
  }
  const file = new File([blob], "skyhue.png", { type: "image/png" });
  const text = t("share.text", { noun, score, label: place.label });
  try {
    if (
      !download &&
      navigator.canShare &&
      navigator.canShare({ files: [file] })
    ) {
      await navigator.share({ files: [file], title: "SkyHue", text });
      return;
    }
  } catch {
    /* share canceled or failed: fall back to the download */
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "skyhue.png";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  setStatus(t("status.imgSaved"), "info");
}

/** "Share" sheet (2d): 4:5 sky preview + share/save/link actions. */
function openShareSheet(data) {
  const { place, score, factors, eventDate, event, sun } = data;
  const noun = eventNoun(event);
  const skyCss = skyGradientCss(skyGradient(factors, score));
  const label = t("label." + scoreLabel(score));
  const dir = cardinal(azimuthToCardinal(sun.azimuth));
  const overlay = document.createElement("div");
  overlay.className = "sheet-scrim";
  overlay.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true">
      <span class="sheet__handle" aria-hidden="true"></span>
      <h2 class="sheet__title display">${t("share.title." + event)}</h2>
      <div class="sharecard" style="background:${skyCss}">
        <div class="grain" aria-hidden="true"></div>
        <span class="sharecard__brand">${icon("sunset", { size: 15 })} SkyHue</span>
        ${scoreNumeral(score, { size: "xl", color: "#fff", cls: "sharecard__score" })}
        <span class="sharecard__label display">${label}</span>
        <div class="sharecard__foot">
          <strong>${escapeHtml(place.label)}</strong>
          <span>${noun} ${fmtTime(eventDate)} · ${dir} ${Math.round(sun.azimuth)}°</span>
        </div>
      </div>
      ${button(t("share.image"), { variant: "primary", icon: "share", iconSize: 18, id: "sh-share", cls: "sheet__primary" })}
      <div class="sheet__row">
        ${button(t("share.save"), { variant: "ghost", id: "sh-save", cls: "sheet__ghost" })}
        ${button(t("share.copy"), { variant: "ghost", id: "sh-copy", cls: "sheet__ghost" })}
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  overlay
    .querySelector("#sh-share")
    .addEventListener("click", () =>
      shareImage({ place, score, factors, eventDate, event, sun }),
    );
  overlay
    .querySelector("#sh-save")
    .addEventListener("click", () =>
      shareImage({
        place,
        score,
        factors,
        eventDate,
        event,
        sun,
        download: true,
      }),
    );
  const copyBtn = overlay.querySelector("#sh-copy");
  copyBtn.addEventListener("click", async () => {
    await shareCurrent(score);
    copyBtn.textContent = t("status.linkCopied");
    setTimeout(() => {
      copyBtn.textContent = t("share.copy");
    }, 1600);
  });
}

/** Draw the favorite place cards (home): swatch + name + time + score.
 *  Scores/times are filled in asynchronously so they don't block the render. */
function renderFavorites() {
  const favs = getFavorites();
  const places = document.getElementById("places");
  if (places) places.hidden = favs.length === 0;

  els.favorites.innerHTML =
    favs
      .map(
        (f) => `
      <div class="place" role="button" tabindex="0" data-id="${f.id}">
        ${skySwatch({ size: "md" })}
        <span class="place__body">
          <span class="place__name">${escapeHtml(f.label)}</span>
          <span class="place__when" data-when>${t("fav.calc")}</span>
        </span>
        <span class="place__scorebox">
          <span class="score score--m place__score" data-score>—</span>
          <span class="place__word" data-word></span>
        </span>
        <button class="place__del" data-del="${f.id}" title="${t("fav.remove")}" aria-label="${t(
          "fav.remove",
        )}">×</button>
      </div>`,
      )
      .join("") +
    (favs.length >= 2
      ? `<button type="button" class="place-compare" id="fav-compare">${icon(
          "compass",
          {
            size: 15,
          },
        )} ${t("fav.compare")}</button>`
      : "");

  const load = (id) => {
    const f = getFavorites().find((x) => x.id === id);
    if (f)
      analyze({ latitude: f.latitude, longitude: f.longitude, label: f.label });
  };
  els.favorites.querySelectorAll(".place").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-del]")) return;
      load(card.dataset.id);
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        load(card.dataset.id);
      }
    });
  });
  els.favorites.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeFavorite(btn.dataset.del);
      renderFavorites();
    });
  });
  const cmp = els.favorites.querySelector("#fav-compare");
  if (cmp) cmp.addEventListener("click", compareFavorites);

  enrichFavoriteCards(favs);
}

/** Fill the favorite cards with score + time of the current event. */
async function enrichFavoriteCards(favs) {
  await Promise.all(
    favs.map(async (f) => {
      try {
        const fc = await fetchForecast(f.latitude, f.longitude);
        const ne = nextSunset(fc, new Date());
        const iso = state.event === "sunset" ? ne.sunset : ne.sunrise;
        const cond = conditionsAtTime(fc, iso);
        const { score, factors } = computeSunsetScore(cond);
        const el = els.favorites.querySelector(
          `.place[data-id="${CSS.escape(f.id)}"]`,
        );
        if (!el) return;
        const sc = el.querySelector("[data-score]");
        const wh = el.querySelector("[data-when]");
        if (sc) {
          sc.textContent = score;
          sc.style.setProperty("--hue", scoreHue(score));
          sc.classList.add("is-set");
          sc.title = t("label." + scoreLabel(score));
        }
        // Swatch with the place's forecast sky gradient + label word.
        const sw = el.querySelector(".swatch");
        if (sw)
          sw.style.background = skyGradientCss(skyGradient(factors, score));
        const word = el.querySelector("[data-word]");
        if (word) word.textContent = t("label." + scoreLabel(score));
        if (wh) {
          const d = new Date(iso);
          const when =
            state.event === "sunset" && isToday(d)
              ? t("time.tonight")
              : fmtWeekdayShort(d);
          wh.textContent = `${when} · ${eventNoun(state.event)} ${fmtTime(d)}`;
        }
      } catch {
        /* leave the placeholder */
      }
    }),
  );
}

/**
 * Compare the favorites for the current event (next sunset/sunrise): fetch
 * each one's weather, compute the Sunset Score and show them sorted in a
 * modal. No per-point aerosol (fewer calls): a purely weather comparison.
 */
async function compareFavorites() {
  const favs = getFavorites();
  if (favs.length < 2) return;
  const noun = eventNoun(state.event);
  const overlay = document.createElement("div");
  overlay.className = "cmp";
  overlay.innerHTML = `
    <div class="cmp__box">
      <header class="cmp__header">
        <div>
          <h2 class="cmp__title display">${t("cmp.heading")}</h2>
          <p class="cmp__sub">${t("cmp.sub." + state.event)}</p>
        </div>
        <button class="cmp__close gcircle" aria-label="${t("cmp.close")}">×</button>
      </header>
      <div class="cmp__list"><p class="cmp__calc">${t("cmp.calc")}</p></div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector(".cmp__close").addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  const rows = await Promise.all(
    favs.map(async (f) => {
      try {
        const fc = await fetchForecast(f.latitude, f.longitude);
        const ne = nextSunset(fc, new Date());
        const iso = state.event === "sunset" ? ne.sunset : ne.sunrise;
        const cond = conditionsAtTime(fc, iso);
        const { score, factors } = computeSunsetScore(cond);
        return { label: f.label, score, factors, time: new Date(iso) };
      } catch (err) {
        return { label: f.label, score: null, time: null };
      }
    }),
  );
  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  const when = (r) => (r.time ? `${noun} ${fmtTime(r.time)}` : t("cmp.na"));
  // Swatch with each place's forecast sky (mock 2c).
  const rowGrad = (r) =>
    r.factors && r.score != null
      ? skyGradientCss(skyGradient(r.factors, r.score))
      : "";

  const list = overlay.querySelector(".cmp__list");
  if (!list) return;

  const [winner, ...rest] = rows;
  const winnerHtml =
    winner && winner.score != null
      ? `<div class="cmp__winner" style="--hue:${scoreHue(winner.score)}">
          <span class="cmp__best">${icon("star", { size: 13, fill: true })} ${t("cmp.best")}</span>
          <div class="cmp__winrow">
            ${skySwatch({ size: "lg", grad: rowGrad(winner) })}
            <div class="cmp__wininfo">
              <strong>${escapeHtml(winner.label)}</strong>
              <span class="cmp__time">${when(winner)}</span>
            </div>
            <div class="cmp__winscore">
              ${scoreNumeral(winner.score, { size: "l", score: winner.score, cls: "cmp__bignum" })}
              <span class="cmp__label">${t("label." + scoreLabel(winner.score))}</span>
            </div>
          </div>
        </div>`
      : "";

  const rowsHtml = rest
    .map(
      (r, i) => `
      <div class="cmp__row">
        <span class="cmp__rank mono">${i + 2}</span>
        ${skySwatch({ size: "sm", grad: rowGrad(r) })}
        <div class="cmp__rowinfo">
          <strong>${escapeHtml(r.label)}</strong>
          <span class="cmp__time">${when(r)}</span>
        </div>
        ${scoreNumeral(r.score ?? "—", { size: "m", score: r.score ?? undefined, cls: "cmp__score" })}
      </div>`,
    )
    .join("");

  list.innerHTML = `${winnerHtml}${rowsHtml}<p class="cmp__foot">${t("cmp.foot." + state.event)}</p>`;
}

// --- UI events -------------------------------------------------------------

/** Readable label ("City, Region, Country") from a geocoder match. */
function matchLabel(m) {
  return [m.name, m.admin1, m.country].filter(Boolean).join(", ");
}

function matchToPlace(m) {
  return { latitude: m.latitude, longitude: m.longitude, label: matchLabel(m) };
}

// Place chosen from a suggestion: the label shown in the input
// ("City, Region, Country") can't be re-geocoded, so on submit we
// reuse its coordinates directly until the user edits the text.
let chosenPlace = null;

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = els.input.value.trim();
  if (!query) return;
  closeSuggest();
  // If the text still matches the chosen suggestion, use it as is.
  if (chosenPlace && chosenPlace.label === query) {
    await analyze(chosenPlace);
    return;
  }
  setStatus(t("status.searching"), "info");
  try {
    const matches = await geocode(query, 5, getLang());
    if (matches.length === 0) {
      setStatus(t("status.noResults"), "error");
      return;
    }
    await analyze(matchToPlace(matches[0]));
  } catch (err) {
    setStatus(t("status.error", { msg: err.message }), "error");
  }
});

// --- Search-bar autocomplete --------------------------------------------
// As the user types, we query the geocoder (debounced) and show the
// results in a list navigable by mouse and keyboard. Submit keeps
// working (first result) even without touching the suggestions.

const suggest = { matches: [], active: -1, seq: 0, open: false };
let suggestTimer = null;

/** Minimal escape: names come from an external API and end up in innerHTML. */
function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

function updateSuggestAria() {
  els.suggest.setAttribute("aria-label", t("search.suggestAria"));
}

function closeSuggest() {
  suggest.open = false;
  suggest.matches = [];
  suggest.active = -1;
  els.suggest.hidden = true;
  els.suggest.innerHTML = "";
  els.input.setAttribute("aria-expanded", "false");
  els.input.removeAttribute("aria-activedescendant");
}

function showSuggest(matches) {
  if (!matches.length) {
    closeSuggest();
    return;
  }
  suggest.matches = matches;
  suggest.active = -1;
  els.suggest.innerHTML = matches
    .map((m, i) => {
      const meta = [m.admin1, m.country].filter(Boolean).join(", ");
      return `<li class="suggest__item" role="option" id="suggest-opt-${i}" data-i="${i}" aria-selected="false">
        <span class="suggest__name">${escapeHtml(m.name)}</span>
        ${meta ? `<span class="suggest__meta">${escapeHtml(meta)}</span>` : ""}
      </li>`;
    })
    .join("");
  els.suggest.hidden = false;
  suggest.open = true;
  els.input.setAttribute("aria-expanded", "true");
  els.input.removeAttribute("aria-activedescendant");
}

function moveActive(delta) {
  const n = suggest.matches.length;
  if (!n) return;
  suggest.active = (suggest.active + delta + n) % n;
  const items = els.suggest.querySelectorAll(".suggest__item");
  items.forEach((li, i) => {
    const on = i === suggest.active;
    li.classList.toggle("suggest__item--active", on);
    li.setAttribute("aria-selected", String(on));
  });
  els.input.setAttribute(
    "aria-activedescendant",
    `suggest-opt-${suggest.active}`,
  );
  items[suggest.active]?.scrollIntoView({ block: "nearest" });
}

function chooseSuggest(i) {
  const m = suggest.matches[i];
  if (!m) return;
  const place = matchToPlace(m);
  els.input.value = place.label;
  chosenPlace = place; // so the next submit doesn't re-geocode the label
  closeSuggest();
  analyze(place);
}

async function querySuggest(query) {
  const seq = ++suggest.seq;
  try {
    const matches = await geocode(query, 6, getLang());
    if (seq !== suggest.seq) return; // a newer request has arrived
    showSuggest(matches);
  } catch {
    if (seq === suggest.seq) closeSuggest();
  }
}

els.input.addEventListener("input", () => {
  const q = els.input.value.trim();
  chosenPlace = null; // the user is editing: the previous selection no longer applies
  clearTimeout(suggestTimer);
  if (q.length < 2) {
    suggest.seq++; // invalidate any in-flight requests
    closeSuggest();
    return;
  }
  suggestTimer = setTimeout(() => querySuggest(q), 220);
});

els.input.addEventListener("keydown", (e) => {
  if (!suggest.open) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    moveActive(1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    moveActive(-1);
  } else if (e.key === "Enter" && suggest.active >= 0) {
    e.preventDefault(); // pick the suggestion instead of submitting the form
    chooseSuggest(suggest.active);
  } else if (e.key === "Escape") {
    closeSuggest();
  }
});

// pointerdown (not click) so the pick fires before the input loses focus, and
// on touch too: `mousedown` is only synthesized inconsistently from a tap, so
// on mobile the suggestion often never registered.
els.suggest.addEventListener("pointerdown", (e) => {
  const li = e.target.closest(".suggest__item");
  if (!li) return;
  e.preventDefault();
  chooseSuggest(Number(li.dataset.i));
});

els.input.addEventListener("blur", () => {
  setTimeout(closeSuggest, 120);
});

els.geoBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    setStatus(t("status.geoUnsupported"), "error");
    return;
  }
  setStatus(t("status.geolocating"), "info");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      analyze({
        latitude,
        longitude,
        label: `${t("geo.here")} (${coordsLabel(latitude, longitude)})`,
        isGeo: true,
      });
    },
    (err) =>
      setStatus(t("status.geoUnavailable", { msg: err.message }), "error"),
  );
});

// Home sunrise / sunset selector. The compact toggles in the results are
// wired in renderResults() on every render.
const homeEl = document.getElementById("home");
if (homeEl) bindModes(homeEl);

// "More options" menu (theme + language). The same markup lives on the home
// and in the results hero, so it is built from one helper and each instance is
// wired independently; rows read "Label: current value" (see moreMenuHtml).
const LANG_ENDONYM = { en: "English", it: "Italiano" };

/** Markup for the menu button + popup. Values reflect the CURRENT setting. */
function moreMenuHtml() {
  const light = document.documentElement.dataset.theme === "light";
  const themeVal = light ? t("menu.themeLight") : t("menu.themeDark");
  const langVal = LANG_ENDONYM[getLang()] || getLang();
  return `
    <button type="button" class="gcircle more-btn" aria-haspopup="true" aria-expanded="false" aria-label="${t(
      "menu.aria",
    )}">${icon("dots", { size: 18 })}</button>
    <div class="menu__pop more-menu" role="menu" hidden>
      <button type="button" class="menu__item lang-toggle" role="menuitem" aria-label="${t("lang.aria")}">
        ${icon("globe", { size: 16, cls: "menu__ico" })}
        <span class="menu__label">${t("menu.langLabel")}</span>
        <span class="menu__value">${langVal}</span>
      </button>
      <button type="button" class="menu__item theme-toggle" role="menuitem" aria-label="${t("theme.aria")}">
        ${icon(light ? "sun" : "moon", { size: 16, cls: "menu__ico" })}
        <span class="menu__label">${t("menu.themeLabel")}</span>
        <span class="menu__value">${themeVal}</span>
      </button>
    </div>`;
}

/** Close every open menu instance (home + results). */
function closeAllMenus() {
  document.querySelectorAll(".more-menu").forEach((pop) => {
    pop.hidden = true;
  });
  document
    .querySelectorAll(".more-btn")
    .forEach((b) => b.setAttribute("aria-expanded", "false"));
}

/** Wire one menu instance (a `.menu` root): open/close + the two toggles. */
function bindMoreMenu(root) {
  const btn = root.querySelector(".more-btn");
  const pop = root.querySelector(".more-menu");
  if (!btn || !pop) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = pop.hidden;
    closeAllMenus();
    pop.hidden = !willOpen;
    btn.setAttribute("aria-expanded", String(willOpen));
  });
  // Picking an entry closes the menu: otherwise it stays open and the click
  // seems to have had no effect.
  pop
    .querySelectorAll(".menu__item")
    .forEach((item) => item.addEventListener("click", closeAllMenus));
  root.querySelector(".theme-toggle")?.addEventListener("click", toggleTheme);
  root.querySelector(".lang-toggle")?.addEventListener("click", toggleLanguage);
}

// Outside click / Escape closes any open menu (bound once).
document.addEventListener("click", (e) => {
  if (!e.target.closest(".menu")) closeAllMenus();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAllMenus();
});

/** On startup, if the URL contains a shared place, open it. */
function initFromUrl() {
  const p = new URLSearchParams(location.search);
  const lat = parseFloat(p.get("lat"));
  const lon = parseFloat(p.get("lon"));
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    const event = p.get("event") === "sunrise" ? "sunrise" : "sunset";
    state.event = event;
    document
      .querySelectorAll(".mode")
      .forEach((b) =>
        b.classList.toggle("mode--active", b.dataset.event === event),
      );
    const label = p.get("label") || coordsLabel(lat, lon);
    analyze({ latitude: lat, longitude: lon, label });
  }
}

// A point picked on the map requests the full analysis: we run it here.
window.addEventListener("skyhue:analyze", (e) => analyze(e.detail));

// Refresh the theme row (icon + value) on every menu instance. Both describe
// the CURRENT theme, so there is no "is this the state or the action?" ambiguity.
function updateThemeToggle() {
  const light = document.documentElement.dataset.theme === "light";
  const value = light ? t("menu.themeLight") : t("menu.themeDark");
  document.querySelectorAll(".theme-toggle").forEach((b) => {
    const ico = b.querySelector(".menu__ico");
    if (ico)
      ico.outerHTML = icon(light ? "sun" : "moon", {
        size: 16,
        cls: "menu__ico",
      });
    const v = b.querySelector(".menu__value");
    if (v) v.textContent = value;
  });
}

// Light/dark theme toggle (the theme is already applied in <head> before paint).
function toggleTheme() {
  const next =
    document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("skyhue.theme", next);
  } catch (e) {
    /* storage unavailable */
  }
  updateThemeToggle();
  // Notify the map so it can swap the light/dark tiles with the theme.
  window.dispatchEvent(new CustomEvent("skyhue:themechange", { detail: next }));
}

// IT/EN language toggle: update the dictionary, the static texts and re-render.
function toggleLanguage() {
  setLang(getLang() === "en" ? "it" : "en");
  document.documentElement.lang = getLang();
  applyStaticI18n();
  mountHomeMenu(); // rebuild the home menu (labels/value) in the new language
  updateSuggestAria();
  renderFavorites();
  // The "your position" text was translated only once, at geolocation
  // time: it must be regenerated in the new language before re-rendering.
  if (state.place?.isGeo) {
    state.place.label = `${t("geo.here")} (${coordsLabel(state.place.latitude, state.place.longitude)})`;
  }
  // Re-render the current result, if any (this rebuilds its menu too).
  if (state.forecast && state.place) render();
  // Refresh the map panel if open.
  window.dispatchEvent(
    new CustomEvent("skyhue:langchange", { detail: getLang() }),
  );
}

/** Build + wire the home menu (called at startup and after a language switch). */
function mountHomeMenu() {
  const slot = document.getElementById("home-menu");
  if (!slot) return;
  slot.innerHTML = moreMenuHtml();
  bindMoreMenu(slot);
}

// Startup: language, static texts, the home menu, favorites and shared link.
initLang();
document.documentElement.lang = getLang();
applyStaticI18n();
mountHomeMenu();
updateSuggestAria();
renderFavorites();
initFromUrl();
