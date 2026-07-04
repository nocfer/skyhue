// spots.js — suggerisce punti panoramici vicini da OpenStreetMap (Overpass API).
// Approccio volutamente semplice: nessuna analisi del terreno o della costa.
// Mostriamo i luoghi già mappati come "panoramici" (o fari/promontori) e la
// distanza/direzione; la scelta finale, in base all'azimut del tramonto, è
// lasciata alla persona.

const OVERPASS = 'https://overpass-api.de/api/interpreter';
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
};

function classify(tags = {}) {
  if (tags.tourism === 'viewpoint') return 'viewpoint';
  if (tags.man_made === 'lighthouse') return 'lighthouse';
  if (tags.natural === 'cape') return 'cape';
  if (tags.natural === 'peak') return 'peak';
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
  const q = `[out:json][timeout:25];
(
  node["tourism"="viewpoint"](around:${r},${lat},${lon});
  node["man_made"="lighthouse"](around:${r},${lat},${lon});
  node["natural"="cape"](around:${r},${lat},${lon});
  node["natural"="peak"](around:${r},${lat},${lon});
);
out body 60;`;
  const res = await fetch(OVERPASS, {
    method: 'POST',
    body: 'data=' + encodeURIComponent(q),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  const data = await res.json();
  return (data.elements ?? [])
    .filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lon))
    .map((e) => {
      const kind = classify(e.tags);
      return {
        id: e.id,
        lat: e.lat,
        lon: e.lon,
        name: e.tags?.name || kindInfo(kind).label,
        kind,
      };
    });
}
