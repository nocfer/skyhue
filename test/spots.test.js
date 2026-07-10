// Tests for the pure math of the scenic spots. Run with: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
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
  horizonDistanceKm,
} from "../src/spots.js";

test("distanceKm ~0 for the same point", () => {
  assert.ok(distanceKm(38.0, 12.0, 38.0, 12.0) < 1e-6);
});

test("distanceKm plausible over a known distance", () => {
  // Favignana → Trapani ≈ 15-20 km
  const d = distanceKm(37.931, 12.328, 38.017, 12.514);
  assert.ok(d > 10 && d < 30, `distanza inattesa: ${d}`);
});

test("bearing towards east ≈ 90°", () => {
  const b = bearing(0, 0, 0, 1);
  assert.ok(Math.abs(b - 90) < 1, `bearing est inatteso: ${b}`);
});

test("bearing towards north ≈ 0°", () => {
  const b = bearing(0, 0, 1, 0);
  assert.ok(b < 1 || b > 359, `bearing nord inatteso: ${b}`);
});

test("kindInfo has a label key and an icon", () => {
  const info = kindInfo("lighthouse");
  assert.equal(info.labelKey, "kind.lighthouse");
  assert.ok(info.icon);
  // unknown kind → fallback
  assert.ok(kindInfo("boh").labelKey);
});

test("destinationPoint towards east shifts the longitude, not the latitude", () => {
  const p = destinationPoint(40, 12, 90, 10);
  assert.ok(p.lon > 12, "longitude should increase towards east");
  assert.ok(Math.abs(p.lat - 40) < 0.05, "latitude nearly unchanged");
});

test("destinationPoint towards north increases the latitude", () => {
  const p = destinationPoint(40, 12, 0, 11.1);
  assert.ok(p.lat > 40.09 && p.lat < 40.11, `lat inattesa: ${p.lat}`);
});

test("evaluateHorizon: open sea → unobstructed, lots of water", () => {
  const h = evaluateHorizon(5, [
    { distKm: 0.4, elev: 0 },
    { distKm: 1, elev: 0 },
    { distKm: 3, elev: 0 },
  ]);
  assert.equal(h.obstructed, false);
  assert.equal(h.seaFraction, 1);
});

test("evaluateHorizon: hill in front of a low point → obstructed", () => {
  const h = evaluateHorizon(2, [
    { distKm: 0.4, elev: 60 }, // ~8.5° of elevation: blocks the sun
    { distKm: 1, elev: 40 },
  ]);
  assert.equal(h.obstructed, true);
});

test("spotVerdict: obstructed penalizes and flags it", () => {
  const openSea = spotVerdict("viewpoint", {
    obstructed: false,
    seaFraction: 1,
    maxAngle: 0,
  });
  const blocked = spotVerdict("viewpoint", {
    obstructed: true,
    seaFraction: 0,
    maxAngle: 8,
  });
  assert.ok(blocked.score < openSea.score);
  assert.equal(blocked.sentiment, "bad");
  assert.equal(openSea.sentiment, "good");
});

test("spotVerdict: without elevation data it stays neutral", () => {
  const v = spotVerdict("beach", null);
  assert.equal(v.sentiment, "neutral");
  assert.ok(v.score > 0);
});

test("horizonDistanceKm grows with the elevation (0 at sea level)", () => {
  assert.equal(horizonDistanceKm(0), 0);
  // from ~100 m the horizon is ~35 km; from 400 m ~71 km
  assert.ok(Math.abs(horizonDistanceKm(100) - 35.7) < 1);
  assert.ok(horizonDistanceKm(400) > horizonDistanceKm(100));
  assert.equal(horizonDistanceKm(-5), 0); // negative elevations → 0
});

test("angleDiff handles the wrap-around", () => {
  assert.equal(angleDiff(10, 350), 20);
  assert.equal(angleDiff(0, 180), 180);
  assert.equal(angleDiff(90, 90), 0);
});

test("driveMinutes grows with the distance and is always ≥1", () => {
  assert.ok(driveMinutes(0) >= 1);
  assert.ok(driveMinutes(25) > driveMinutes(5));
  // ~25 km should be in the range of 30-45 min by car
  assert.ok(driveMinutes(25) >= 25 && driveMinutes(25) <= 60);
});

test("gridCandidates stays within the radius and is not empty", () => {
  const pts = gridCandidates(38, 12, 20, 9);
  assert.ok(pts.length > 10);
  for (const p of pts) {
    const d = distanceKm(38, 12, p.lat, p.lon);
    assert.ok(d <= 20 + 0.5, `punto fuori raggio: ${d}`);
  }
});

test("prescoreGrid excludes the sea and rewards coastal points", () => {
  // 3 points: [0]=sea, [1]=coastal land (near the sea), [2]=far inland
  const points = [
    { lat: 38.0, lon: 12.0 }, // sea
    { lat: 38.01, lon: 12.0 }, // land ~1.1 km from the sea
    { lat: 38.5, lon: 12.0 }, // inland, far away
  ];
  const elevations = [0, 30, 40];
  const scored = prescoreGrid(points, elevations, 2);
  assert.equal(scored[0].prescore, -Infinity, "il punto in mare va escluso");
  assert.equal(scored[1].coastal, true, "il punto vicino al mare è costiero");
  assert.ok(
    scored[1].prescore > scored[2].prescore,
    "il costiero batte l’interno",
  );
});
