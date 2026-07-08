import { fetchForecast } from './api.js';
import { destinationPoint } from './spots.js';
import { lightPathFactor } from './score.js';

export const LIGHT_PATH_DISTANCES = [40, 90, 160, 250];

/**
 * @param {number} lat
 * @param {number} lon
 * @param {number} azimuth
 * @returns {Promise<{azimuth:number, points:Array<{distKm:number, lat:number, lon:number, forecast:Object|null}>}>}
 */
export async function fetchLightPath(lat, lon, azimuth) {
  const points = await Promise.all(
    LIGHT_PATH_DISTANCES.map(async (distKm) => {
      const p = destinationPoint(lat, lon, azimuth, distKm);
      const forecast = await fetchForecast(p.lat, p.lon).catch(() => null);
      return { distKm, lat: p.lat, lon: p.lon, forecast };
    })
  );
  return { azimuth, points };
}

export function epochOfLocal(isoLocal, utcOffsetSeconds) {
  return Date.parse(`${isoLocal}Z`) - (utcOffsetSeconds ?? 0) * 1000;
}

/**
 * @returns {{cloudCoverLow:number, cloudCoverMid:number, cloudCoverHigh:number}|null}
 */
export function sampleAtEpoch(forecast, epochMs) {
  const h = forecast?.hourly;
  const times = h?.time;
  if (!times || !times.length) return null;
  const off = forecast.utc_offset_seconds ?? 0;
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const diff = Math.abs(epochOfLocal(times[i], off) - epochMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return {
    cloudCoverLow: h.cloud_cover_low?.[best],
    cloudCoverMid: h.cloud_cover_mid?.[best],
    cloudCoverHigh: h.cloud_cover_high?.[best],
  };
}

/**
 * @param {{points:Array}} lightPath
 * @param {Object} observerForecast
 * @param {string} targetIso
 * @returns {number|null}
 */
export function lightPathClearAt(lightPath, observerForecast, targetIso) {
  if (!lightPath?.points || !observerForecast || !targetIso) return null;
  const epoch = epochOfLocal(targetIso, observerForecast.utc_offset_seconds ?? 0);
  const samples = lightPath.points
    .map((p) => {
      const s = sampleAtEpoch(p.forecast, epoch);
      return s ? { distKm: p.distKm, ...s } : null;
    })
    .filter(Boolean);
  return lightPathFactor(samples);
}
