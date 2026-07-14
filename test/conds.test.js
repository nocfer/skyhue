// Tests for the conditions vocabulary. Run with: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { condKey, condDesc } from "../src/conds.js";

test("high cloud bands (lit cirrus is the favorable window)", () => {
  assert.equal(condKey("high", 0), "fewHigh");
  assert.equal(condKey("high", 19), "fewHigh");
  assert.equal(condKey("high", 20), "litCirrus"); // lower edge, inclusive
  assert.equal(condKey("high", 50), "litCirrus");
  assert.equal(condKey("high", 75), "litCirrus"); // upper edge, inclusive
  assert.equal(condKey("high", 76), "heavyHigh");
  assert.equal(condKey("high", 100), "heavyHigh");
});

test("low cloud bands (below is better)", () => {
  assert.equal(condKey("low", 0), "clearHorizon");
  assert.equal(condKey("low", 14), "clearHorizon");
  assert.equal(condKey("low", 15), "someLow"); // 15 is not < 15
  assert.equal(condKey("low", 39), "someLow");
  assert.equal(condKey("low", 40), "blockedLow");
});

test("visibility bands in km (above is better)", () => {
  assert.equal(condKey("vis", 5), "hazyVis");
  assert.equal(condKey("vis", 9.9), "hazyVis");
  assert.equal(condKey("vis", 10), "okVis");
  assert.equal(condKey("vis", 19.9), "okVis");
  assert.equal(condKey("vis", 20), "crispAir");
});

test("light-path bands (fraction, above is better)", () => {
  assert.equal(condKey("path", 0), "pathBlocked");
  assert.equal(condKey("path", 0.44), "pathBlocked");
  assert.equal(condKey("path", 0.45), "pathPartial");
  assert.equal(condKey("path", 0.79), "pathPartial");
  assert.equal(condKey("path", 0.8), "pathClear");
  assert.equal(condKey("path", 1), "pathClear");
});

test("humidity bands (below is better)", () => {
  assert.equal(condKey("hum", 0), "dryAir");
  assert.equal(condKey("hum", 50), "dryAir");
  assert.equal(condKey("hum", 51), "okHum");
  assert.equal(condKey("hum", 70), "okHum");
  assert.equal(condKey("hum", 71), "humidAir");
});

test("an unknown type falls back to the humidity bands", () => {
  assert.equal(condKey("nonsense", 30), condKey("hum", 30));
  assert.equal(condKey(undefined, 90), "humidAir");
});

test("condDesc marks only the truly favorable readings as positive", () => {
  assert.equal(condDesc("high", 50).positive, true); // litCirrus
  assert.equal(condDesc("low", 5).positive, true); // clearHorizon
  assert.equal(condDesc("path", 0.9).positive, true); // pathClear
  assert.equal(condDesc("vis", 25).positive, false); // crispAir is not "amber"
  assert.equal(condDesc("hum", 10).positive, false); // dryAir is not "amber"
  assert.equal(condDesc("high", 90).positive, false); // heavyHigh
});

test("condDesc returns a localized, non-empty descriptor string", () => {
  const d = condDesc("high", 50);
  assert.equal(typeof d.text, "string");
  assert.ok(d.text.length > 0);
  assert.ok(!d.text.startsWith("desc.")); // key was resolved through i18n
});
