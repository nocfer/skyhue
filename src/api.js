// api.js — accesso alle API Open-Meteo (meteo + geocoding), senza API key.
// Documentazione: https://open-meteo.com/en/docs

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

/**
 * Cerca una località per nome e restituisce fino a `count` risultati.
 * @returns {Promise<Array<{name,country,admin1,latitude,longitude,timezone}>>}
 */
export async function geocode(query, count = 5, language = 'it') {
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(query)}&count=${count}&language=${language}&format=json`;
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
    forecast_days: '7',
  });
  const url = `${FORECAST_URL}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Previsioni non disponibili (${res.status})`);
  return res.json();
}

/**
 * Scarica i dati di qualità dell'aria (aerosol + particolato) per un punto.
 * Endpoint separato di Open-Meteo, senza API key.
 * @returns {Promise<Object>} risposta grezza (o lancia in caso di errore)
 */
export async function fetchAirQuality(latitude, longitude) {
  const params = new URLSearchParams({
    latitude: latitude.toString(),
    longitude: longitude.toString(),
    hourly: ['aerosol_optical_depth', 'pm2_5', 'pm10'].join(','),
    timezone: 'auto',
    forecast_days: '7',
  });
  const res = await fetch(`${AIR_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`Qualità dell'aria non disponibile (${res.status})`);
  return res.json();
}

/**
 * Valori di aerosol/particolato all'ora più vicina a un istante ISO.
 * @returns {{aerosol:?number, pm25:?number, pm10:?number}}
 */
export function airAtTime(air, targetIso) {
  if (!air || !air.hourly) return { aerosol: null, pm25: null, pm10: null };
  const times = air.hourly.time;
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
  return {
    aerosol: air.hourly.aerosol_optical_depth?.[bestIdx] ?? null,
    pm25: air.hourly.pm2_5?.[bestIdx] ?? null,
    pm10: air.hourly.pm10?.[bestIdx] ?? null,
  };
}

/** Indice dell'ora più vicina a un istante ISO nelle serie orarie. */
export function hourlyIndexOf(forecast, targetIso) {
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
  return bestIdx;
}

/** Condizioni meteo a un dato indice orario. */
export function conditionsAtIndex(forecast, idx) {
  const h = forecast.hourly;
  return {
    index: idx,
    time: h.time[idx],
    cloudCover: h.cloud_cover[idx],
    cloudCoverLow: h.cloud_cover_low[idx],
    cloudCoverMid: h.cloud_cover_mid[idx],
    cloudCoverHigh: h.cloud_cover_high[idx],
    visibility: h.visibility[idx],
    humidity: h.relative_humidity_2m[idx],
    temperature: h.temperature_2m[idx],
  };
}

/**
 * Estrae le condizioni all'ora più vicina a un dato istante ISO.
 * @param {Object} forecast risposta di fetchForecast
 * @param {string} targetIso istante ISO (es. sunset del giorno)
 */
export function conditionsAtTime(forecast, targetIso) {
  return conditionsAtIndex(forecast, hourlyIndexOf(forecast, targetIso));
}

/**
 * Serie di condizioni orarie in una finestra intorno a un istante (es. le ore
 * prima e dopo il tramonto), per costruire una timeline.
 * @returns {Array<ReturnType<typeof conditionsAtIndex>>}
 */
export function conditionsWindow(forecast, targetIso, hoursBefore = 2, hoursAfter = 2) {
  const center = hourlyIndexOf(forecast, targetIso);
  const last = forecast.hourly.time.length - 1;
  const from = Math.max(0, center - hoursBefore);
  const to = Math.min(last, center + hoursAfter);
  const out = [];
  for (let i = from; i <= to; i++) {
    out.push({ ...conditionsAtIndex(forecast, i), isCenter: i === center });
  }
  return out;
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

/**
 * Elenca i giorni disponibili nella previsione, ciascuno con l'orario di alba
 * e tramonto. Utile per la vista multi-giorno.
 * @returns {Array<{dayIndex:number, date:string, sunrise:string, sunset:string}>}
 */
export function dailyList(forecast) {
  const { time, sunrise, sunset } = forecast.daily;
  return time.map((date, i) => ({
    dayIndex: i,
    date,
    sunrise: sunrise[i],
    sunset: sunset[i],
  }));
}
