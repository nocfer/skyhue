// Conditions vocabulary: turns a raw weather value into a short, localized
// descriptor. Shared by the results screen (views.js) and the map spot card
// (map.js) so both describe cloud, air clarity, light path and humidity from a
// single threshold set. Pure except for i18n.
import { t } from "./i18n.js";

/* Short descriptor + whether it's a favorable ("amber note") reading. */
export function condDesc(type, v) {
  const key =
    type === "high"
      ? v >= 20 && v <= 75
        ? "litCirrus"
        : v > 75
          ? "heavyHigh"
          : "fewHigh"
      : type === "low"
        ? v < 15
          ? "clearHorizon"
          : v < 40
            ? "someLow"
            : "blockedLow"
        : type === "vis"
          ? v >= 20
            ? "crispAir"
            : v >= 10
              ? "okVis"
              : "hazyVis"
          : type === "path"
            ? v >= 0.8
              ? "pathClear"
              : v >= 0.45
                ? "pathPartial"
                : "pathBlocked"
            : v <= 50
              ? "dryAir"
              : v <= 70
                ? "okHum"
                : "humidAir";
  // Amber note only for the truly favorable descriptors (mock 1b).
  const positive =
    key === "litCirrus" || key === "clearHorizon" || key === "pathClear";
  return { text: t("desc." + key), positive };
}
