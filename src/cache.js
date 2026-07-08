const store = new Map();
export const TTL = {
  FORECAST: 30 * 60 * 1000, // meteo: serie oraria, refresh ~ogni ora
  AIR: 30 * 60 * 1000, // qualità dell'aria: stessa volatilità
  ELEVATION: 365 * 24 * 60 * 60 * 1000, // quota del terreno: immutabile
  SPOTS: 6 * 60 * 60 * 1000, // POI OSM: quasi statici
  GEOCODE: 30 * 24 * 60 * 60 * 1000, // coordinate di una località: statiche
  REVERSE: 30 * 24 * 60 * 60 * 1000, // toponimo da coordinate: statico
};

export function coordKey(prefix, lat, lon, decimals = 3, extra = '') {
  return `${prefix}:${lat.toFixed(decimals)},${lon.toFixed(decimals)}${extra}`;
}


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
    dbPromise = null;
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

export function _setCacheBackend(b) {
  backend = b;
}

/**
 * @param {string} key
 * @param {number} ttl
 * @param {() => Promise<*>} producer
 */
export async function cached(key, ttl, producer) {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  if (backend) {
    try {
      const entry = await backend.get(key);
      if (entry && entry.expires > Date.now()) {
        store.set(key, entry);
        return entry.value;
      }
    } catch {
    }
  }

  const value = await producer();
  const entry = { value, expires: Date.now() + ttl };
  store.set(key, entry);
  if (backend) {
    try {
      Promise.resolve(backend.set(key, entry)).catch(() => {});
    } catch {
    }
  }
  return value;
}
export function clearCache() {
  store.clear();
}
