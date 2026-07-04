// api.js — accesso alle API Open-Meteo (meteo + geocoding), senza API key.
// Documentazione: https://open-meteo.com/en/docs

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

/**
 * Cerca una località per nome e restituisce fino a `count` risultati.
 * @returns {Promise<Array<{name,country,admin1,latitude,longitude,timezone}>>}
 */
export async function geocode(query, count = 5) {
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(query)}&count=${count}&language=it&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding fallito (${res.status})`);
  const data = await res.json();
  return data.results ?? [];
}

/**
 * Reverse geocoding approssimato: dato lat/lon, prova a dare un'etichetta.
 * Open-Meteo non offre reverse geocoding, quindi restituiamo le coordinate.
 */
export function coordsLabel(lat, lon) {
  return `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`;
}

/**
 * Scarica le previsioni orarie e i dati astronomici giornalieri per un punto.
 * @returns {Promise<Object>} risposta grezza Open-Meteo
 */
export async function fetchForecast(latitude, longitude) {
  const params = new URLSearchParams({
    latitude: latitude.toString(),
    longitude: longitude.toString(),
    hourly: [
      'cloud_cover',
      'cloud_cover_low',
      'cloud_cover_mid',
      'cloud_cover_high',
      'visibility',
      'relative_humidity_2m',
      'temperature_2m',
    ].join(','),
    daily: ['sunrise', 'sunset'].join(','),
    timezone: 'auto',
    forecast_days: '2',
  });
  const url = `${FORECAST_URL}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Previsioni non disponibili (${res.status})`);
  return res.json();
}

/**
 * Estrae le condizioni all'ora più vicina a un dato istante ISO dalle serie
 * orarie Open-Meteo.
 * @param {Object} forecast risposta di fetchForecast
 * @param {string} targetIso istante ISO (es. sunset del giorno)
 */
export function conditionsAtTime(forecast, targetIso) {
  const times = forecast.hourly.time;
  const target = new Date(targetIso).getTime();

  let bestIdx = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const diff = Math.abs(new Date(times[i]).getTime() - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }

  const h = forecast.hourly;
  return {
    index: bestIdx,
    time: times[bestIdx],
    cloudCover: h.cloud_cover[bestIdx],
    cloudCoverLow: h.cloud_cover_low[bestIdx],
    cloudCoverMid: h.cloud_cover_mid[bestIdx],
    cloudCoverHigh: h.cloud_cover_high[bestIdx],
    visibility: h.visibility[bestIdx],
    humidity: h.relative_humidity_2m[bestIdx],
    temperature: h.temperature_2m[bestIdx],
  };
}

/**
 * Sceglie il prossimo tramonto utile (oggi se non ancora passato, altrimenti
 * domani) dalla sezione daily.
 * @returns {{sunset:string, sunrise:string, dayIndex:number}}
 */
export function nextSunset(forecast, now = new Date()) {
  const sunsets = forecast.daily.sunset;
  const sunrises = forecast.daily.sunrise;
  for (let i = 0; i < sunsets.length; i++) {
    if (new Date(sunsets[i]).getTime() >= now.getTime()) {
      return { sunset: sunsets[i], sunrise: sunrises[i], dayIndex: i };
    }
  }
  const last = sunsets.length - 1;
  return { sunset: sunsets[last], sunrise: sunrises[last], dayIndex: last };
}
