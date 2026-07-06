// cache.js — cache in memoria (con TTL) per le risposte di rete ripetute.
// Nessuna dipendenza: è solo una Map + timestamp.
//
// Motivazione: la schermata mappa rivaluta un punto a ogni tap (meteo, aria,
// quote, punti Overpass). Ritoccando la stessa zona, senza cache si rifanno
// chiamate identiche e costose (Overpass ha timeout 25s e throttle sugli
// endpoint pubblici). Qui memorizziamo i risultati per chiave.
//
// Volutamente NON deduplichiamo le richieste concorrenti: la mappa annulla
// (AbortController) la valutazione precedente a ogni nuovo tap, e una Promise
// condivisa e poi annullata contaminerebbe chi vi si fosse agganciato.

const store = new Map(); // key -> { value, expires }

/** TTL per tipo di dato (ms). Coordinate arrotondate → stessa chiave. */
export const TTL = {
  FORECAST: 30 * 60 * 1000, // meteo: serie oraria, refresh ~ogni ora
  AIR: 30 * 60 * 1000, // qualità dell'aria: stessa volatilità
  ELEVATION: 365 * 24 * 60 * 60 * 1000, // quota del terreno: immutabile
  SPOTS: 6 * 60 * 60 * 1000, // POI OSM: quasi statici
};

/** Chiave di cache da coordinate arrotondate (+ eventuale suffisso). */
export function coordKey(prefix, lat, lon, decimals = 3, extra = '') {
  return `${prefix}:${lat.toFixed(decimals)},${lon.toFixed(decimals)}${extra}`;
}

/**
 * Restituisce il valore in cache per `key` se ancora fresco; altrimenti invoca
 * `producer()`, ne memorizza il risultato e lo restituisce.
 * Gli errori NON vengono messi in cache (una chiamata successiva ritenta).
 * @param {string} key
 * @param {number} ttl durata di validità in ms
 * @param {() => Promise<*>} producer
 */
export async function cached(key, ttl, producer) {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await producer();
  store.set(key, { value, expires: Date.now() + ttl });
  return value;
}

/** Svuota la cache (utile nei test). */
export function clearCache() {
  store.clear();
}
