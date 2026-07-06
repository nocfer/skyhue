// cache.js — cache a due livelli per le risposte di rete ripetute, senza
// dipendenze: L1 in memoria (Map) + L2 persistente su IndexedDB.
//
// Motivazione: la schermata mappa rivaluta un punto a ogni tap (meteo, aria,
// quote, punti Overpass). Ritoccando la stessa zona, senza cache si rifanno
// chiamate identiche e costose (Overpass ha timeout 25s e throttle sugli
// endpoint pubblici). La memoria collassa i tap ravvicinati nella stessa
// sessione; IndexedDB estende il beneficio anche dopo un reload o alla
// sessione successiva (utile soprattutto per i dati statici: quote, POI,
// geocoding). Fuori dal browser (test) IndexedDB non esiste: si degrada a
// sola memoria senza rompere nulla.
//
// Volutamente NON deduplichiamo le richieste concorrenti: la mappa annulla
// (AbortController) la valutazione precedente a ogni nuovo tap, e una Promise
// condivisa e poi annullata contaminerebbe chi vi si fosse agganciato.

const store = new Map(); // L1: key -> { value, expires }

/** TTL per tipo di dato (ms). Coordinate arrotondate → stessa chiave. */
export const TTL = {
  FORECAST: 30 * 60 * 1000, // meteo: serie oraria, refresh ~ogni ora
  AIR: 30 * 60 * 1000, // qualità dell'aria: stessa volatilità
  ELEVATION: 365 * 24 * 60 * 60 * 1000, // quota del terreno: immutabile
  SPOTS: 6 * 60 * 60 * 1000, // POI OSM: quasi statici
  GEOCODE: 30 * 24 * 60 * 60 * 1000, // coordinate di una località: statiche
  REVERSE: 30 * 24 * 60 * 60 * 1000, // toponimo da coordinate: statico
};

/** Chiave di cache da coordinate arrotondate (+ eventuale suffisso). */
export function coordKey(prefix, lat, lon, decimals = 3, extra = '') {
  return `${prefix}:${lat.toFixed(decimals)},${lon.toFixed(decimals)}${extra}`;
}

// --- L2: backend persistente su IndexedDB -----------------------------------
// Un backend è { get(key)->Promise<entry|undefined>, set(key, entry)->Promise }.
// In assenza di IndexedDB (Node/test) il backend è null → resta solo la memoria.

const DB_NAME = 'skyhue-cache';
const STORE = 'entries';
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((err) => {
    dbPromise = null; // consenti un nuovo tentativo più avanti
    throw err;
  });
  return dbPromise;
}

function idbBackend() {
  return {
    get(key) {
      return openDB().then(
        (db) =>
          new Promise((resolve, reject) => {
            const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          })
      );
    },
    set(key, entry) {
      return openDB().then(
        (db) =>
          new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(entry, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          })
      );
    },
  };
}

let backend = typeof indexedDB !== 'undefined' ? idbBackend() : null;

/** Sostituisce il backend persistente (usato dai test). */
export function _setCacheBackend(b) {
  backend = b;
}

/**
 * Restituisce il valore in cache per `key` se ancora fresco (prima dalla
 * memoria, poi da IndexedDB); altrimenti invoca `producer()`, ne memorizza il
 * risultato (memoria + IndexedDB) e lo restituisce. Gli errori NON vengono
 * messi in cache (una chiamata successiva ritenta). IndexedDB è best-effort:
 * ogni errore di persistenza viene ignorato senza propagarsi al chiamante.
 * @param {string} key
 * @param {number} ttl durata di validità in ms
 * @param {() => Promise<*>} producer
 */
export async function cached(key, ttl, producer) {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  // L2: IndexedDB (persistente tra reload/sessioni).
  if (backend) {
    try {
      const entry = await backend.get(key);
      if (entry && entry.expires > Date.now()) {
        store.set(key, entry); // idrata la memoria
        return entry.value;
      }
    } catch {
      /* backend non disponibile: prosegui col producer */
    }
  }

  const value = await producer();
  const entry = { value, expires: Date.now() + ttl };
  store.set(key, entry);
  if (backend) {
    try {
      Promise.resolve(backend.set(key, entry)).catch(() => {});
    } catch {
      /* scrittura best-effort */
    }
  }
  return value;
}

/** Svuota la cache in memoria (utile nei test; non tocca IndexedDB). */
export function clearCache() {
  store.clear();
}
