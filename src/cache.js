const store = new Map();
export const TTL = {
  FORECAST: 30 * 60 * 1000, // weather: hourly series, refreshes ~every hour
  AIR: 30 * 60 * 1000, // air quality: same volatility
  ELEVATION: 365 * 24 * 60 * 60 * 1000, // terrain elevation: immutable
  SPOTS: 6 * 60 * 60 * 1000, // OSM POIs: nearly static
  GEOCODE: 30 * 24 * 60 * 60 * 1000, // coordinates of a place: static
  REVERSE: 30 * 24 * 60 * 60 * 1000, // place name from coordinates: static
};

export function coordKey(prefix, lat, lon, decimals = 3, extra = "") {
  return `${prefix}:${lat.toFixed(decimals)},${lon.toFixed(decimals)}${extra}`;
}

const DB_NAME = "skyhue-cache";
const STORE = "entries";
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
            const req = db
              .transaction(STORE, "readonly")
              .objectStore(STORE)
              .get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          }),
      );
    },
    set(key, entry) {
      return openDB().then(
        (db) =>
          new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, "readwrite");
            tx.objectStore(STORE).put(entry, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          }),
      );
    },
  };
}

let backend = typeof indexedDB !== "undefined" ? idbBackend() : null;

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
    } catch {}
  }

  const value = await producer();
  const entry = { value, expires: Date.now() + ttl };
  store.set(key, entry);
  if (backend) {
    try {
      Promise.resolve(backend.set(key, entry)).catch(() => {});
    } catch {}
  }
  return value;
}
export function clearCache() {
  store.clear();
}
