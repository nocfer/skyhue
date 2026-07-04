// Test della matematica pura dei punti panoramici. Esegui con: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceKm, bearing, kindInfo } from '../src/spots.js';

test('distanceKm ~0 per lo stesso punto', () => {
  assert.ok(distanceKm(38.0, 12.0, 38.0, 12.0) < 1e-6);
});

test('distanceKm plausibile su una distanza nota', () => {
  // Favignana → Trapani ≈ 15-20 km
  const d = distanceKm(37.931, 12.328, 38.017, 12.514);
  assert.ok(d > 10 && d < 30, `distanza inattesa: ${d}`);
});

test('bearing verso est ≈ 90°', () => {
  const b = bearing(0, 0, 0, 1);
  assert.ok(Math.abs(b - 90) < 1, `bearing est inatteso: ${b}`);
});

test('bearing verso nord ≈ 0°', () => {
  const b = bearing(0, 0, 1, 0);
  assert.ok(b < 1 || b > 359, `bearing nord inatteso: ${b}`);
});

test('kindInfo ha etichetta e icona', () => {
  const info = kindInfo('lighthouse');
  assert.equal(info.label, 'Faro');
  assert.ok(info.icon);
  // tipo sconosciuto → fallback
  assert.ok(kindInfo('boh').label);
});
