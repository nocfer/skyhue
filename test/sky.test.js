// Tests for the sky palette generation. Run with: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { skyGradient, skyGradientCss } from "../src/sky.js";
import { computeSunsetScore } from "../src/score.js";

const vivid = computeSunsetScore({
  cloudCover: 45,
  cloudCoverLow: 5,
  cloudCoverMid: 40,
  cloudCoverHigh: 50,
  visibility: 22000,
  humidity: 45,
});

const overcast = computeSunsetScore({
  cloudCover: 100,
  cloudCoverLow: 95,
  cloudCoverMid: 80,
  cloudCoverHigh: 40,
  visibility: 8000,
  humidity: 90,
});

test("skyGradient returns 4 stops", () => {
  const stops = skyGradient(vivid.factors, vivid.score);
  assert.equal(stops.length, 4);
  for (const s of stops) {
    assert.ok(s.h >= 0 && s.h <= 360);
    assert.ok(s.s >= 0 && s.s <= 100);
    assert.ok(s.l >= 0 && s.l <= 100);
  }
});

test("an overcast sky is less saturated than a vivid one", () => {
  const avgSat = (r) =>
    skyGradient(r.factors, r.score).reduce((a, s) => a + s.s, 0) / 4;
  assert.ok(
    avgSat(overcast) < avgSat(vivid),
    `coperto (${avgSat(overcast)}) dovrebbe essere < vivido (${avgSat(vivid)})`,
  );
});

test("skyGradientCss produces a valid linear-gradient", () => {
  const css = skyGradientCss(skyGradient(vivid.factors, vivid.score));
  assert.match(css, /^linear-gradient\(180deg, hsl\(/);
  assert.ok(css.includes("0%") && css.includes("100%"));
});
