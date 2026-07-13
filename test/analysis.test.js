// Tests for the analysis domain's pure view-model builder. resultsModel() and
// evaluateDay() are synchronous and DOM-free, so we can drive them by seeding
// the store with a forecast fixture — no network, no browser. (The async
// loaders need fetch injection, which api.js does not expose yet — a follow-up.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { update } from "../src/state.js";
import { resultsModel } from "../src/analysis.js";

// A minimal 2-day forecast in Open-Meteo's columnar shape (parallel arrays),
// matching what api.js's dailyList / conditionsAtTime / conditionsWindow read.
// Values are plausible, not real.
function fixtureForecast() {
  const time = [];
  const cols = {
    cloud_cover: [],
    cloud_cover_low: [],
    cloud_cover_mid: [],
    cloud_cover_high: [],
    visibility: [],
    relative_humidity_2m: [],
    temperature_2m: [],
  };
  for (const dd of ["01", "02"]) {
    for (let h = 0; h <= 23; h++) {
      const hh = String(h).padStart(2, "0");
      time.push(`2024-06-${dd}T${hh}:00`);
      cols.cloud_cover.push(40);
      cols.cloud_cover_low.push(20);
      cols.cloud_cover_mid.push(30);
      cols.cloud_cover_high.push(50);
      cols.visibility.push(20000);
      cols.relative_humidity_2m.push(55);
      cols.temperature_2m.push(22);
    }
  }
  return {
    daily: {
      time: ["2024-06-01", "2024-06-02"],
      sunrise: ["2024-06-01T05:30", "2024-06-02T05:29"],
      sunset: ["2024-06-01T20:00", "2024-06-02T20:01"],
    },
    hourly: { time, ...cols },
    latitude: 41.9,
    longitude: 12.5,
  };
}

test("resultsModel builds a day model + a scored week from state", () => {
  update({
    place: { latitude: 41.9, longitude: 12.5, label: "Roma" },
    forecast: fixtureForecast(),
    air: null,
    event: "sunset",
    dayIndex: 0,
    lightPath: null,
  });

  const model = resultsModel();

  // Week: one entry per daily day, each with a 0–100 score.
  assert.equal(model.scored.length, 2);
  for (const row of model.scored) {
    assert.ok(
      row.score >= 0 && row.score <= 100,
      `score in range: ${row.score}`,
    );
    assert.ok(row.date instanceof Date);
  }

  // Day model: the shape render() destructures.
  const { day } = model;
  assert.ok(day.score >= 0 && day.score <= 100);
  assert.equal(day.event, "sunset");
  assert.equal(day.place.label, "Roma");
  assert.ok(Array.isArray(day.notes)); // explainScore output
  assert.ok(day.timeline.length > 0); // hours around the event
  assert.ok(day.sun && typeof day.sun.azimuth === "number");
});

test("dayIndex selects which day the model describes", () => {
  update({
    place: { latitude: 41.9, longitude: 12.5, label: "Roma" },
    forecast: fixtureForecast(),
    air: null,
    event: "sunset",
    dayIndex: 1,
    lightPath: null,
  });
  // day.day is the daily-list entry for the selected index (TZ-independent).
  assert.equal(resultsModel().day.day.date, "2024-06-02");
});
