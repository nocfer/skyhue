// Favorites (home screen): the saved-place cards, their async score/time
// enrichment, and the compare modal. Loading a favorite dispatches the shared
// `skyhue:analyze` event (handled in main.js) rather than importing the
// controller, so this module stays a leaf with no cycle back to main.js.
//
// NOTE: `innerHTML` string templates — user text (place labels) goes through
// `escapeHtml` (the lit-html migration hasn't reached this screen; see CLAUDE.md).

import { state, els } from "./state.js";
import {
  eventNoun,
  fmtTime,
  fmtWeekdayShort,
  isToday,
  escapeHtml,
} from "./format.js";
import { t } from "./i18n.js";
import { getFavorites, removeFavorite } from "./store.js";
import { fetchForecast, nextSunset, conditionsAtTime } from "./api.js";
import { computeSunsetScore, scoreLabel } from "./score.js";
import { skyGradient, skyGradientCss } from "./sky.js";
import { scoreHue, scoreNumeral, skySwatch } from "./ui.js";
import { icon } from "./icons.js";

/** Draw the favorite place cards (home): swatch + name + time + score.
 *  Scores/times are filled in asynchronously so they don't block the render. */
export function renderFavorites() {
  const favs = getFavorites();
  const places = document.getElementById("places");
  if (places) places.hidden = favs.length === 0;

  els.favorites.innerHTML =
    favs
      .map(
        (f) => `
      <div class="place" role="button" tabindex="0" data-id="${f.id}">
        ${skySwatch({ size: "md" })}
        <span class="place__body">
          <span class="place__name">${escapeHtml(f.label)}</span>
          <span class="place__when" data-when>${t("fav.calc")}</span>
        </span>
        <span class="place__scorebox">
          <span class="score score--m place__score" data-score>—</span>
          <span class="place__word" data-word></span>
        </span>
        <button class="place__del" data-del="${f.id}" title="${t("fav.remove")}" aria-label="${t(
          "fav.remove",
        )}">×</button>
      </div>`,
      )
      .join("") +
    (favs.length >= 2
      ? `<button type="button" class="place-compare" id="fav-compare">${icon(
          "compass",
          {
            size: 15,
          },
        )} ${t("fav.compare")}</button>`
      : "");

  const load = (id) => {
    const f = getFavorites().find((x) => x.id === id);
    if (f)
      window.dispatchEvent(
        new CustomEvent("skyhue:analyze", {
          detail: {
            latitude: f.latitude,
            longitude: f.longitude,
            label: f.label,
          },
        }),
      );
  };
  els.favorites
    .querySelectorAll(".place")
    .forEach((/** @type {HTMLElement} */ card) => {
      card.addEventListener("click", (e) => {
        if (/** @type {Element} */ (e.target).closest("[data-del]")) return;
        load(card.dataset.id);
      });
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          load(card.dataset.id);
        }
      });
    });
  els.favorites
    .querySelectorAll("[data-del]")
    .forEach((/** @type {HTMLElement} */ btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeFavorite(btn.dataset.del);
        renderFavorites();
      });
    });
  const cmp = els.favorites.querySelector("#fav-compare");
  if (cmp) cmp.addEventListener("click", compareFavorites);

  enrichFavoriteCards(favs);
}

/** Fill the favorite cards with score + time of the current event. */
async function enrichFavoriteCards(favs) {
  await Promise.all(
    favs.map(async (f) => {
      try {
        const fc = await fetchForecast(f.latitude, f.longitude);
        const ne = nextSunset(fc, new Date());
        const iso = state.event === "sunset" ? ne.sunset : ne.sunrise;
        const cond = conditionsAtTime(fc, iso);
        const { score, factors } = computeSunsetScore(cond);
        const el = els.favorites.querySelector(
          `.place[data-id="${CSS.escape(f.id)}"]`,
        );
        if (!el) return;
        const sc = /** @type {HTMLElement} */ (
          el.querySelector("[data-score]")
        );
        const wh = el.querySelector("[data-when]");
        if (sc) {
          sc.textContent = String(score);
          sc.style.setProperty("--hue", String(scoreHue(score)));
          sc.classList.add("is-set");
          sc.title = t("label." + scoreLabel(score));
        }
        // Swatch with the place's forecast sky gradient + label word.
        const sw = /** @type {HTMLElement} */ (el.querySelector(".swatch"));
        if (sw)
          sw.style.background = skyGradientCss(skyGradient(factors, score));
        const word = el.querySelector("[data-word]");
        if (word) word.textContent = t("label." + scoreLabel(score));
        if (wh) {
          const d = new Date(iso);
          const when =
            state.event === "sunset" && isToday(d)
              ? t("time.tonight")
              : fmtWeekdayShort(d);
          wh.textContent = `${when} · ${eventNoun(state.event)} ${fmtTime(d)}`;
        }
      } catch {
        /* leave the placeholder */
      }
    }),
  );
}

/**
 * Compare the favorites for the current event (next sunset/sunrise): fetch
 * each one's weather, compute the Sunset Score and show them sorted in a
 * modal. No per-point aerosol (fewer calls): a purely weather comparison.
 */
async function compareFavorites() {
  const favs = getFavorites();
  if (favs.length < 2) return;
  const noun = eventNoun(state.event);
  const overlay = document.createElement("div");
  overlay.className = "cmp";
  overlay.innerHTML = `
    <div class="cmp__box">
      <header class="cmp__header">
        <div>
          <h2 class="cmp__title display">${t("cmp.heading")}</h2>
          <p class="cmp__sub">${t("cmp.sub." + state.event)}</p>
        </div>
        <button class="cmp__close gcircle" aria-label="${t("cmp.close")}">×</button>
      </header>
      <div class="cmp__list"><p class="cmp__calc">${t("cmp.calc")}</p></div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector(".cmp__close").addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  const rows = await Promise.all(
    favs.map(async (f) => {
      try {
        const fc = await fetchForecast(f.latitude, f.longitude);
        const ne = nextSunset(fc, new Date());
        const iso = state.event === "sunset" ? ne.sunset : ne.sunrise;
        const cond = conditionsAtTime(fc, iso);
        const { score, factors } = computeSunsetScore(cond);
        return { label: f.label, score, factors, time: new Date(iso) };
      } catch {
        return { label: f.label, score: null, time: null };
      }
    }),
  );
  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  const when = (r) => (r.time ? `${noun} ${fmtTime(r.time)}` : t("cmp.na"));
  // Swatch with each place's forecast sky (mock 2c).
  const rowGrad = (r) =>
    r.factors && r.score != null
      ? skyGradientCss(skyGradient(r.factors, r.score))
      : "";

  const list = overlay.querySelector(".cmp__list");
  if (!list) return;

  const [winner, ...rest] = rows;
  const winnerHtml =
    winner && winner.score != null
      ? `<div class="cmp__winner" style="--hue:${scoreHue(winner.score)}">
          <span class="cmp__best">${icon("star", { size: 13, fill: true })} ${t("cmp.best")}</span>
          <div class="cmp__winrow">
            ${skySwatch({ size: "lg", grad: rowGrad(winner) })}
            <div class="cmp__wininfo">
              <strong>${escapeHtml(winner.label)}</strong>
              <span class="cmp__time">${when(winner)}</span>
            </div>
            <div class="cmp__winscore">
              ${scoreNumeral(winner.score, { size: "l", score: winner.score, cls: "cmp__bignum" })}
              <span class="cmp__label">${t("label." + scoreLabel(winner.score))}</span>
            </div>
          </div>
        </div>`
      : "";

  const rowsHtml = rest
    .map(
      (r, i) => `
      <div class="cmp__row">
        <span class="cmp__rank mono">${i + 2}</span>
        ${skySwatch({ size: "sm", grad: rowGrad(r) })}
        <div class="cmp__rowinfo">
          <strong>${escapeHtml(r.label)}</strong>
          <span class="cmp__time">${when(r)}</span>
        </div>
        ${scoreNumeral(r.score ?? "—", { size: "m", score: r.score ?? undefined, cls: "cmp__score" })}
      </div>`,
    )
    .join("");

  list.innerHTML = `${winnerHtml}${rowsHtml}<p class="cmp__foot">${t("cmp.foot." + state.event)}</p>`;
}
