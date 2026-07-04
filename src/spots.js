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

// Tipi di punto che consideriamo, con etichetta e icona.
const KINDS = {
  viewpoint: { label: 'Punto panoramico', icon: '👁️' },
  lighthouse: { label: 'Faro', icon: '🗼' },
  cape: { label: 'Promontorio', icon: '⛰️' },
  peak: { label: 'Cima', icon: '🏔️' },
  beach: { label: 'Spiaggia', icon: '🏖️' },
};

function classify(tags = {}) {
  if (tags.tourism === 'viewpoint') return 'viewpoint';
  if (tags.man_made === 'lighthouse') return 'lighthouse';
  if (tags.natural === 'cape') return 'cape';
  if (tags.natural === 'peak') return 'peak';
  if (tags.natural === 'beach') return 'beach';
  return 'viewpoint';
}

export function kindInfo(kind) {
  return KINDS[kind] ?? KINDS.viewpoint;
}

/**
 * Scarica i punti panoramici entro `radiusKm` da una posizione.
 * @returns {Promise<Array<{id,lat,lon,name,kind}>>}
 */
export async function fetchSunsetSpots(lat, lon, radiusKm = 12) {
  const r = Math.round(radiusKm * 1000);
  // `nwr` + `out center` includono anche punti mappati come aree (spiagge,
  // promontori), non solo come nodi.
  const q = `[out:json][timeout:25];
(
  nwr["tourism"="viewpoint"](around:${r},${lat},${lon});
  nwr["man_made"="lighthouse"](around:${r},${lat},${lon});
  nwr["natural"="cape"](around:${r},${lat},${lon});
  nwr["natural"="peak"](around:${r},${lat},${lon});
  nwr["natural"="beach"](around:${r},${lat},${lon});
);
out center 80;`;

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
