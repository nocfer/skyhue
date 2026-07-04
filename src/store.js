// store.js — persistenza delle località preferite in localStorage.
// Funziona anche se localStorage non è disponibile (fallback in memoria).

const KEY = 'skyhue.favorites';

let memory = [];

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return memory;
  }
}

function write(list) {
  memory = list;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage non disponibile: resta in memoria per la sessione */
  }
}

/** Identificativo stabile di una località (coordinate arrotondate). */
export function placeId(place) {
  return `${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}`;
}

/** @returns {Array<{id,latitude,longitude,label}>} preferiti salvati. */
export function getFavorites() {
  return read();
}

export function isFavorite(place) {
  const id = placeId(place);
  return read().some((f) => f.id === id);
}

/** Aggiunge (o aggiorna) un preferito e restituisce la lista aggiornata. */
export function addFavorite(place) {
  const id = placeId(place);
  const list = read().filter((f) => f.id !== id);
  list.unshift({
    id,
    latitude: place.latitude,
    longitude: place.longitude,
    label: place.label,
  });
  write(list);
  return list;
}

/** Rimuove un preferito per id e restituisce la lista aggiornata. */
export function removeFavorite(id) {
  const list = read().filter((f) => f.id !== id);
  write(list);
  return list;
}

/** Alterna lo stato di preferito e restituisce true se ora è salvato. */
export function toggleFavorite(place) {
  if (isFavorite(place)) {
    removeFavorite(placeId(place));
    return false;
  }
  addFavorite(place);
  return true;
}
