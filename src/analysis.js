// The analysis domain: everything that turns a Place + Event into the scored
// model the results screen draws. It fetches (weather, air, spots, elevations,
// light path), rates scenic Spots, and computes the Sunset Score — but it draws
// nothing. Writes flow through the store's `update()`; staleness is gated by the
// analysis session's `beginRun()`. The results view-model (`resultsModel`) is
// pure and synchronous, so it is unit-testable without a DOM.
//
// The interface is four verbs; the eleven functions below them are private:
//   - analyze(place)     full analysis for a newly chosen Place
//   - refreshForEvent()  recompute the Event-dependent data after a mode switch
//   - scanCoordinates()  on-demand "search unmapped points" grid scan
//   - resultsModel()     build { day, scored } for render() to draw
//
// The module never touches the DOM — the only outward effect is a status
// message via `setStatus` — so the scoring path stays pure and testable. A
// future extension (see CONTEXT.md) would hand each session run an AbortSignal
// to cancel the in-flight fetches rather than merely ignore their results.
import {
  fetchForecast,
  fetchAirQuality,
  airAtTime,
  conditionsAtTime,
  conditionsWindow,
  nextSunset,
  dailyList,
} from "./api.js";
import { computeSunsetScore, explainScore } from "./score.js";
import { fetchLightPath, lightPathClearAt } from "./lightpath.js";
import { sunPosition, azimuthToCardinal, moonPhase } from "./astronomy.js";
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
  update,
  SPOTS_EVALUATE,
  SPOTS_SHOW,
  SPOTS_SKY,
  NEAR_KM,
} from "./state.js";
import { beginRun } from "./session.js";
import { t, getLang } from "./i18n.js";
import { setStatus } from "./format.js";

/** Fetch data for a place and show the result. */
export async function analyze(place) {
  setStatus(t("status.fetching", { label: place.label }), "info");
  // No explicit clear: analyze() always runs with the home showing (results
  // hidden), and the next render() diffs the results via lit regardless — so
  // this module never touches the DOM, keeping the scoring path pure/testable.
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
  const run = beginRun();
  try {
    const raw = await fetchSunsetSpots(place.latitude, place.longitude);
    if (run.stalePlace()) return; // the user switched place in the meantime
    update({ rawSpots: raw, rawSpotsFor: run.place });
    await evaluateSpots();
  } catch (err) {
    console.warn("Scenic spots not available:", err);
    if (run.stalePlace()) return;
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
  const run = beginRun();
  const { event } = run;
  update({
    lightPath: { status: "loading", place, event, azimuth: null, data: null },
  });
  try {
    const azimuth = currentAzimuth();
    const data = await fetchLightPath(place.latitude, place.longitude, azimuth);
    if (run.staleEvent()) return; // place or event changed — superseded
    const valid = data.points.filter((p) => p.forecast).length;
    update({
      lightPath:
        valid >= 2
          ? { status: "ready", place, event, azimuth, data }
          : { status: "error", place, event, azimuth, data: null },
    });
  } catch (err) {
    console.warn("Light path not available:", err);
    if (run.staleEvent()) return;
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
  const run = beginRun();
  const place = run.place;
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
  if (run.stalePlace()) return;

  // Sort by final score (outlook − distance), then by proximity.
  evaluated.sort((a, b) => b.finalScore - a.finalScore || a.dist - b.dist);
  update({ spots: evaluated });

  // In background: compute the sky score directly at the finalist points.
  loadSky(state.spots);
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
export async function scanCoordinates() {
  const run = beginRun();
  const place = run.place;
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
    if (run.stalePlace()) return;
    const step = (2 * radius) / (perSide - 1);
    const candidates = prescoreGrid(grid, gelev, step)
      .filter((p) => p.prescore > -Infinity)
      .sort((a, b) => b.prescore - a.prescore)
      .slice(0, SPOTS_EVALUATE)
      .map((p) => ({ lat: p.lat, lon: p.lon, kind: "estimate", name: null }));
    const evaluated = await refineCandidates(candidates, azimuth, place);
    if (run.stalePlace()) return;
    evaluated.sort((a, b) => b.finalScore - a.finalScore || a.dist - b.dist);
    update({
      estimatedSpots: evaluated.slice(0, SPOTS_SHOW),
      estimating: false,
    });
    loadSky(state.estimatedSpots);
    nameEstimatedSpots(state.estimatedSpots);
  } catch (err) {
    console.warn("Coordinate scan failed:", err);
    if (run.stalePlace()) return;
    update({ estimating: false, estimateError: true });
  }
}

/**
 * Name the first estimated points via reverse geocoding (Nominatim),
 * sequentially to respect the rate limit. Updates the name and re-renders.
 */
async function nameEstimatedSpots(spots) {
  const run = beginRun();
  const top = (spots || []).filter((s) => s.kind === "estimate").slice(0, 3);
  for (const s of top) {
    try {
      const name = await reverseGeocode(s.lat, s.lon, getLang());
      if (name) s.name = name;
    } catch {
      /* keeps the "estimated point" name */
    }
  }
  if (run.stalePlace()) return;
  update(); // names were mutated in place on the spot objects — just redraw
}

/**
 * For the top finalists of a list fetch the weather at the point and compute
 * its Sunset Score, so each destination shows both outlook and sky quality.
 */
async function loadSky(list) {
  const run = beginRun();
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
        // Keep the conditions on the spot — the map's spot card surfaces the
        // cloud split and haze, not just the derived score (see spotConditions).
        s.cond = cond;
        return computeSunsetScore(cond).score;
      } catch (err) {
        console.warn("Sky score for the spot not available:", err);
        return null;
      }
    }),
  );
  if (run.stalePlace()) return;
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

/**
 * Conditions to display for a spot's card. `approx` distinguishes the two
 * sources so the card can be honest about them: `false` is the spot's own
 * weather (fetched for the top finalists, see loadSky); `true` is the analyzed
 * point's weather, reused as an area estimate — near-identical over the ~20 km
 * spots span, and free (no fetch). Returns null when there is no forecast yet.
 * @returns {{cond: (ReturnType<typeof conditionsAtTime> & ReturnType<typeof airAtTime>), approx: boolean} | null}
 */
export function spotConditions(spot) {
  if (spot?.cond) return { cond: spot.cond, approx: false };
  if (!state.forecast) return null;
  const day =
    dailyList(state.forecast)[state.dayIndex] ?? dailyList(state.forecast)[0];
  if (!day) return null;
  const iso = day[state.event];
  return {
    cond: {
      ...conditionsAtTime(state.forecast, iso),
      ...airAtTime(state.air, iso),
    },
    approx: true,
  };
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

/**
 * Recompute the Event-dependent data after a sunrise/sunset switch: the light
 * path (its ray flips) and, when we already hold raw spots for this Place, the
 * spots' outlook (the azimuth moved). Called by the controller after it has
 * updated the store with the new Event.
 */
export function refreshForEvent() {
  if (state.forecast) loadLightPath(state.place);
  if (state.rawSpots && state.rawSpotsFor === state.place) evaluateSpots();
}

/**
 * Build the results view-model from state: the analyzed day (score, factors,
 * timeline, sun, …) and the week's per-day scores for the ribbon. Pure and
 * synchronous — render() consumes this and computes nothing itself.
 */
export function resultsModel() {
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
  return { day: evaluateDay(state.dayIndex), scored };
}
