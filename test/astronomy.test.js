// Test delle funzioni astronomiche pure. Esegui con: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sunPosition, twilightTimes, azimuthToCardinal } from '../src/astronomy.js';

test('azimuthToCardinal mappa i quadranti principali', () => {
  assert.equal(azimuthToCardinal(0), 'N');
  assert.equal(azimuthToCardinal(90), 'E');
  assert.equal(azimuthToCardinal(180), 'S');
  assert.equal(azimuthToCardinal(270), 'O');
});

test('twilightTimes: golden → tramonto → blue in ordine (sera)', () => {
  const lat = 40.85;
  const lon = 14.27;
  // Sera d'estate vicino al tramonto: il sole sta scendendo.
  const evening = new Date('2026-07-05T18:30:00Z');
  const { descending, golden, event, blue } = twilightTimes(evening, lat, lon);
  assert.equal(descending, true);
  assert.ok(golden && event && blue, 'tutti i passaggi trovati');
  assert.ok(golden.getTime() < event.getTime(), 'golden prima del tramonto');
  assert.ok(event.getTime() < blue.getTime(), 'tramonto prima della blue hour');
});

test('twilightTimes: alle ore trovate l’elevazione del sole è ~ al target', () => {
  const lat = 40.85;
  const lon = 14.27;
  const evening = new Date('2026-07-05T18:30:00Z');
  const { golden, event, blue } = twilightTimes(evening, lat, lon);
  assert.ok(Math.abs(sunPosition(golden, lat, lon).elevation - 6) < 0.5);
  assert.ok(Math.abs(sunPosition(event, lat, lon).elevation + 0.833) < 0.5);
  assert.ok(Math.abs(sunPosition(blue, lat, lon).elevation + 6) < 0.5);
});
