// View builders for the results screen: pure string helpers that turn state +
// data into HTML fragments. They read `state` and localized text but hold no
// state and wire no handlers — the controller (main.js `renderResults`) stitches
// the exported sections together and binds events.
//
// NOTE: these are `innerHTML` string templates, NOT lit-html templates, so
// user-controlled text (place/geocoder labels) MUST go through `escapeHtml`.
// The lit-html migration (see CLAUDE.md) is not yet applied here.

import { html, unsafeHTML, nothing } from "./render.js";
import { state, SPOTS_EVALUATE } from "./state.js";
import {
  fmtTime,
  fmtWeekdayShort,
  whenWord,
  eventNoun,
  dirName,
} from "./format.js";
import { t, cardinal, getLang } from "./i18n.js";
import {
  scoreHue,
  scoreNumeral,
  skySwatch,
  statCell,
  sectionHeader,
  chip,
} from "./ui.js";
import { skyGradient, skyGradientCss } from "./sky.js";
import { icon } from "./icons.js";
import { scoreLabel, scoreUpside, scoreCeiling, WEIGHTS } from "./score.js";
import {
  azimuthToCardinal,
  moonIllumination,
  moonPhaseName,
} from "./astronomy.js";
import { kindInfo, horizonDistanceKm } from "./spots.js";
import { isFavorite } from "./store.js";

/**
 * Leaflet mini-map of the analyzed point: an empty container (Leaflet is
 * mounted onto it by `mountMiniMap` after DOM insertion) + "Expand" chip and
 * button that open the in-app big map with all points marked.
 */
function mapEmbedTemplate({ onOpenMap }) {
  return html`
    <div class="map-wrap">
      <div class="map-slot" id="detail-map"></div>
      <span class="map-slot__expand" aria-hidden="true"
        >${unsafeHTML(icon("maximize", { size: 15 }))} ${t("detail.expand")}</span
      >
    </div>
    <button
      type="button"
      class="btn btn--primary map__open"
      id="open-bigmap"
      @click=${onOpenMap}
    >
      ${unsafeHTML(icon("map", { size: 16 }))} ${t("detail.openMap")}
    </button>
  `;
}

/** Card for a suggested spot (used for both POIs and estimated points).
 *  `factors` (of the analyzed point) drives the thumbnail gradient:
 *  forecast sky over the spot's sky score; obstructed outlooks → muted
 *  tile without sun. */
function spotRowTemplate(s, factors) {
  const info = kindInfo(s.kind);
  const dist = s.dist < 10 ? s.dist.toFixed(1) : Math.round(s.dist);
  const v = s.verdict;
  const est = s.kind === "estimate";
  const isBad = v.sentiment === "bad";
  const gradScore = isBad
    ? Math.min(s.skyScore ?? 30, 30)
    : (s.skyScore ?? v.score);
  const grad = factors ? skyGradientCss(skyGradient(factors, gradScore)) : "";
  const url = `https://www.openstreetmap.org/?mlat=${s.lat.toFixed(5)}&mlon=${s.lon.toFixed(
    5,
  )}#map=15/${s.lat.toFixed(4)}/${s.lon.toFixed(4)}`;
  // "sky NN" pill: the expected color at the point (shown for obstructed outlooks too).
  const skyPill =
    s.skyScore != null
      ? chip({
          variant: "sky",
          value: t("spot.sky", { n: s.skyScore }),
          score: s.skyScore,
          title: t("spot.skyTitle"),
        })
      : "";
  const quota =
    est && s.elev != null ? ` · ${Math.round(s.elev)} ${t("unit.m")}` : "";
  const kindLabel = est ? t("kind.estimate") : t(info.labelKey);
  const meta = `${kindLabel} · ${dist} ${t("unit.km")} · ~${s.driveMin} ${t("unit.min")} · ${cardinal(
    s.dir,
  )}${quota}`;
  // The spot name (from OSM / reverse geocoding) is user-controlled: as a bare
  // lit interpolation it is auto-escaped — no escapeHtml. `title` likewise.
  return html`<li
    class="spot spot--${v.sentiment}"
    style="--hue:${scoreHue(v.score)}"
  >
    ${unsafeHTML(
      skySwatch({
        size: "lg",
        grad,
        sun: !isBad,
        tag: est ? t("spot.estTag") : "",
      }),
    )}
    <div class="spot__body">
      <a class="spot__name" href=${url} target="_blank" rel="noopener"
        >${s.name || t(info.labelKey)}</a
      >
      <span class="spot__verdict"
        >${unsafeHTML(icon(v.icon, { size: 15 }))} ${t("verdict." + v.code)}<span
          class="spot__kind"
          title=${kindLabel}
          >${unsafeHTML(icon(info.icon, { size: 14 }))}</span
        ></span
      >
      <span class="spot__meta mono">${meta}</span>
    </div>
    <div class="spot__scores">
      ${unsafeHTML(
        scoreNumeral(v.score, {
          size: "m",
          score: v.score,
          title: t("spot.viewQuality"),
        }),
      )}
      ${skyPill ? unsafeHTML(skyPill) : nothing}
    </div>
  </li>`;
}

/** "From coordinates" estimate block (button + optional list). `onScan` runs
 *  the grid scan. The `.scan-btn` markup mirrors the `button` primitive so it
 *  can carry an inline @click. */
function estimateBlockTemplate(factors, { onScan }) {
  let list = nothing;
  if (state.estimateError) {
    list = html`<p class="muted">${t("spots.estimateError")}</p>`;
  } else if (state.estimatedSpots && state.estimatedSpots.length) {
    list = html`<ul class="spots">
        ${state.estimatedSpots.map((s) => spotRowTemplate(s, factors))}
      </ul>
      <p class="muted spots__hint">${t("spots.estimateHint")}</p>`;
  } else if (state.estimatedSpots && state.estimatedSpots.length === 0) {
    list = html`<p class="muted">${t("spots.estimateNone")}</p>`;
  }
  return html`
    <button
      type="button"
      class="btn btn--outline scan-btn"
      ?disabled=${state.estimating}
      @click=${onScan}
    >
      ${
        state.estimating
          ? nothing
          : html`${unsafeHTML(icon("compass", { size: 16 }))} `
      }${state.estimating ? t("spots.scanning") : t("spots.scan")}
    </button>
    ${list}
  `;
}

/** "Where to go watch it" section: nearby viewpoints (dual score). `onToggleSpots`
 *  expands the list; `onScan` runs the coordinate estimate. */
export function spotsSectionTemplate(sun, factors, { onToggleSpots, onScan }) {
  const dirNote = t("spots.dirNote", {
    verb: t(state.event === "sunset" ? "verb.sets" : "verb.rises"),
    dir: cardinal(azimuthToCardinal(sun.azimuth)),
    deg: Math.round(sun.azimuth),
  });

  let body = nothing;
  let more = nothing;
  if (state.spotsError) {
    body = html`<p class="sect__note">${t("spots.error")}</p>`;
  } else if (state.spots === null) {
    body = html`<p class="sect__note">${t("spots.loading")}</p>`;
  } else if (state.spots.length === 0) {
    body = html`<p class="sect__note">${t("spots.none")}</p>`;
  } else {
    const shown = state.spots.slice(0, SPOTS_EVALUATE);
    body = html`<ul class="spots is-collapsed" id="spots-list">
      ${shown.map((s) => spotRowTemplate(s, factors))}
    </ul>`;
    if (shown.length > 3) {
      more = html`<button
        type="button"
        class="linkbtn"
        id="spots-more"
        data-more=${t("spots.seeAll", { n: shown.length })}
        data-less=${t("why.showLess")}
        @click=${(/** @type {Event} */ e) => onToggleSpots(e.currentTarget)}
      >
        ${t("spots.seeAll", { n: shown.length })}
      </button>`;
    }
  }

  return html`
    <section class="sect">
      ${unsafeHTML(sectionHeader(t("section.spots")))}
      <p class="sect__cap">${dirNote}</p>
      <p class="dualscore mono">${t("spot.dualLegend")}</p>
      ${body} ${more}
      <div class="estimate">
        ${estimateBlockTemplate(factors, { onScan })}
      </div>
    </section>
  `;
}

/** SVG compass with the sun placed at its azimuth (0°=N, 90°=E, …). */
function compassSvg(azimuth) {
  const cx = 70;
  const cy = 70;
  const r = 54;
  const rad = (azimuth * Math.PI) / 180;
  const sx = (cx + r * Math.sin(rad)).toFixed(1);
  const sy = (cy - r * Math.cos(rad)).toFixed(1);
  return `
    <svg viewBox="0 0 140 140" class="compass" role="img" aria-label="${t("stat.direction")}">
      <circle cx="70" cy="70" r="54" class="compass__ring" />
      <line x1="70" y1="70" x2="${sx}" y2="${sy}" class="compass__ray" />
      <circle cx="${sx}" cy="${sy}" r="9" class="compass__sun" />
      <circle cx="70" cy="70" r="3" class="compass__center" />
      <text x="70" y="22" class="compass__lbl">${cardinal("N")}</text>
      <text x="122" y="75" class="compass__lbl">${cardinal("E")}</text>
      <text x="70" y="132" class="compass__lbl">${cardinal("S")}</text>
      <text x="18" y="75" class="compass__lbl">${cardinal("O")}</text>
    </svg>`;
}

/* ---------- Sky hero (results screen 1b) ---------- */
// lit template. `place.label` is a bare interpolation (auto-escaped — no
// escapeHtml). Trusted HTML-string helpers (icon/scoreNumeral) are wrapped in
// unsafeHTML. The four interactive buttons bind via @click to callbacks the
// controller passes in, so no post-render re-binding is needed. The `.menu`
// stays a string (moreMenuHtml) — it is shared with the home screen and keeps
// its own imperative open/close wiring (bindMoreMenu).
export function heroTemplate(
  { eventDate, score, event, factors },
  { onHome, onSearch, onShare, onToggleFav },
) {
  const { place } = state;
  const label = scoreLabel(score);
  // Score-driven sky: the warm band rises and saturates with the score (see
  // skyGradient). The palette already encodes how vivid it is, so no filter.
  const sky = factors ? skyGradientCss(skyGradient(factors, score)) : "";
  const fav = isFavorite(place);
  return html`
    <header class="rhero" style="--hue:${scoreHue(score)}">
      <div
        class="rhero__sky"
        style=${sky ? `background:${sky}` : nothing}
      ></div>
      <div class="grain" aria-hidden="true"></div>
      <div class="rhero__melt"></div>
      <span class="rhero__sun" aria-hidden="true"></span>
      <div class="rhero__top">
        <button
          type="button"
          class="rhero__loc"
          id="rhero-loc"
          aria-label=${t("rhero.change")}
          @click=${onHome}
        >
          ${unsafeHTML(icon("pin", { size: 16 }))}<span>${place.label}</span
          >${unsafeHTML(icon("chevron-down", { size: 16 }))}
        </button>
        <div class="rhero__actions">
          <button
            type="button"
            class="gcircle"
            id="rhero-search"
            aria-label=${t("rhero.searchAria")}
            @click=${onSearch}
          >
            ${unsafeHTML(icon("search", { size: 17 }))}
          </button>
          <button
            type="button"
            class="gcircle"
            id="rhero-share"
            aria-label=${t("detail.shareAria")}
            @click=${onShare}
          >
            ${unsafeHTML(icon("share", { size: 16 }))}
          </button>
          <button
            type="button"
            class="gcircle fav-toggle${fav ? " fav-toggle--on" : ""}"
            aria-pressed=${fav}
            aria-label=${t("detail.favSave")}
            @click=${onToggleFav}
          >
            ${unsafeHTML(icon("star", { size: 17, fill: fav }))}
          </button>
          <div class="menu">${unsafeHTML(moreMenuHtml())}</div>
        </div>
      </div>
      <div class="rhero__verdict">
        <p class="rhero__eyebrow mono">
          ${whenWord(eventDate, event)} · ${eventNoun(event)}
          ${fmtTime(eventDate)}
        </p>
        <h1 class="verdict__headline">
          ${t("headline." + label + "." + event)}
        </h1>
        <p class="rhero__score">
          ${unsafeHTML(scoreNumeral(score, { size: "l", score }))}<span
            >${t("results.scoreOutOf")}</span
          >
        </p>
        <div class="rhero__meter" role="presentation" aria-hidden="true">
          <span
            class="rhero__meterfill"
            style="width:${Math.max(0, Math.min(100, score))}%"
          ></span>
        </div>
      </div>
    </header>
  `;
}

export function introHtml({ score, sun }) {
  // The direction is highlighted in gold (mock 1b: "The sun sets to the <NW>").
  return `<p class="rintro">${t("intro." + scoreLabel(score), {
    dir: `<strong>${dirName(sun.azimuth)}</strong>`,
    verb: t(state.event === "sunset" ? "verb.sets" : "verb.rises"),
  })}</p>`;
}

/* Compact sunrise/sunset toggle on the results screen. `onSetEvent(ev)` is the
 * controller's setEvent (also re-renders); the home screen keeps its own static
 * .mode buttons wired by bindModes. */
export function eventToggleTemplate({ onSetEvent }) {
  const mk = (ev, ico) => html`
    <button
      type="button"
      class="mode${state.event === ev ? " mode--active" : ""}"
      data-event=${ev}
      @click=${() => onSetEvent(ev)}
    >
      ${unsafeHTML(icon(ico, { size: 15 }))} <span>${t("event." + ev)}</span>
    </button>
  `;
  return html`
    <div
      class="modes modes--compact"
      role="group"
      aria-label=${t("mode.groupAria")}
    >
      ${mk("sunset", "sunset")}${mk("sunrise", "sunrise")}
    </div>
  `;
}

/* "This week": 7-day ribbon with dot + colored number. `onSelectDay(i)` switches
 * the analyzed day. */
export function weekRibbonTemplate(scored, bestDayIndex, { onSelectDay }) {
  // Weekly summary: the caption uses the maximum; the glow highlights only
  // the "banner-worthy" day (≥85 and not today), or none if it doesn't qualify.
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a), scored[0]);
  return html`
    <section class="sect sect--week">
      ${unsafeHTML(sectionHeader(t("section.week")))}
      <p class="sect__cap">
        ${t("week.caption", {
          day: fmtWeekdayShort(best.date),
          score: best.score,
        })}
      </p>
      <div class="wk">
        ${scored.map(({ d, score, date }) => {
          const isBest = bestDayIndex != null && d.dayIndex === bestDayIndex;
          const active = d.dayIndex === state.dayIndex;
          // Dot sized by the score (7–11px), color from the warm ramp.
          const dotSize = (7 + 4 * (score / 100)).toFixed(1);
          return html`
            <button
              class="wk__col${active ? " wk__col--active" : ""}${
                isBest ? " wk__col--best" : ""
              }"
              data-day=${d.dayIndex}
              style="--hue:${scoreHue(score)};--dsz:${dotSize}px"
              @click=${() => onSelectDay(d.dayIndex)}
            >
              ${unsafeHTML(
                scoreNumeral(score, { size: "xs", score, cls: "wk__score" }),
              )}
              <span class="wk__dot"></span>
              <span class="wk__day">${fmtWeekdayShort(date)}</span>
            </button>
          `;
        })}
      </div>
    </section>
  `;
}

/* "Conditions": 2×2 weather cards with a short descriptor. */
function condDesc(type, v) {
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

/** "Light path" cell: loading state, error, or percent clear.
 *  The thresholds match the explanatory notes (explainScore). */
function lightPathCell(cond) {
  const lp = state.lightPath;
  let value = "—";
  let note = t("desc.pathUnknown");
  let noteAccent = false;
  if (lp && lp.status === "loading") {
    value = "…";
    note = t("desc.pathLoading");
  } else if (cond.pathClear !== null && cond.pathClear !== undefined) {
    value = Math.round(cond.pathClear * 100) + "%";
    const d = condDesc("path", cond.pathClear);
    note = d.text;
    noteAccent = d.positive;
  }
  return statCell({
    icon: "compass",
    label: t("stat.lightPath"),
    value,
    note,
    noteAccent,
  });
}

export function conditionsHtml(cond) {
  const visKm = cond.visibility / 1000;
  const cell = (icon, label, type, v, value) => {
    const d = condDesc(type, v);
    return statCell({
      icon,
      label,
      value,
      note: d.text,
      noteAccent: d.positive,
    });
  };
  return `
    <section class="sect">
      ${sectionHeader(t("section.conditions"))}
      <div class="statgrid">
        ${cell("cloud-sun", t("cond.highCloud"), "high", cond.cloudCoverHigh, Math.round(cond.cloudCoverHigh) + "%")}
        ${cell("cloud", t("cond.lowCloud"), "low", cond.cloudCoverLow, Math.round(cond.cloudCoverLow) + "%")}
        ${cell("eye", t("stat.visibility"), "vis", visKm, visKm.toFixed(0) + " km")}
        ${cell("droplet", t("stat.humidity"), "hum", cond.humidity, Math.round(cond.humidity) + "%")}
        ${lightPathCell(cond)}
      </div>
      ${(() => {
        const mid = Math.round(cond.cloudCoverMid ?? 0);
        return mid >= 5
          ? `<p class="sect__cap cond__mid">${t("cond.midNote", { mid })}</p>`
          : "";
      })()}
    </section>`;
}

// Icons for the counterfactual "what's missing to climb" levers (scoreUpside).
const UPSIDE_ICONS = {
  cirrus: "cloud-sun",
  horizon: "sunset",
  clearAir: "wind",
  haze: "haze",
  path: "compass",
};

/* "Why this score": "how it breaks down" bar + factor cards (top 3 + show all).
 * `onToggleDrivers` expands the full factor list. */
export function whyTemplate(
  { score, factors, notes, cond },
  { onToggleDrivers },
) {
  const b0 = WEIGHTS.base * 100;
  const d0 = WEIGHTS.drama * 100 * (factors.drama ?? 0);
  const c0 = WEIGHTS.clarity * 100 * (factors.clarity ?? 0);
  const rawSum = b0 + d0 + c0 || 1;
  const k = score / rawSum; // rescale the components to the final score (penalties included)
  const base = Math.round(b0 * k);
  const drama = Math.round(d0 * k);
  const clarity = Math.max(0, score - base - drama);
  const pct = (n) => ((n / Math.max(score, 1)) * 100).toFixed(1);

  const cards = notes
    .map((n, i) => {
      const p = { ...n.params };
      if (n.code === "hazeBad") {
        p.pm25note =
          p.pm25 != null ? t("explain.hazeBad.pm25", { pm25: p.pm25 }) : "";
      }
      return `
      <li class="driver driver--${n.sentiment}${i >= 3 ? " driver--extra" : ""}">
        <span class="driver__ico">${icon(n.icon, { size: 20 })}</span>
        <div>
          <strong>${t("explain." + n.code + ".title", p)}</strong>
          <p>${t("explain." + n.code + ".detail", p)}</p>
        </div>
      </li>`;
    })
    .join("");

  const moreBtn =
    notes.length > 3
      ? html`<button
          type="button"
          class="linkbtn"
          id="why-more"
          data-more=${t("why.showAll", { n: notes.length })}
          data-less=${t("why.showLess")}
          @click=${(/** @type {Event} */ e) => onToggleDrivers(e.currentTarget)}
        >
          ${t("why.showAll", { n: notes.length })}
        </button>`
      : nothing;

  // Counterfactual levers: what's missing (on its own) for a higher score.
  const upside = scoreUpside(cond);
  const ceiling = scoreCeiling(cond);
  const missing = upside.length
    ? `
      ${sectionHeader(t("why.missing"), { variant: "mono", sub: true })}
      <ul class="drivers">
        ${upside
          .map(
            (u) => `
        <li class="driver driver--upside">
          <span class="driver__ico">${icon(UPSIDE_ICONS[u.code], { size: 20 })}</span>
          <div>
            <strong>${t("upside." + u.code + ".title", {
              gain: `<b class="driver__gain">+${u.gain}</b>`,
            })}</strong>
            <p>${t("upside." + u.code + ".detail", { target: u.target })}</p>
          </div>
        </li>`,
          )
          .join("")}
      </ul>
      <p class="sect__cap">${t("why.missingFoot", { ceiling })}</p>`
    : "";

  // Subtitle: how many factors play in our favor tonight (mock 3a).
  const goodCount = notes.filter((n) => n.sentiment === "good").length;
  const sub = goodCount
    ? `<p class="sect__cap">${t(goodCount === 1 ? "why.subOne" : "why.sub", { n: goodCount })}</p>`
    : "";

  return html`
    <section class="sect">
      ${unsafeHTML(sectionHeader(t("section.why")))} ${unsafeHTML(sub)}
      <div class="addsup">
        <div class="addsup__head">
          <span class="mono">${t("why.addsUp")}</span
          >${unsafeHTML(
            scoreNumeral(score, { size: "s", score, cls: "addsup__score" }),
          )}
        </div>
        <div class="addsup__bar">
          <span
            class="addsup__seg addsup__seg--base"
            style="width:${pct(base)}%"
          ></span>
          <span
            class="addsup__seg addsup__seg--drama"
            style="width:${pct(drama)}%"
          ></span>
          <span
            class="addsup__seg addsup__seg--clarity"
            style="width:${pct(clarity)}%"
          ></span>
        </div>
        <div class="addsup__legend">
          <span><i class="dotc dotc--base"></i>${t("why.baseline")} ${base}</span>
          <span><i class="dotc dotc--drama"></i>${t("why.drama")} +${drama}</span>
          <span
            ><i class="dotc dotc--clarity"></i>${t("why.clarity")} +${clarity}</span
          >
        </div>
      </div>
      <ul class="drivers is-collapsed" id="drivers">
        ${unsafeHTML(cards)}
      </ul>
      ${moreBtn}
      <p class="why-legend">
        <span class="why-legend__c why-legend__c--good"></span>${t(
          "why.legendGood",
        )}
        <span class="why-legend__c why-legend__c--neutral"></span>${t(
          "why.legendNeutral",
        )}
        <span class="why-legend__c why-legend__c--bad"></span>${t(
          "why.legendBad",
        )}
      </p>
      ${unsafeHTML(missing)}
    </section>
  `;
}

/* "Tonight's arc": SVG area chart + forecast color swatch per hour. */
function areaChartSvg(timeline) {
  const W = 320;
  const H = 132;
  const padX = 14;
  const padTop = 26;
  const padBot = 22;
  const n = timeline.length;
  const x = (i) => padX + (i * (W - 2 * padX)) / Math.max(1, n - 1);
  const y = (s) => padTop + (1 - s / 100) * (H - padTop - padBot);
  const pts = timeline.map((c, i) => [x(i), y(c.score)]);

  // Smooth path (quadratics through midpoints).
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const mx = (px + cx) / 2;
    d += ` Q ${px} ${py} ${mx} ${(py + cy) / 2} T ${cx} ${cy}`;
  }
  const area = `${d} L ${pts[n - 1][0]} ${H - padBot} L ${pts[0][0]} ${H - padBot} Z`;

  const grid = [25, 50, 75]
    .map(
      (g) =>
        `<line x1="${padX}" x2="${W - padX}" y1="${y(g)}" y2="${y(g)}" class="arc__grid"/>`,
    )
    .join("");

  const dots = timeline
    .map((c, i) => {
      if (c.isCenter) return "";
      return `<circle cx="${pts[i][0]}" cy="${pts[i][1]}" r="4" class="arc__dot"/>`;
    })
    .join("");

  const ci = timeline.findIndex((c) => c.isCenter);
  const center = ci >= 0 ? pts[ci] : null;
  const guide = center
    ? `<line x1="${center[0]}" x2="${center[0]}" y1="${y(timeline[ci].score)}" y2="${
        H - padBot
      }" class="arc__guide"/>
       <circle cx="${center[0]}" cy="${center[1]}" r="10" class="arc__halo"/>
       <circle cx="${center[0]}" cy="${center[1]}" r="6" class="arc__mark"/>
       <text x="${center[0]}" y="${center[1] - 14}" class="arc__val">${timeline[ci].score}</text>`
    : "";

  const labels = timeline
    .map(
      (c, i) =>
        `<text x="${pts[i][0]}" y="${H - 6}" class="arc__x${
          c.isCenter ? " arc__x--center" : ""
        }">${fmtTime(c.time)}</text>`,
    )
    .join("");

  return `<svg viewBox="0 0 ${W} ${H}" class="arc" role="img" aria-label="${t(
    "section.trend",
    {
      when: t(state.event === "sunset" ? "when.sunset" : "when.sunrise"),
    },
  )}">
    <defs><linearGradient id="arcfill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-opacity="0.5"/>
      <stop offset="1" stop-opacity="0"/>
    </linearGradient></defs>
    ${grid}
    <path d="${area}" fill="url(#arcfill)"/>
    <path d="${d}" class="arc__line"/>
    ${dots}${guide}${labels}
  </svg>`;
}

export function hourlyHtml({ timeline }, tw, event) {
  const swatches = timeline
    .map(
      (c) =>
        `<span class="trendsw${c.isCenter ? " trendsw--center" : ""}" style="background:${skyGradientCss(
          skyGradient(c.factors, c.score),
        )}"></span>`,
    )
    .join("");
  return `
    <section class="sect">
      ${sectionHeader(
        t("trend.arc", {
          when: t(state.event === "sunset" ? "when.sunset2" : "when.sunrise2"),
        }),
      )}
      <p class="sect__cap">${t("trend.hint", {
        when: t(state.event === "sunset" ? "when.sunset2" : "when.sunrise2"),
      })}</p>
      <div class="arc-card">${areaChartSvg(timeline)}</div>
      <div class="swatches">
        <span class="swatches__k mono">${t("trend.predicted")}</span>
        <div class="swatches__row">${swatches}</div>
      </div>
      ${lightChipsHtml(tw, event)}
    </section>`;
}

/* Golden/blue hour chips (reused in "Where to look" and the hourly trend). */
function lightChipsHtml(tw, event) {
  const fmtRange = (a, b) => (a && b ? `${fmtTime(a)}–${fmtTime(b)}` : "—");
  const goldenRange =
    event === "sunset"
      ? fmtRange(tw.golden, tw.event)
      : fmtRange(tw.event, tw.golden);
  const blueRange =
    event === "sunset"
      ? fmtRange(tw.event, tw.blue)
      : fmtRange(tw.blue, tw.event);
  return `<div class="chips">
        ${chip({ variant: "golden", label: t("light.golden"), value: goldenRange })}
        ${chip({ variant: "blue", label: t("light.blue"), value: blueRange })}
      </div>`;
}

/* "Where to look": compass + direction text + golden/blue hour chips. */
export function lookAtHtml(sun, tw, event) {
  return `
    <section class="sect">
      ${sectionHeader(t("section.lookAt"))}
      <div class="lookat">
        ${compassSvg(sun.azimuth)}
        <div class="lookat__body">
          <p class="lookat__dir">${dirName(sun.azimuth)}, ${Math.round(sun.azimuth)}°</p>
          <p class="lookat__txt">${t("lookAt.text", {
            verb: t(event === "sunset" ? "verb.sets" : "verb.rises"),
            dir: dirName(sun.azimuth),
            deg: Math.round(sun.azimuth),
          })}</p>
        </div>
      </div>
      ${lightChipsHtml(tw, event)}
    </section>`;
}

/* "The point" (3d): mini-map + grid note + 2×2 Atmosphere grid. `onOpenMap`
 * opens the full-screen map; the Leaflet mini-map is mounted post-render. */
export function pointTemplate({ cond, phase, factors }, { onOpenMap }) {
  const { place } = state;
  const grid = state.forecast;
  const gridNote =
    grid && Number.isFinite(grid.latitude)
      ? t("grid.note", {
          reqLat: place.latitude.toFixed(3),
          reqLon: place.longitude.toFixed(3),
          gLat: grid.latitude.toFixed(3),
          gLon: grid.longitude.toFixed(3),
        })
      : "";

  const atmo = (name, label, value, cap, accent = false) =>
    statCell({ icon: name, label, value, note: cap, noteAccent: accent });

  // Same thresholds explainScore() uses, so this caption can never contradict
  // the "why" cards.
  const aerosolTone =
    (factors?.aerosolHaze ?? 0) >= 0.5
      ? "bad"
      : (factors?.aerosolEnhance ?? 0) >= 0.6
        ? "good"
        : "neutral";
  const aerosolCard =
    cond.aerosol != null
      ? atmo(
          "haze",
          t("stat.aerosol"),
          `AOD ${cond.aerosol.toFixed(2)} · ${cond.pm25 != null ? Math.round(cond.pm25) + " µg" : "—"}`,
          t("atmo.aerosolCap." + aerosolTone),
          aerosolTone === "good",
        )
      : "";
  const horizonCard = Number.isFinite(grid?.elevation)
    ? atmo(
        "mountain",
        t("atmo.horizon"),
        `~${horizonDistanceKm(grid.elevation).toFixed(0)} km`,
        t("atmo.horizonCap", { m: Math.round(grid.elevation) }),
      )
    : "";

  return html`
    <section class="sect">
      ${unsafeHTML(sectionHeader(t("section.point")))}
      ${mapEmbedTemplate({ onOpenMap })}
      ${gridNote ? html`<p class="gridnote mono">${gridNote}</p>` : nothing}
      ${unsafeHTML(
        sectionHeader(t("section.atmosphere"), { variant: "mono", sub: true }),
      )}
      <div class="statgrid">
        ${unsafeHTML(aerosolCard)}
        ${unsafeHTML(
          atmo(
            "moon",
            t("stat.moon"),
            Math.round(moonIllumination(phase) * 100) + "%",
            t("moon." + moonPhaseName(phase)),
          ),
        )}
        ${unsafeHTML(horizonCard)}
        ${unsafeHTML(
          atmo(
            "thermometer",
            t("stat.temp"),
            Math.round(cond.temperature) + "°C",
            t("atmo.tempCap." + state.event),
          ),
        )}
      </div>
    </section>
  `;
}

// "More options" menu (theme + language). The same markup lives on the home
// and in the results hero, so it is built from one helper and each instance is
// wired independently (see bindMoreMenu in main.js); rows read "Label: current
// value".
const LANG_ENDONYM = { en: "English", it: "Italiano" };

/** Markup for the menu button + popup. Values reflect the CURRENT setting. */
export function moreMenuHtml() {
  const light = document.documentElement.dataset.theme === "light";
  const themeVal = light ? t("menu.themeLight") : t("menu.themeDark");
  const langVal = LANG_ENDONYM[getLang()] || getLang();
  return `
    <button type="button" class="gcircle more-btn" aria-haspopup="true" aria-expanded="false" aria-label="${t(
      "menu.aria",
    )}">${icon("dots", { size: 18 })}</button>
    <div class="menu__pop more-menu" role="menu" hidden>
      <button type="button" class="menu__item lang-toggle" role="menuitem" aria-label="${t("lang.aria")}">
        ${icon("globe", { size: 16, cls: "menu__ico" })}
        <span class="menu__label">${t("menu.langLabel")}</span>
        <span class="menu__value">${langVal}</span>
      </button>
      <button type="button" class="menu__item theme-toggle" role="menuitem" aria-label="${t("theme.aria")}">
        ${icon(light ? "sun" : "moon", { size: 16, cls: "menu__ico" })}
        <span class="menu__label">${t("menu.themeLabel")}</span>
        <span class="menu__value">${themeVal}</span>
      </button>
    </div>`;
}
