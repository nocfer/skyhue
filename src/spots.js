// spots.js — suggerisce punti panoramici vicini da OpenStreetMap (Overpass API).
// Approccio volutamente semplice: nessuna analisi del terreno o della costa.
// Mostriamo i luoghi già mappati come "panoramici" (o fari/promontori) e la
// distanza/direzione; la scelta finale, in base all'azimut del tramonto, è
// lasciata alla persona.
import { azimuthToCardinal } from './astronomy.js';
import { cached, coordKey, TTL } from './cache.js';

// Endpoint Overpass (con riserve: se il primo è occupato si prova il successivo).
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const EARTH_KM = 6371;
const DEG = Math.PI / 180;

/** Distanza in km tra due coordinate (formula dell'emisenoverso). */
export function distanceKm(aLat, aLon, bLat, bLon) {
  const dLat = (bLat - aLat) * DEG;
  const dLon = (bLon - aLon) * DEG;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * DEG) * Math.cos(bLat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Rilevamento iniziale (bearing) da A verso B in gradi, 0=N, 90=E. */
export function bearing(aLat, aLon, bLat, bLon) {
  const y = Math.sin((bLon - aLon) * DEG) * Math.cos(bLat * DEG);
  const x =
    Math.cos(aLat * DEG) * Math.sin(bLat * DEG) -
    Math.sin(aLat * DEG) * Math.cos(bLat * DEG) * Math.cos((bLon - aLon) * DEG);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

/** Differenza angolare minima (0-180°) tra due rilevamenti. */
export function angleDiff(a, b) {
  const d = Math.abs(((a - b + 540) % 360) - 180);
  return d;
}

/** Stima grossolana dei minuti in auto da una distanza in linea d'aria. */
export function driveMinutes(distKm) {
  // fattore strada ~1.3 sulla distanza in linea d'aria, ~50 km/h di media
  return Math.max(1, Math.round((distKm * 1.3) / 50 * 60));
}

/**
 * Distanza dell'orizzonte geometrico (km) da una quota in metri: quanto lontano
 * si spinge lo sguardo verso il mare da quell'altezza (≈ 3,57·√h).
 */
export function horizonDistanceKm(elevM) {
  return 3.57 * Math.sqrt(Math.max(0, elevM || 0));
}

/** Punto di destinazione a `distKm` da (lat,lon) lungo un rilevamento (gradi). */
export function destinationPoint(lat, lon, bearingDeg, distKm) {
  const d = distKm / EARTH_KM;
  const th = bearingDeg * DEG;
  const f1 = lat * DEG;
  const l1 = lon * DEG;
  const f2 = Math.asin(
    Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(th)
  );
  const l2 =
    l1 +
    Math.atan2(
      Math.sin(th) * Math.sin(d) * Math.cos(f1),
      Math.cos(d) - Math.sin(f1) * Math.sin(f2)
    );
  return { lat: f2 / DEG, lon: (((l2 / DEG + 540) % 360) - 180) };
}

// Distanze (km) di campionamento del terreno lungo il raggio verso il sole.
// Il primo (0) è il punto stesso; gli altri servono a valutare l'orizzonte.
export const SAMPLE_DISTANCES = [0, 0.4, 0.8, 1.5, 3, 5];

/**
 * Valuta l'orizzonte verso il sole a partire dal profilo di quote campionato.
 * @param {number} elevSpot quota del punto (m)
 * @param {Array<{distKm:number, elev:number}>} ahead campioni davanti (distKm>0)
 * @returns {{maxAngle:number, seaFraction:number, obstructed:boolean}}
 */
export function evaluateHorizon(elevSpot, ahead) {
  let maxAngle = -90;
  let seaCount = 0;
  for (const s of ahead) {
    const angle = Math.atan2(s.elev - elevSpot, s.distKm * 1000) / DEG;
    if (angle > maxAngle) maxAngle = angle;
    if (s.elev <= 1) seaCount++; // ~livello del mare
  }
  const seaFraction = ahead.length ? seaCount / ahead.length : 0;
  // Il sole al tramonto è ~0° sull'orizzonte: un rilievo oltre ~2° lo blocca.
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
 * Punteggio qualitativo (0-100) e giudizio testuale di un punto, dato il tipo
 * e la valutazione dell'orizzonte verso il sole.
 * @returns {{score:number, sentiment:string, icon:string, label:string}}
 */
export function spotVerdict(kind, horizon) {
  let score = KIND_BASE[kind] ?? 45;
  if (!horizon) {
    return { score, sentiment: 'neutral', icon: 'help', code: 'notEvaluated' };
  }
  const { obstructed, seaFraction, maxAngle } = horizon;
  if (obstructed) {
    score = Math.max(0, score - 35);
    return { score, sentiment: 'bad', icon: 'mountain', code: 'obstructed' };
  }
  score += Math.round(20 * seaFraction);
  score += Math.max(0, Math.round((2 - maxAngle) * 5)); // più l'orizzonte è basso, meglio è
  score = Math.max(0, Math.min(100, score));
  if (seaFraction >= 0.5) {
    return { score, sentiment: 'good', icon: 'waves', code: 'openSea' };
  }
  if (kind === 'beach' && seaFraction < 0.3) {
    return { score, sentiment: 'neutral', icon: 'sunset', code: 'openNoSea' };
  }
  return { score, sentiment: 'good', icon: 'sunset', code: 'openLand' };
}

/**
 * Genera una griglia di punti candidati entro `radiusKm` (approssimazione in
 * gradi, sufficiente per generare candidati). Serve alla ricerca "da coordinate"
 * indipendente dai punti di interesse mappati.
 * @returns {Array<{lat:number, lon:number}>}
 */
export function gridCandidates(lat, lon, radiusKm = 20, perSide = 9) {
  const step = (2 * radiusKm) / (perSide - 1); // km tra i punti
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
 * Pre-selezione dei candidati della griglia dalle sole quote: esclude i punti
 * in mare, premia quelli su terra vicino alla costa (un vicino è a livello del
 * mare) e leggermente quelli più elevati. Restituisce i punti con `prescore`.
 * @param {Array<{lat,lon}>} points
 * @param {number[]} elevations quote allineate ai punti
 * @param {number} stepKm passo della griglia
 */
export function prescoreGrid(points, elevations, stepKm) {
  const sea = 1; // m: soglia "mare / livello del mare"
  const pts = points.map((p, i) => ({ ...p, elev: elevations[i] ?? null }));
  return pts.map((p) => {
    if (p.elev == null || p.elev <= sea) return { ...p, coastal: false, prescore: -Infinity };
    let coastal = false;
    for (const q of pts) {
      if (q === p || q.elev == null) continue;
      if (q.elev <= sea && distanceKm(p.lat, p.lon, q.lat, q.lon) <= stepKm * 1.5) {
        coastal = true;
        break;
      }
    }
    const prescore = (coastal ? 20 : 0) + Math.min(p.elev, 200) * 0.05;
    return { ...p, coastal, prescore };
  });
}

/**
 * Scarica le quote (m) per una lista di punti, in un'unica chiamata batch.
 * @param {Array<{lat:number, lon:number}>} points
 * @returns {Promise<number[]>} quote allineate ai punti
 */
export async function fetchElevations(points, { signal } = {}) {
  if (!points.length) return [];
  const lats = points.map((p) => p.lat.toFixed(5)).join(',');
  const lons = points.map((p) => p.lon.toFixed(5)).join(',');
  // La quota del terreno è immutabile: la lista di punti è già una chiave stabile.
  return cached(`elev:${lats}|${lons}`, TTL.ELEVATION, async () => {
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Elevation ${res.status}`);
    const data = await res.json();
    return data.elevation ?? [];
  });
}

// Tipi di punto che consideriamo, con etichetta e icona.
const KINDS = {
  viewpoint: { labelKey: 'kind.viewpoint', icon: 'eye' },
  lighthouse: { labelKey: 'kind.lighthouse', icon: 'lighthouse' },
  cape: { labelKey: 'kind.cape', icon: 'mountain' },
  cliff: { labelKey: 'kind.cliff', icon: 'cliff' },
  peak: { labelKey: 'kind.peak', icon: 'peak' },
  beach: { labelKey: 'kind.beach', icon: 'umbrella' },
  estimate: { labelKey: 'kind.estimate', icon: 'compass' },
};

function classify(tags = {}) {
  if (tags.tourism === 'viewpoint') return 'viewpoint';
  if (tags.man_made === 'lighthouse') return 'lighthouse';
  if (tags.natural === 'cape') return 'cape';
  if (tags.natural === 'cliff') return 'cliff';
  if (tags.natural === 'peak') return 'peak';
  if (tags.natural === 'beach') return 'beach';
  // Punti nominati (es. "Punta Ferro") spesso mappati solo come place=locality.
  const n = (tags.name || '').toLowerCase();
  if (/^(punta|capo|cabo)\b/.test(n)) return 'cape';
  if (/^(faro|torre)\b/.test(n)) return 'lighthouse';
  if (/^belvedere\b/.test(n)) return 'viewpoint';
  if (/^(monte|pizzo|cima)\b/.test(n)) return 'peak';
  return 'viewpoint';
}

export function kindInfo(kind) {
  return KINDS[kind] ?? KINDS.viewpoint;
}

/**
 * Scarica i punti panoramici entro `radiusKm` da una posizione.
 * @returns {Promise<Array<{id,lat,lon,name,kind}>>}
 */
export async function fetchSunsetSpots(lat, lon, radiusKm = 25, { signal } = {}) {
  const r = Math.round(radiusKm * 1000);
  // I POI sono quasi statici: chiave su coordinate arrotondate (~1 km) + raggio,
  // così tap ravvicinati riusano la stessa risposta Overpass (query costosa).
  const key = coordKey('spots', lat, lon, 2, `|${radiusKm}`);
  return cached(key, TTL.SPOTS, async () => {
    // `nwr` + `out center` includono anche punti mappati come aree (spiagge,
    // promontori), non solo come nodi.
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
          name: e.tags?.name || null, // se manca il nome OSM, la UI usa l'etichetta del tipo
          kind,
        };
      })
      .filter(Boolean);
  });
}

/**
 * Pipeline completa "punti suggeriti attorno a un punto": scarica i punti OSM,
 * pre-seleziona per vicinanza/direzione al sole, ne valuta l'affaccio campionando
 * le quote lungo il raggio, e restituisce i migliori ordinati per qualità.
 * Autonoma (origine = lat/lon passati), così è riusabile dalla schermata mappa.
 * @returns {Promise<Array<{lat,lon,name,kind,dist,dir,driveMin,elev,verdict,finalScore}>>}
 */
export async function nearbySpots(
  lat,
  lon,
  azimuth,
  { radiusKm = 25, evaluate = 14, show = 6, nearKm = 6, signal } = {}
) {
  const raw = await fetchSunsetSpots(lat, lon, radiusKm, { signal });
  if (!raw.length) return [];

  // Pre-selezione per costo: vicinanza, con penalità ai lontani "dal lato sbagliato".
  const nearest = raw
    .map((s) => {
      const dist = distanceKm(lat, lon, s.lat, s.lon);
      const dirDiff = angleDiff(bearing(lat, lon, s.lat, s.lon), azimuth);
      const offSunset = dist > nearKm && dirDiff > 90 ? 2 : 1;
      return { ...s, dist, cost: dist * offSunset };
    })
    .sort((a, b) => a.cost - b.cost)
    .slice(0, evaluate);

  // Campiona il terreno lungo il raggio verso il sole (una sola chiamata batch).
  const points = [];
  for (const s of nearest) {
    for (const d of SAMPLE_DISTANCES) {
      points.push(d === 0 ? { lat: s.lat, lon: s.lon } : destinationPoint(s.lat, s.lon, azimuth, d));
    }
  }
  let elevations = null;
  try {
    elevations = await fetchElevations(points, { signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err; // valutazione superata: propaga
    console.warn('Quote non disponibili per i punti vicini:', err);
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
 * Reverse geocoding via Nominatim: dato lat/lon restituisce un toponimo breve
 * (frazione/paese/quartiere o elemento naturale), o null se non disponibile.
 * Usare con parsimonia (policy ~1 req/s): solo per pochi punti.
 */
export async function reverseGeocode(lat, lon, lang = 'it') {
  // Toponimo statico + Nominatim ha policy ~1 req/s: cache lunga, persistente.
  return cached(coordKey('rev', lat, lon, 5, `|${lang}`), TTL.REVERSE, async () => {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat.toFixed(
      5
    )}&lon=${lon.toFixed(5)}&zoom=14&accept-language=${lang}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
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
      (data.display_name ? data.display_name.split(',')[0].trim() : null) ||
      null
    );
  });
}

/** Esegue una query Overpass provando gli endpoint in sequenza (form-urlencoded). */
async function overpassQuery(q, signal) {
  let lastErr;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q),
        signal,
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      return await res.json();
    } catch (err) {
      // Valutazione annullata (nuovo tap): interrompi subito, non ripiegare
      // sull'endpoint successivo.
      if (err?.name === 'AbortError' || signal?.aborted) throw err;
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('Overpass non raggiungibile');
}
