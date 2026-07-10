const KEY = "skyhue.favorites";

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
  } catch {}
}

export function placeId(place) {
  return `${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}`;
}

export function getFavorites() {
  return read();
}

export function isFavorite(place) {
  const id = placeId(place);
  return read().some((f) => f.id === id);
}

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

export function removeFavorite(id) {
  const list = read().filter((f) => f.id !== id);
  write(list);
  return list;
}

export function toggleFavorite(place) {
  if (isFavorite(place)) {
    removeFavorite(placeId(place));
    return false;
  }
  addFavorite(place);
  return true;
}
