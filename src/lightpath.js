// lightpath.js — campionamento delle nuvole lungo il raggio verso il sole.
// La luce radente che colora il tramonto attraversa la bassa atmosfera a
// 40-250 km di distanza in direzione del sole PRIMA di raggiungere le nuvole
// sopra l'osservatore: qui si scaricano le previsioni in quei punti e si
// ricava il campione all'ora giusta. La matematica del punteggio resta in
// score.js (lightPathFactor), così rimane pura e testabile.

import { fetchForecast } from './api.js';
import { destinationPoint } from './spots.js';
import { lightPathFactor } from './score.js';

// Distanze (km) dei campioni lungo l'azimut del sole. Molto oltre i campioni
// del terreno (SAMPLE_DISTANCES in spots.js): qui interessa l'atmosfera
// lontana, dove il raggio radente passa basso (h(d) ≈ d²/2R).
export const LIGHT_PATH_DISTANCES = [40, 90, 160, 250];

/**
 * Scarica le previsioni nei punti campione lungo l'azimut del sole.
 * Ogni fetch è indipendente e tollera il fallimento (forecast: null): con
 * almeno due campioni validi il fattore resta calcolabile. Le risposte coprono
 * 7 giorni di orari, quindi un solo giro serve punteggio principale, timeline
 * e striscia multi-giorno; passano tutte dalla cache `fc:` di api.js.
 *
 * @param {number} lat latitudine dell'osservatore
 * @param {number} lon longitudine dell'osservatore
 * @param {number} azimuth azimut dell'evento in gradi (0=N, 90=E)
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

/**
 * Epoch (ms) di un orario wall-clock Open-Meteo ("2026-07-08T20:00", senza
 * offset) dato l'`utc_offset_seconds` della risposta che lo contiene.
 * Necessario perché con timezone=auto ogni punto campione parla nel PROPRIO
 * fuso: confrontare le stringhe come fa hourlyIndexOf (new Date(iso), fuso del
 * browser) sbaglierebbe di un'ora quando il raggio attraversa un confine.
 */
export function epochOfLocal(isoLocal, utcOffsetSeconds) {
  return Date.parse(`${isoLocal}Z`) - (utcOffsetSeconds ?? 0) * 1000;
}

/**
 * Coperture nuvolose del forecast all'ora più vicina all'epoch dato.
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
 * Chiarezza del percorso della luce (0-1) all'istante `targetIso`, dove
 * `targetIso` è un orario wall-clock del forecast DELL'OSSERVATORE (es. il
 * daily.sunset). I campioni falliti vengono saltati; sotto i 2 validi il
 * risultato è null (neutro).
 *
 * @param {{points:Array}} lightPath risultato di fetchLightPath
 * @param {Object} observerForecast forecast dell'osservatore (per il fuso)
 * @param {string} targetIso orario dell'evento nel fuso dell'osservatore
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
