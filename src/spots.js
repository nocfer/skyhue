// spots.js — suggerisce punti panoramici vicini da OpenStreetMap (Overpass API).
// Approccio volutamente semplice: nessuna analisi del terreno o della costa.
// Mostriamo i luoghi già mappati come "panoramici" (o fari/promontori) e la
// distanza/direzione; la scelta finale, in base all'azimut del tramonto, è
// lasciata alla persona.

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

const KIND_BASE = { lighthouse: 55, cape: 52, cliff: 50, viewpoint: 48, peak: 45, beach: 38 };

/**
 * Punteggio qualitativo (0-100) e giudizio testuale di un punto, dato il tipo
 * e la valutazione dell'orizzonte verso il sole.
 * @returns {{score:number, sentiment:string, icon:string, label:string}}
 */
export function spotVerdict(kind, horizon) {
  let score = KIND_BASE[kind] ?? 45;
  if (!horizon) {
    return { score, sentiment: 'neutral', icon: '❓', label: 'Affaccio non valutato' };
  }
  const { obstructed, seaFraction, maxAngle } = horizon;
  if (obstructed) {
    score = Math.max(0, score - 35);
    return {
      score,
      sentiment: 'bad',
      icon: '⛰️',
      label: 'Orizzonte ostruito verso il tramonto',
    };
  }
  score += Math.round(20 * seaFraction);
  score += Math.max(0, Math.round((2 - maxAngle) * 5)); // più l'orizzonte è basso, meglio è
  score = Math.max(0, Math.min(100, score));
  if (seaFraction >= 0.5) {
    return { score, sentiment: 'good', icon: '🌊', label: 'Affaccio libero sul mare' };
  }
  if (kind === 'beach' && seaFraction < 0.3) {
    return {
      score,
      sentiment: 'neutral',
      icon: '🌅',
      label: 'Orizzonte libero ma senza mare aperto',
    };
  }
  return { score, sentiment: 'good', icon: '🌅', label: 'Orizzonte libero verso il tramonto' };
}

/**
 * Scarica le quote (m) per una lista di punti, in un'unica chiamata batch.
 * @param {Array<{lat:number, lon:number}>} points
 * @returns {Promise<number[]>} quote allineate ai punti
 */
export async function fetchElevations(points) {
  if (!points.length) return [];
  const lats = points.map((p) => p.lat.toFixed(5)).join(',');
  const lons = points.map((p) => p.lon.toFixed(5)).join(',');
  const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Elevation ${res.status}`);
  const data = await res.json();
  return data.elevation ?? [];
}

// Tipi di punto che consideriamo, con etichetta e icona.
const KINDS = {
  viewpoint: { label: 'Punto panoramico', icon: '👁️' },
  lighthouse: { label: 'Faro', icon: '🗼' },
  cape: { label: 'Promontorio', icon: '⛰️' },
  cliff: { label: 'Scogliera', icon: '🪨' },
  peak: { label: 'Cima', icon: '🏔️' },
  beach: { label: 'Spiaggia', icon: '🏖️' },
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
export async function fetchSunsetSpots(lat, lon, radiusKm = 25) {
  const r = Math.round(radiusKm * 1000);
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

  const data = await overpassQuery(q);
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
        name: e.tags?.name || kindInfo(kind).label,
        kind,
      };
    })
    .filter(Boolean);
}

/** Esegue una query Overpass provando gli endpoint in sequenza (form-urlencoded). */
async function overpassQuery(q) {
  let lastErr;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q),
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('Overpass non raggiungibile');
}
