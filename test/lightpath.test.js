// Tests for the sampling along the sun ray. Run with: node --test
// Only the pure parts: no network, miniature Open-Meteo response fixtures.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIGHT_PATH_DISTANCES,
  epochOfLocal,
  sampleAtEpoch,
  lightPathClearAt,
} from "../src/lightpath.js";

/** Open-Meteo forecast fixture: 3 hours around 20:00 local. */
function fixtureForecast({
  offset = 7200,
  low = [0, 0, 0],
  mid = [0, 0, 0],
  high = [0, 0, 0],
} = {}) {
  return {
    utc_offset_seconds: offset,
    hourly: {
      time: ["2026-07-08T19:00", "2026-07-08T20:00", "2026-07-08T21:00"],
      cloud_cover_low: low,
      cloud_cover_mid: mid,
      cloud_cover_high: high,
    },
  };
}

test("the sampling distances are increasing and within the useful range", () => {
  for (let i = 1; i < LIGHT_PATH_DISTANCES.length; i++) {
    assert.ok(LIGHT_PATH_DISTANCES[i] > LIGHT_PATH_DISTANCES[i - 1]);
  }
  assert.ok(LIGHT_PATH_DISTANCES[0] >= 30);
  assert.ok(LIGHT_PATH_DISTANCES.at(-1) <= 300);
});

test("epochOfLocal converts the wall-clock with its offset", () => {
  // 20:00 at UTC+2 = 18:00 UTC.
  assert.equal(
    epochOfLocal("2026-07-08T20:00", 7200),
    Date.parse("2026-07-08T18:00Z"),
  );
  // The same wall-clock time at UTC+1 is one hour LATER in absolute time.
  assert.equal(
    epochOfLocal("2026-07-08T20:00", 3600) -
      epochOfLocal("2026-07-08T20:00", 7200),
    3600 * 1000,
  );
});

test("sampleAtEpoch picks the right hour even across time zones", () => {
  // Observer at UTC+2, event at 20:00 local = 18:00 UTC.
  const epoch = epochOfLocal("2026-07-08T20:00", 7200);
  // Sample at UTC+1: 18:00 UTC is 19:00 wall-clock there → index 0.
  const campione = fixtureForecast({ offset: 3600, low: [55, 0, 0] });
  assert.equal(sampleAtEpoch(campione, epoch).cloudCoverLow, 55);
  // Same time zone as the observer → index 1 (20:00 wall-clock).
  const locale = fixtureForecast({ offset: 7200, low: [0, 66, 0] });
  assert.equal(sampleAtEpoch(locale, epoch).cloudCoverLow, 66);
});

test("sampleAtEpoch is null without hourly data", () => {
  assert.equal(sampleAtEpoch(null, 0), null);
  assert.equal(sampleAtEpoch({ hourly: { time: [] } }, 0), null);
});

test("lightPathClearAt skips failed samples and degrades to null below 2", () => {
  const observer = fixtureForecast({ offset: 7200 });
  const ok = (distKm) => ({
    distKm,
    lat: 0,
    lon: 0,
    forecast: fixtureForecast({ offset: 7200 }),
  });
  const ko = (distKm) => ({ distKm, lat: 0, lon: 0, forecast: null });

  // 2 valid samples are enough: clear sky → almost 1.
  const due = lightPathClearAt(
    { points: [ok(40), ko(90), ok(160), ko(250)] },
    observer,
    "2026-07-08T20:00",
  );
  assert.ok(due > 0.95, `atteso > 0.95, ottenuto ${due}`);

  // Only 1 valid → null (neutral).
  const uno = lightPathClearAt(
    { points: [ok(40), ko(90), ko(160), ko(250)] },
    observer,
    "2026-07-08T20:00",
  );
  assert.equal(uno, null);

  // Degenerate input → null.
  assert.equal(lightPathClearAt(null, observer, "2026-07-08T20:00"), null);
  assert.equal(
    lightPathClearAt({ points: [] }, null, "2026-07-08T20:00"),
    null,
  );
});

test("lightPathClearAt sees the wall at the event time", () => {
  const observer = fixtureForecast({ offset: 7200 });
  // Wall of low clouds at 20:00 local in the far samples, clear at the other hours.
  const murato = (distKm) => ({
    distKm,
    lat: 0,
    lon: 0,
    forecast: fixtureForecast({ offset: 7200, low: [0, 100, 0] }),
  });
  const clear = lightPathClearAt(
    { points: [murato(40), murato(90), murato(160), murato(250)] },
    observer,
    "2026-07-08T20:00",
  );
  assert.ok(clear < 0.15, `atteso < 0.15, ottenuto ${clear}`);
});
