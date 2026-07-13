import {
  fetchForecast,
  fetchAirQuality,
  airAtTime,
  conditionsAtTime,
  conditionsWindow,
  nextSunset,
  dailyList,
  coordsLabel,
} from "./api.js";
import { computeSunsetScore, explainScore } from "./score.js";
import { fetchLightPath, lightPathClearAt } from "./lightpath.js";
import {
  sunPosition,
  azimuthToCardinal,
  moonPhase,
  twilightTimes,
} from "./astronomy.js";
import { isFavorite, toggleFavorite } from "./store.js";
import { icon } from "./icons.js";
import { mountMiniMap } from "./map.js";
import { t, initLang, getLang, setLang, applyStaticI18n } from "./i18n.js";
import {
  fetchSunsetSpots,
  distanceKm,
  bearing,
  destinationPoint,
  SAMPLE_DISTANCES,
  evaluateHorizon,
  spotVerdict,
  fetchElevations,
  angleDiff,
  driveMinutes,
  gridCandidates,
  prescoreGrid,
  reverseGeocode,
} from "./spots.js";
import {
  state,
  els,
  update,
  subscribe,
  SPOTS_EVALUATE,
  SPOTS_SHOW,
  SPOTS_SKY,
  NEAR_KM,
} from "./state.js";
import { setStatus, eventNoun, fmtWeekdayLong } from "./format.js";
import {
  spotsSectionHtml,
  heroHtml,
  introHtml,
  eventToggleHtml,
  weekRibbonHtml,
  conditionsHtml,
  whyHtml,
  hourlyHtml,
  lookAtHtml,
  pointHtml,
  moreMenuHtml,
} from "./views.js";
import { openShareSheet } from "./share.js";
import { renderFavorites } from "./favorites.js";
import { updateSuggestAria } from "./suggest.js";

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
    window.skyhueLastPlace = {
      latitude: place.latitude,
      longitude: place.longitude,
    };
    update({
      place,
      forecast,
      air,
      dayIndex,
      spots: null,
      spotsError: false,
      estimatedSpots: null,
      estimating: false,
      estimateError: false,
      lightPath: null,
    });
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
    update({ rawSpots: raw, rawSpotsFor: place });
    await evaluateSpots();
  } catch (err) {
    console.warn("Scenic spots not available:", err);
    if (state.place !== place) return;
    update({ spotsError: true });
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
  update({
    lightPath: { status: "loading", place, event, azimuth: null, data: null },
  });
  try {
    const azimuth = currentAzimuth();
    const data = await fetchLightPath(place.latitude, place.longitude, azimuth);
    if (state.place !== place || state.event !== event) return; // superseded
    const valid = data.points.filter((p) => p.forecast).length;
    update({
      lightPath:
        valid >= 2
          ? { status: "ready", place, event, azimuth, data }
          : { status: "error", place, event, azimuth, data: null },
    });
  } catch (err) {
    console.warn("Light path not available:", err);
    if (state.place !== place || state.event !== event) return;
    update({
      lightPath: { status: "error", place, event, azimuth: null, data: null },
    });
  }
}

/** Light-path clearness (0-1) at the ISO instant, or null if the samples
 *  aren't available (yet) → score without this factor. */
function pathClearAt(iso) {
  const lp = state.lightPath;
  if (lp?.status !== "ready" || lp.place !== state.place) return null;
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
    update({ spots: [] });
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
  update({ spots: evaluated });

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
  update({ estimating: true, estimateError: false });
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
    update({
      estimatedSpots: evaluated.slice(0, SPOTS_SHOW),
      estimating: false,
    });
    loadSky(state.estimatedSpots, place);
    nameEstimatedSpots(state.estimatedSpots, place);
  } catch (err) {
    console.warn("Coordinate scan failed:", err);
    if (state.place !== place) return;
    update({ estimating: false, estimateError: true });
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
    } catch {
      /* keeps the "estimated point" name */
    }
  }
  if (state.place !== place) return;
  update(); // names were mutated in place on the spot objects — just redraw
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
  update(); // scores/order mutated in place on the spot objects — just redraw
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

/** Show the home (no place). If focusSearch, move the cursor into the
 *  search bar (used by the "search" button in the results hero).
 *  This is a render function — `render()` calls it when there is no forecast —
 *  so it resets `state` directly rather than via `update()`, which would
 *  re-enter the notify cycle it is already running inside. */
function showHome(focusSearch) {
  state.forecast = null;
  state.place = null;
  state.spots = null;
  state.rawSpots = null;
  els.results.hidden = true;
  els.results.innerHTML = "";
  const home = document.getElementById("home");
  if (home) home.hidden = false;
  updateHomeTagline(); // event may have changed while on the results screen
  renderFavorites();
  window.scrollTo(0, 0);
  if (focusSearch === true) setTimeout(() => els.input?.focus(), 50);
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
  // The azimuth changes a lot between sunrise and sunset: re-rate the spots'
  // outlook and resample the light path (nearly opposite ray).
  const reSpots = state.rawSpots && state.rawSpotsFor === state.place;
  const patch = { event: ev, lightPath: null };
  if (reSpots) {
    patch.spots = null;
    patch.spotsError = false;
  }
  // Notifies → render(): a results redraw, or the home via showHome() (which
  // itself refreshes the tagline + favorites' scores for the new event).
  update(patch);
  document.querySelectorAll(".mode").forEach((/** @type {HTMLElement} */ b) => {
    b.classList.toggle("mode--active", b.dataset.event === ev);
  });
  if (state.forecast) loadLightPath(state.place); // usually a cache hit: instant
  if (reSpots) evaluateSpots();
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

/** Assemble the results screen and wire up the handlers. */
function renderResults(data, scored) {
  const { place, event, eventDate, sun } = data;
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

  bindResultsHandlers(data, best);
  els.results.scrollTop = 0;
}

/** Wire up the handlers for the just-rendered results screen. */
function bindResultsHandlers(data, best) {
  const { place, event, score, sun } = data;

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
    update({ dayIndex: best.d.dayIndex });
  });

  // Week ribbon → switch day.
  els.results
    .querySelectorAll(".wk__col")
    .forEach((/** @type {HTMLElement} */ btn) => {
      btn.addEventListener("click", () => {
        update({ dayIndex: Number(btn.dataset.day) });
      });
    });

  // "Show all" factors.
  const whyMore = /** @type {HTMLElement} */ (
    els.results.querySelector("#why-more")
  );
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
  const spotsMore = /** @type {HTMLElement} */ (
    els.results.querySelector("#spots-more")
  );
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
}

// Last known map context (current place/event/day): the big map
// reads it from window.skyhueMapContext when opened.
let lastMapContext = null;

/** Open the in-app big map with the current context (all points marked). */
function openBigMap() {
  if (lastMapContext) window.skyhueMapContext = lastMapContext;
  location.hash = "#map";
}

// Home sunrise / sunset selector. The compact toggles in the results are
// wired in renderResults() on every render.
const homeEl = document.getElementById("home");
if (homeEl) bindModes(homeEl);

/** Close every open menu instance (home + results). */
function closeAllMenus() {
  document
    .querySelectorAll(".more-menu")
    .forEach((/** @type {HTMLElement} */ pop) => {
      pop.hidden = true;
    });
  document.querySelectorAll(".more-btn").forEach((b) => {
    b.setAttribute("aria-expanded", "false");
  });
}

/** Wire one menu instance (a `.menu` root): open/close + the two toggles. */
function bindMoreMenu(root) {
  const btn = root.querySelector(".more-btn");
  const pop = /** @type {HTMLElement} */ (root.querySelector(".more-menu"));
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
  pop.querySelectorAll(".menu__item").forEach((item) => {
    item.addEventListener("click", closeAllMenus);
  });
  root.querySelector(".theme-toggle")?.addEventListener("click", toggleTheme);
  root.querySelector(".lang-toggle")?.addEventListener("click", toggleLanguage);
}

// Outside click / Escape closes any open menu (bound once).
document.addEventListener("click", (e) => {
  if (!(/** @type {Element} */ (e.target).closest(".menu"))) closeAllMenus();
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
    update({ event }); // home shows during analyze()'s async fetch, as before
    document
      .querySelectorAll(".mode")
      .forEach((/** @type {HTMLElement} */ b) => {
        b.classList.toggle("mode--active", b.dataset.event === event);
      });
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
  } catch {
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
  updateHomeTagline(); // not covered by data-i18n: refresh in the new language
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

/** Set the home tagline for the current event (sunset/sunrise); the copy is
 *  static markup otherwise, so it must be refreshed on event/language change. */
function updateHomeTagline() {
  const el = document.querySelector(".home__tagline");
  if (el) el.textContent = t(`app.tagline.${state.event}`);
}

/** Build + wire the home menu (called at startup and after a language switch). */
function mountHomeMenu() {
  const slot = document.getElementById("home-menu");
  if (!slot) return;
  slot.innerHTML = moreMenuHtml();
  bindMoreMenu(slot);
}

// The store's sole subscriber: every `update()` redraws through here. Wired
// before the first `update()` (in initFromUrl / analyze) can fire.
subscribe(render);

// Startup: language, static texts, the home menu, favorites and shared link.
initLang();
document.documentElement.lang = getLang();
applyStaticI18n();
updateHomeTagline();
mountHomeMenu();
updateSuggestAria();
renderFavorites();
initFromUrl();

// Signal a healthy boot to the self-heal watchdog in index.html: if the module
// graph linked and this startup ran, we are NOT in the bricked-shell state the
// watchdog guards against. Without this the watchdog misfires every session,
// unregistering the service worker and clearing caches on each fresh load.
window.__skyhueBooted = true;
