// Tests for the pure astronomy functions. Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sunPosition,
  twilightTimes,
  azimuthToCardinal,
  moonIllumination,
} from '../src/astronomy.js';

test('azimuthToCardinal maps the main quadrants', () => {
  assert.equal(azimuthToCardinal(0), 'N');
  assert.equal(azimuthToCardinal(90), 'E');
  assert.equal(azimuthToCardinal(180), 'S');
  assert.equal(azimuthToCardinal(270), 'O');
});

test('moonIllumination maps the phase fraction to the lit fraction', () => {
  assert.ok(Math.abs(moonIllumination(0)) < 1e-9, 'new moon → 0');
  assert.ok(Math.abs(moonIllumination(0.5) - 1) < 1e-9, 'full moon → 1');
  assert.ok(Math.abs(moonIllumination(0.25) - 0.5) < 1e-9, 'first quarter → 0.5');
  assert.ok(Math.abs(moonIllumination(0.75) - 0.5) < 1e-9, 'last quarter → 0.5');
});

test('twilightTimes: golden → sunset → blue in order (evening)', () => {
  const lat = 40.85;
  const lon = 14.27;
  // Summer evening near sunset: the sun is descending.
  const evening = new Date('2026-07-05T18:30:00Z');
  const { descending, golden, event, blue } = twilightTimes(evening, lat, lon);
  assert.equal(descending, true);
  assert.ok(golden && event && blue, 'all crossings found');
  assert.ok(golden.getTime() < event.getTime(), 'golden hour before sunset');
  assert.ok(event.getTime() < blue.getTime(), 'sunset before the blue hour');
});

test('twilightTimes: at the found times the sun elevation is ~ at the target', () => {
  const lat = 40.85;
  const lon = 14.27;
  const evening = new Date('2026-07-05T18:30:00Z');
  const { golden, event, blue } = twilightTimes(evening, lat, lon);
  assert.ok(Math.abs(sunPosition(golden, lat, lon).elevation - 6) < 0.5);
  assert.ok(Math.abs(sunPosition(event, lat, lon).elevation + 0.833) < 0.5);
  assert.ok(Math.abs(sunPosition(blue, lat, lon).elevation + 6) < 0.5);
});
