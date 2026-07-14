// Conditions vocabulary: turns a raw weather value into a short, localized
// descriptor. Shared by the results screen (views.js) and the map spot card
// (map.js) so both describe cloud, air clarity, light path and humidity from a
// single threshold set. Pure except for i18n.
import { t } from "./i18n.js";

// Threshold bands per conditions type. Each band is [test(v), descriptor key];
// the first band whose test passes wins, and the trailing `() => true` band is
// the catch-all. A higher raw value is better for `high`/`vis`/`path`, lower is
// better for `low`/`hum` — hence the differing comparison directions.
const BANDS = {
  high: [
    [(v) => v >= 20 && v <= 75, "litCirrus"],
    [(v) => v > 75, "heavyHigh"],
    [() => true, "fewHigh"],
  ],
  low: [
    [(v) => v < 15, "clearHorizon"],
    [(v) => v < 40, "someLow"],
    [() => true, "blockedLow"],
  ],
  vis: [
    [(v) => v >= 20, "crispAir"],
    [(v) => v >= 10, "okVis"],
    [() => true, "hazyVis"],
  ],
  path: [
    [(v) => v >= 0.8, "pathClear"],
    [(v) => v >= 0.45, "pathPartial"],
    [() => true, "pathBlocked"],
  ],
  hum: [
    [(v) => v <= 50, "dryAir"],
    [(v) => v <= 70, "okHum"],
    [() => true, "humidAir"],
  ],
};

// The favorable descriptors that earn an "amber note" highlight (mock 1b).
const POSITIVE = new Set(["litCirrus", "clearHorizon", "pathClear"]);

/** The descriptor key for a raw value. Pure (no i18n) so it's directly
 *  testable. An unrecognized `type` falls back to the humidity bands, which
 *  preserves the original catch-all behavior. */
export function condKey(type, v) {
  const bands = BANDS[type] ?? BANDS.hum;
  return bands.find(([test]) => test(v))[1];
}

/* Short descriptor + whether it's a favorable ("amber note") reading. */
export function condDesc(type, v) {
  const key = condKey(type, v);
  return { text: t("desc." + key), positive: POSITIVE.has(key) };
}
