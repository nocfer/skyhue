// Test del campionamento lungo il raggio del sole. Esegui con: node --test
// Solo le parti pure: niente rete, fixture di risposte Open-Meteo in miniatura.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIGHT_PATH_DISTANCES,
  epochOfLocal,
  sampleAtEpoch,
  lightPathClearAt,
} from '../src/lightpath.js';

/** Fixture di forecast Open-Meteo: 3 ore attorno alle 20 locali. */
function fixtureForecast({ offset = 7200, low = [0, 0, 0], mid = [0, 0, 0], high = [0, 0, 0] } = {}) {
  return {
    utc_offset_seconds: offset,
    hourly: {
      time: ['2026-07-08T19:00', '2026-07-08T20:00', '2026-07-08T21:00'],
      cloud_cover_low: low,
      cloud_cover_mid: mid,
      cloud_cover_high: high,
    },
  };
}

test('le distanze di campionamento sono crescenti e nel raggio utile', () => {
  for (let i = 1; i < LIGHT_PATH_DISTANCES.length; i++) {
    assert.ok(LIGHT_PATH_DISTANCES[i] > LIGHT_PATH_DISTANCES[i - 1]);
  }
  assert.ok(LIGHT_PATH_DISTANCES[0] >= 30);
  assert.ok(LIGHT_PATH_DISTANCES.at(-1) <= 300);
});

test('epochOfLocal converte il wall-clock col suo offset', () => {
  // 20:00 a UTC+2 = 18:00 UTC.
  assert.equal(epochOfLocal('2026-07-08T20:00', 7200), Date.parse('2026-07-08T18:00Z'));
  // Stessa parete a UTC+1 è un'ora DOPO in tempo assoluto.
  assert.equal(
    epochOfLocal('2026-07-08T20:00', 3600) - epochOfLocal('2026-07-08T20:00', 7200),
    3600 * 1000
  );
});

test('sampleAtEpoch prende l’ora giusta anche con fusi diversi', () => {
  // Osservatore a UTC+2, evento alle 20:00 locali = 18:00 UTC.
  const epoch = epochOfLocal('2026-07-08T20:00', 7200);
  // Campione a UTC+1: le 18:00 UTC lì sono le 19:00 di parete → indice 0.
  const campione = fixtureForecast({ offset: 3600, low: [55, 0, 0] });
  assert.equal(sampleAtEpoch(campione, epoch).cloudCoverLow, 55);
  // Stesso fuso dell'osservatore → indice 1 (le 20:00 di parete).
  const locale = fixtureForecast({ offset: 7200, low: [0, 66, 0] });
  assert.equal(sampleAtEpoch(locale, epoch).cloudCoverLow, 66);
});

test('sampleAtEpoch è null senza dati orari', () => {
  assert.equal(sampleAtEpoch(null, 0), null);
  assert.equal(sampleAtEpoch({ hourly: { time: [] } }, 0), null);
});

test('lightPathClearAt salta i campioni falliti e degrada a null sotto i 2', () => {
  const observer = fixtureForecast({ offset: 7200 });
  const ok = (distKm) => ({ distKm, lat: 0, lon: 0, forecast: fixtureForecast({ offset: 7200 }) });
  const ko = (distKm) => ({ distKm, lat: 0, lon: 0, forecast: null });

  // 2 campioni validi bastano: cielo sereno → quasi 1.
  const due = lightPathClearAt({ points: [ok(40), ko(90), ok(160), ko(250)] }, observer, '2026-07-08T20:00');
  assert.ok(due > 0.95, `atteso > 0.95, ottenuto ${due}`);

  // 1 solo valido → null (neutro).
  const uno = lightPathClearAt({ points: [ok(40), ko(90), ko(160), ko(250)] }, observer, '2026-07-08T20:00');
  assert.equal(uno, null);

  // Input degeneri → null.
  assert.equal(lightPathClearAt(null, observer, '2026-07-08T20:00'), null);
  assert.equal(lightPathClearAt({ points: [] }, null, '2026-07-08T20:00'), null);
});

test('lightPathClearAt vede il muro all’ora dell’evento', () => {
  const observer = fixtureForecast({ offset: 7200 });
  // Muro di basse alle 20:00 locali nei campioni lontani, sereno nelle altre ore.
  const murato = (distKm) => ({
    distKm,
    lat: 0,
    lon: 0,
    forecast: fixtureForecast({ offset: 7200, low: [0, 100, 0] }),
  });
  const clear = lightPathClearAt(
    { points: [murato(40), murato(90), murato(160), murato(250)] },
    observer,
    '2026-07-08T20:00'
  );
  assert.ok(clear < 0.15, `atteso < 0.15, ottenuto ${clear}`);
});
