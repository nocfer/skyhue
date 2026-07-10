// Shared formatting and small utility helpers used by both the view builders
// and the share/canvas code. Pure-ish: they read `state`/`els` and the current
// language, but hold no state of their own.

import { state, els } from "./state.js";
import { t, cardinal, getLang } from "./i18n.js";
import { azimuthToCardinal } from "./astronomy.js";

/** Localized noun for an event ("sunset"/"sunrise"). */
export function eventNoun(ev) {
  return t("event." + ev);
}

/** Show (or clear) a message in the status bar. */
export function setStatus(msg, kind = "info") {
  els.status.textContent = msg || "";
  els.status.dataset.kind = kind;
}

function locale() {
  return getLang() === "en" ? "en-GB" : "it-IT";
}

export function fmtTime(date) {
  return date.toLocaleTimeString(locale(), {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtDay(date) {
  return date.toLocaleDateString(locale(), {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function fmtWeekdayShort(date) {
  return date.toLocaleDateString(locale(), { weekday: "short" });
}

export function fmtWeekdayLong(date) {
  return date.toLocaleDateString(locale(), { weekday: "long" });
}

/** Localized cardinal name from the azimuth. */
export function dirName(azimuth) {
  return cardinal(azimuthToCardinal(azimuth));
}

/** True when the date falls on the current calendar day. */
export function isToday(date) {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

/** Contextual eyebrow word ("Tonight" only for today's sunset, otherwise the day). */
export function whenWord(date, event) {
  return event === "sunset" && state.dayIndex === 0 && isToday(date)
    ? t("time.tonight")
    : fmtWeekdayShort(date);
}

/** Minimal escape: names come from an external API and end up in innerHTML. */
export function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
