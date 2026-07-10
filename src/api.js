import { cached, coordKey, TTL } from "./cache.js";

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";

/**
 * @returns {Promise<Array<{name,country,admin1,latitude,longitude,timezone}>>}
 */
export async function geocode(query, count = 5, language = "it") {
  return cached(`geo:${query}|${language}|${count}`, TTL.GEOCODE, async () => {
    const url = `${GEOCODE_URL}?name=${encodeURIComponent(query)}&count=${count}&language=${language}&format=json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
    const data = await res.json();
    return data.results ?? [];
  });
}

export function coordsLabel(lat, lon) {
  return `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`;
}

/**
 * @param {number} latitude
 * @param {number} longitude
 * @param {{signal?:AbortSignal}} [opts]
 * @returns {Promise<Object>}
 */
export async function fetchForecast(latitude, longitude, { signal } = {}) {
  return cached(coordKey("fc", latitude, longitude), TTL.FORECAST, async () => {
    const params = new URLSearchParams({
      latitude: latitude.toString(),
      longitude: longitude.toString(),
      hourly: [
        "cloud_cover",
        "cloud_cover_low",
        "cloud_cover_mid",
        "cloud_cover_high",
        "visibility",
        "relative_humidity_2m",
        "temperature_2m",
      ].join(","),
      daily: ["sunrise", "sunset"].join(","),
      timezone: "auto",
      forecast_days: "7",
    });
    const url = `${FORECAST_URL}?${params.toString()}`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Forecast unavailable (${res.status})`);
    return res.json();
  });
}

/**
 * @param {number} latitude
 * @param {number} longitude
 * @param {{signal?:AbortSignal}} [opts]
 * @returns {Promise<Object>}
 */
export async function fetchAirQuality(latitude, longitude, { signal } = {}) {
  return cached(coordKey("air", latitude, longitude), TTL.AIR, async () => {
    const params = new URLSearchParams({
      latitude: latitude.toString(),
      longitude: longitude.toString(),
      hourly: ["aerosol_optical_depth", "pm2_5", "pm10"].join(","),
      timezone: "auto",
      forecast_days: "7",
    });
    const res = await fetch(`${AIR_URL}?${params.toString()}`, { signal });
    if (!res.ok) throw new Error(`Air quality unavailable (${res.status})`);
    return res.json();
  });
}

/**
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
 * @param {Object} forecast
 * @param {string} targetIso ISO time
 */
export function conditionsAtTime(forecast, targetIso) {
  return conditionsAtIndex(forecast, hourlyIndexOf(forecast, targetIso));
}

/**
 * @returns {Array<ReturnType<typeof conditionsAtIndex>>}
 */
export function conditionsWindow(
  forecast,
  targetIso,
  hoursBefore = 2,
  hoursAfter = 2,
) {
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
