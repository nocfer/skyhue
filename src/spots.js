import { azimuthToCardinal } from "./astronomy.js";
import { cached, coordKey, TTL } from "./cache.js";

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const EARTH_KM = 6371;
const DEG = Math.PI / 180;
export function distanceKm(aLat, aLon, bLat, bLon) {
  const dLat = (bLat - aLat) * DEG;
  const dLon = (bLon - aLon) * DEG;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * DEG) * Math.cos(bLat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}
export function bearing(aLat, aLon, bLat, bLon) {
  const y = Math.sin((bLon - aLon) * DEG) * Math.cos(bLat * DEG);
  const x =
    Math.cos(aLat * DEG) * Math.sin(bLat * DEG) -
    Math.sin(aLat * DEG) * Math.cos(bLat * DEG) * Math.cos((bLon - aLon) * DEG);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}
export function angleDiff(a, b) {
  const d = Math.abs(((a - b + 540) % 360) - 180);
  return d;
}
export function driveMinutes(distKm) {
  return Math.max(1, Math.round(((distKm * 1.3) / 50) * 60));
}

export function horizonDistanceKm(elevM) {
  return 3.57 * Math.sqrt(Math.max(0, elevM || 0));
}
export function destinationPoint(lat, lon, bearingDeg, distKm) {
  const d = distKm / EARTH_KM;
  const th = bearingDeg * DEG;
  const f1 = lat * DEG;
  const l1 = lon * DEG;
  const f2 = Math.asin(
    Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(th),
  );
  const l2 =
    l1 +
    Math.atan2(
      Math.sin(th) * Math.sin(d) * Math.cos(f1),
      Math.cos(d) - Math.sin(f1) * Math.sin(f2),
    );
  return { lat: f2 / DEG, lon: ((l2 / DEG + 540) % 360) - 180 };
}

export const SAMPLE_DISTANCES = [0, 0.4, 0.8, 1.5, 3, 5];

/**
 * @param {number} elevSpot
 * @param {Array<{distKm:number, elev:number}>} ahead
 * @returns {{maxAngle:number, seaFraction:number, obstructed:boolean}}
 */
export function evaluateHorizon(elevSpot, ahead) {
  let maxAngle = -90;
  let seaCount = 0;
  for (const s of ahead) {
    const angle = Math.atan2(s.elev - elevSpot, s.distKm * 1000) / DEG;
    if (angle > maxAngle) maxAngle = angle;
    if (s.elev <= 1) seaCount++;
  }
  const seaFraction = ahead.length ? seaCount / ahead.length : 0;
  const obstructed = maxAngle > 2;
  return { maxAngle, seaFraction, obstructed };
}

const KIND_BASE = {
  lighthouse: 55,
  cape: 52,
  cliff: 50,
  viewpoint: 48,
  peak: 45,
  estimate: 44,
  beach: 38,
};

/**
 * @returns {{score:number, sentiment:string, icon:string, code:string}}
 */
export function spotVerdict(kind, horizon) {
  let score = KIND_BASE[kind] ?? 45;
  if (!horizon) {
    return { score, sentiment: "neutral", icon: "help", code: "notEvaluated" };
  }
  const { obstructed, seaFraction, maxAngle } = horizon;
  if (obstructed) {
    score = Math.max(0, score - 35);
    return { score, sentiment: "bad", icon: "mountain", code: "obstructed" };
  }
  score += Math.round(20 * seaFraction);
  score += Math.max(0, Math.round((2 - maxAngle) * 5));
  score = Math.max(0, Math.min(100, score));
  if (seaFraction >= 0.5) {
    return { score, sentiment: "good", icon: "waves", code: "openSea" };
  }
  if (kind === "beach" && seaFraction < 0.3) {
    return { score, sentiment: "neutral", icon: "sunset", code: "openNoSea" };
  }
  return { score, sentiment: "good", icon: "sunset", code: "openLand" };
}

/**
 * @returns {Array<{lat:number, lon:number}>}
 */
export function gridCandidates(lat, lon, radiusKm = 20, perSide = 9) {
  const step = (2 * radiusKm) / (perSide - 1); // km between points
  const half = (perSide - 1) / 2;
  const cosLat = Math.max(0.2, Math.cos(lat * DEG));
  const pts = [];
  for (let i = -half; i <= half; i++) {
    for (let j = -half; j <= half; j++) {
      const north = i * step;
      const east = j * step;
      if (Math.hypot(north, east) > radiusKm) continue;
      pts.push({ lat: lat + north / 111, lon: lon + east / (111 * cosLat) });
    }
  }
  return pts;
}

/**
 * Pre-selects the grid candidates from elevations alone: excludes points at
 * sea, rewards those on land near the coast (a neighbor is at sea level) and
 * slightly the higher ones. Returns the points with a `prescore`.
 * @param {Array<{lat,lon}>} points
 * @param {number[]} elevations elevations aligned with the points
 * @param {number} stepKm grid step
 */
export function prescoreGrid(points, elevations, stepKm) {
  const sea = 1; // m: "sea / sea level" threshold
  const pts = points.map((p, i) => ({ ...p, elev: elevations[i] ?? null }));
  return pts.map((p) => {
    if (p.elev == null || p.elev <= sea)
      return { ...p, coastal: false, prescore: -Infinity };
    let coastal = false;
    for (const q of pts) {
      if (q === p || q.elev == null) continue;
      if (
        q.elev <= sea &&
        distanceKm(p.lat, p.lon, q.lat, q.lon) <= stepKm * 1.5
      ) {
        coastal = true;
        break;
      }
    }
    const prescore = (coastal ? 20 : 0) + Math.min(p.elev, 200) * 0.05;
    return { ...p, coastal, prescore };
  });
}

/**
 * Fetches the elevations (m) for a list of points, in a single batch call.
 * @param {Array<{lat:number, lon:number}>} points
 * @param {{signal?:AbortSignal}} [opts]
 * @returns {Promise<number[]>} elevations aligned with the points
 */
export async function fetchElevations(points, { signal } = {}) {
  if (!points.length) return [];
  const lats = points.map((p) => p.lat.toFixed(5)).join(",");
  const lons = points.map((p) => p.lon.toFixed(5)).join(",");
  // Terrain elevation is immutable: the point list is already a stable key.
  return cached(`elev:${lats}|${lons}`, TTL.ELEVATION, async () => {
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Elevation ${res.status}`);
    const data = await res.json();
    return data.elevation ?? [];
  });
}

// Spot kinds we consider, with label and icon.
const KINDS = {
  viewpoint: { labelKey: "kind.viewpoint", icon: "eye" },
  lighthouse: { labelKey: "kind.lighthouse", icon: "lighthouse" },
  cape: { labelKey: "kind.cape", icon: "mountain" },
  cliff: { labelKey: "kind.cliff", icon: "cliff" },
  peak: { labelKey: "kind.peak", icon: "peak" },
  beach: { labelKey: "kind.beach", icon: "umbrella" },
  estimate: { labelKey: "kind.estimate", icon: "compass" },
};

function classify(tags = {}) {
  if (tags.tourism === "viewpoint") return "viewpoint";
  if (tags.man_made === "lighthouse") return "lighthouse";
  if (tags.natural === "cape") return "cape";
  if (tags.natural === "cliff") return "cliff";
  if (tags.natural === "peak") return "peak";
  if (tags.natural === "beach") return "beach";
  // Named points (e.g. "Punta Ferro") often mapped only as place=locality.
  const n = (tags.name || "").toLowerCase();
  if (/^(punta|capo|cabo)\b/.test(n)) return "cape";
  if (/^(faro|torre)\b/.test(n)) return "lighthouse";
  if (/^belvedere\b/.test(n)) return "viewpoint";
  if (/^(monte|pizzo|cima)\b/.test(n)) return "peak";
  return "viewpoint";
}

export function kindInfo(kind) {
  return KINDS[kind] ?? KINDS.viewpoint;
}

/**
 * Fetches the scenic spots within `radiusKm` of a position.
 * @param {number} lat
 * @param {number} lon
 * @param {number} [radiusKm]
 * @param {{signal?:AbortSignal}} [opts]
 * @returns {Promise<Array<{id,lat,lon,name,kind}>>}
 */
export async function fetchSunsetSpots(
  lat,
  lon,
  radiusKm = 25,
  { signal } = {},
) {
  const r = Math.round(radiusKm * 1000);
  // POIs are nearly static: key on rounded coordinates (~1 km) + radius, so
  // taps close together reuse the same Overpass response (expensive query).
  const key = coordKey("spots", lat, lon, 2, `|${radiusKm}`);
  return cached(key, TTL.SPOTS, async () => {
    // `nwr` + `out center` also include points mapped as areas (beaches,
    // headlands), not just as nodes.
    const q = `[out:json][timeout:25];
(
  nwr["tourism"="viewpoint"](around:${r},${lat},${lon});
  nwr["man_made"="lighthouse"](around:${r},${lat},${lon});
  nwr["natural"="cape"](around:${r},${lat},${lon});
  nwr["natural"="cliff"](around:${r},${lat},${lon});
  nwr["natural"="peak"](around:${r},${lat},${lon});
  nwr["natural"="beach"](around:${r},${lat},${lon});
  nwr["name"~"^(Punta|Capo|Cabo|Cala|Belvedere|Faro|Torre)",i]["place"](around:${r},${lat},${lon});
);
out center 90;`;

    const data = await overpassQuery(q, signal);
    return (data.elements ?? [])
      .map((e) => {
        const lat2 = e.lat ?? e.center?.lat;
        const lon2 = e.lon ?? e.center?.lon;
        if (!Number.isFinite(lat2) || !Number.isFinite(lon2)) return null;
        const kind = classify(e.tags);
        return {
          id: e.id,
          lat: lat2,
          lon: lon2,
          name: e.tags?.name || null, // if the OSM name is missing, the UI uses the kind label
          kind,
        };
      })
      .filter(Boolean);
  });
}

/**
 * Full "suggested spots around a point" pipeline: fetches the OSM points,
 * pre-selects by distance/direction to the sun, evaluates their view by
 * sampling elevations along the ray, and returns the best ones sorted by
 * quality. Self-contained (origin = the given lat/lon), so it's reusable
 * from the map screen.
 * @param {number} lat
 * @param {number} lon
 * @param {number} azimuth
 * @param {{radiusKm?:number, evaluate?:number, show?:number, nearKm?:number, signal?:AbortSignal}} [opts]
 * @returns {Promise<Array<{lat,lon,name,kind,dist,dir,driveMin,elev,verdict,finalScore}>>}
 */
export async function nearbySpots(
  lat,
  lon,
  azimuth,
  { radiusKm = 25, evaluate = 14, show = 6, nearKm = 6, signal } = {},
) {
  const raw = await fetchSunsetSpots(lat, lon, radiusKm, { signal });
  if (!raw.length) return [];

  // Pre-selection by cost: distance, penalizing far-away ones "on the wrong side".
  const nearest = raw
    .map((s) => {
      const dist = distanceKm(lat, lon, s.lat, s.lon);
      const dirDiff = angleDiff(bearing(lat, lon, s.lat, s.lon), azimuth);
      const offSunset = dist > nearKm && dirDiff > 90 ? 2 : 1;
      return { ...s, dist, cost: dist * offSunset };
    })
    .sort((a, b) => a.cost - b.cost)
    .slice(0, evaluate);

  // Sample the terrain along the ray towards the sun (a single batch call).
  const points = [];
  for (const s of nearest) {
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
    elevations = await fetchElevations(points, { signal });
  } catch (err) {
    if (err?.name === "AbortError") throw err; // evaluation superseded: propagate
    console.warn("Elevations not available for nearby spots:", err);
  }

  const n = SAMPLE_DISTANCES.length;
  const evaluated = nearest.map((s, i) => {
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
    const finalScore = verdict.score - Math.max(0, s.dist - nearKm) * 0.4;
    return {
      ...s,
      elev,
      dir: azimuthToCardinal(bearing(lat, lon, s.lat, s.lon)),
      driveMin: driveMinutes(s.dist),
      verdict,
      finalScore,
    };
  });

  evaluated.sort((a, b) => b.finalScore - a.finalScore || a.dist - b.dist);
  return evaluated.slice(0, show);
}

/**
 * Reverse geocoding via Nominatim: given lat/lon returns a short place name
 * (hamlet/village/neighbourhood or natural feature), or null if unavailable.
 * Use sparingly (~1 req/s policy): only for a handful of points.
 */
export async function reverseGeocode(lat, lon, lang = "it") {
  // Place names are static + Nominatim has a ~1 req/s policy: long, persistent cache.
  return cached(
    coordKey("rev", lat, lon, 5, `|${lang}`),
    TTL.REVERSE,
    async () => {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat.toFixed(
        5,
      )}&lon=${lon.toFixed(5)}&zoom=14&accept-language=${lang}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`Nominatim ${res.status}`);
      const data = await res.json();
      const a = data.address || {};
      return (
        a.hamlet ||
        a.village ||
        a.town ||
        a.suburb ||
        a.neighbourhood ||
        a.locality ||
        a.natural ||
        data.name ||
        (data.display_name ? data.display_name.split(",")[0].trim() : null) ||
        null
      );
    },
  );
}

// If a hedged endpoint stays silent this long, ALSO try the next one in
// parallel (don't wait for it to fail). The mirrors have very different, often
// multi-second latencies; the primary is regularly overloaded. Hedging turns
// "stall on the slow one, then fall back" into "whichever answers first wins",
// which is the whole cold-start / first-search cost (later searches hit the 6h
// SPOTS cache). In the common case the first mirror answers inside the window
// and only one request is made.
const OVERPASS_HEDGE_MS = 2500;
// Hard cap on the whole query regardless of hedging, so a batch of slow mirrors
// can't pin the "where to watch" section in its loading state forever.
const OVERPASS_TIMEOUT_MS = 20000;

// Overpass reports "server too busy" / a dispatcher timeout as a `remark` inside
// an otherwise-200 JSON body (with no `elements`), e.g. "runtime error: … The
// server is probably too busy to handle your request." Left alone that parses
// cleanly, so the hedge counts it as a WIN — returning empty spots AND caching
// them for 6h. We match those error remarks and throw so the request is treated
// as a failure: the hedge falls through to another mirror, and `cached` (which
// only stores on success) never persists the empty result. Benign remarks
// (performance tips) don't match and pass through.
const OVERPASS_ERROR_REMARK =
  /runtime error|timeout|too busy|rate_?limited|out of memory|quota/i;

/**
 * Runs an Overpass query, hedging across the endpoints (form-urlencoded): fire
 * the first, and if it is still silent after OVERPASS_HEDGE_MS fire the next in
 * parallel; a failing endpoint advances to the next immediately. Resolves with
 * the first successful response and aborts the losers.
 */
async function overpassQuery(q, signal) {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const body = "data=" + encodeURIComponent(q);
  // One controller cancels every in-flight hedge once we settle (or on abort).
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    return await new Promise((resolve, reject) => {
      let settled = false;
      let next = 0; // index of the next endpoint to fire
      let pending = 0; // in-flight requests
      let lastErr;
      let hedgeTimer = null;

      const settle = (fn, val) => {
        if (settled) return;
        settled = true;
        clearTimeout(hedgeTimer);
        clearTimeout(overall);
        ctrl.abort(); // cancel the other in-flight hedges
        fn(val);
      };
      const win = (data) => settle(resolve, data);
      const fail = (err) =>
        settle(reject, err ?? new Error("Overpass non raggiungibile"));

      const overall = setTimeout(
        () => fail(lastErr ?? new Error("Overpass timeout")),
        OVERPASS_TIMEOUT_MS,
      );

      const fire = () => {
        if (settled || next >= OVERPASS_ENDPOINTS.length) return;
        const endpoint = OVERPASS_ENDPOINTS[next++];
        pending++;
        // Pre-arm the next hedge; a fast success/failure clears or supersedes it.
        clearTimeout(hedgeTimer);
        if (next < OVERPASS_ENDPOINTS.length)
          hedgeTimer = setTimeout(fire, OVERPASS_HEDGE_MS);
        fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
          signal: ctrl.signal,
        })
          .then(async (res) => {
            // 504/429 (too busy) come back as an error status with an HTML body
            // — never parse it, just fail so the hedge tries the next mirror.
            if (!res.ok) throw new Error(`Overpass ${res.status}`);
            // A dispatcher timeout can also arrive as 200: either an HTML page
            // (res.json() throws → caught → fallback) or JSON carrying an error
            // `remark` with no elements. Catch the latter explicitly.
            const data = await res.json();
            if (data?.remark && OVERPASS_ERROR_REMARK.test(data.remark))
              throw new Error(`Overpass busy: ${data.remark}`);
            return data;
          })
          .then(win)
          .catch((err) => {
            pending--;
            // Our own abort fired: a peer already won (ignore), or the CALLER
            // cancelled — surface that as an AbortError, matching the old path.
            if (ctrl.signal.aborted) {
              if (signal?.aborted)
                fail(new DOMException("Aborted", "AbortError"));
              return;
            }
            lastErr = err;
            if (next < OVERPASS_ENDPOINTS.length)
              fire(); // this one failed early → try the next now, don't wait
            else if (pending === 0) fail(lastErr); // all fired, none left
          });
      };
      fire();
    });
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}
