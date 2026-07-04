// Test della matematica pura dei punti panoramici. Esegui con: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  distanceKm,
  bearing,
  kindInfo,
  destinationPoint,
  evaluateHorizon,
  spotVerdict,
  angleDiff,
  driveMinutes,
  gridCandidates,
  prescoreGrid,
} from '../src/spots.js';

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

test('destinationPoint verso est sposta la longitudine, non la latitudine', () => {
  const p = destinationPoint(40, 12, 90, 10);
  assert.ok(p.lon > 12, 'longitudine dovrebbe aumentare verso est');
  assert.ok(Math.abs(p.lat - 40) < 0.05, 'latitudine quasi invariata');
});

test('destinationPoint verso nord aumenta la latitudine', () => {
  const p = destinationPoint(40, 12, 0, 11.1);
  assert.ok(p.lat > 40.09 && p.lat < 40.11, `lat inattesa: ${p.lat}`);
});

test('evaluateHorizon: mare aperto → non ostruito, molta acqua', () => {
  const h = evaluateHorizon(5, [
    { distKm: 0.4, elev: 0 },
    { distKm: 1, elev: 0 },
    { distKm: 3, elev: 0 },
  ]);
  assert.equal(h.obstructed, false);
  assert.equal(h.seaFraction, 1);
});

test('evaluateHorizon: collina davanti a un punto basso → ostruito', () => {
  const h = evaluateHorizon(2, [
    { distKm: 0.4, elev: 60 }, // ~8.5° di elevazione: blocca il sole
    { distKm: 1, elev: 40 },
  ]);
  assert.equal(h.obstructed, true);
});

test('spotVerdict: ostruito penalizza e segnala', () => {
  const openSea = spotVerdict('viewpoint', { obstructed: false, seaFraction: 1, maxAngle: 0 });
  const blocked = spotVerdict('viewpoint', { obstructed: true, seaFraction: 0, maxAngle: 8 });
  assert.ok(blocked.score < openSea.score);
  assert.equal(blocked.sentiment, 'bad');
  assert.equal(openSea.sentiment, 'good');
});

test('spotVerdict: senza dati di quota resta neutro', () => {
  const v = spotVerdict('beach', null);
  assert.equal(v.sentiment, 'neutral');
  assert.ok(v.score > 0);
});

test('angleDiff gestisce il wrap-around', () => {
  assert.equal(angleDiff(10, 350), 20);
  assert.equal(angleDiff(0, 180), 180);
  assert.equal(angleDiff(90, 90), 0);
});

test('driveMinutes cresce con la distanza ed è sempre ≥1', () => {
  assert.ok(driveMinutes(0) >= 1);
  assert.ok(driveMinutes(25) > driveMinutes(5));
  // ~25 km dovrebbero stare nell'ordine dei 30-45 min in auto
  assert.ok(driveMinutes(25) >= 25 && driveMinutes(25) <= 60);
});

test('gridCandidates resta entro il raggio e non è vuota', () => {
  const pts = gridCandidates(38, 12, 20, 9);
  assert.ok(pts.length > 10);
  for (const p of pts) {
    const d = distanceKm(38, 12, p.lat, p.lon);
    assert.ok(d <= 20 + 0.5, `punto fuori raggio: ${d}`);
  }
});

test('prescoreGrid esclude il mare e premia i punti costieri', () => {
  // 3 punti: [0]=mare, [1]=terra costiera (vicino al mare), [2]=terra interna lontana
  const points = [
    { lat: 38.0, lon: 12.0 }, // mare
    { lat: 38.01, lon: 12.0 }, // terra ~1.1 km dal mare
    { lat: 38.5, lon: 12.0 }, // terra interna, lontana
  ];
  const elevations = [0, 30, 40];
  const scored = prescoreGrid(points, elevations, 2);
  assert.equal(scored[0].prescore, -Infinity, 'il punto in mare va escluso');
  assert.equal(scored[1].coastal, true, 'il punto vicino al mare è costiero');
  assert.ok(scored[1].prescore > scored[2].prescore, 'il costiero batte l’interno');
});
