// Favorites (home screen): the saved-place cards, their async score/time
// enrichment, and the compare modal. Loading a favorite dispatches the shared
// `skyhue:analyze` event (handled in main.js) rather than importing the
// controller, so this module stays a leaf with no cycle back to main.js.
//
// Rendered with lit-html: place labels are bare `${…}` interpolations (lit
// auto-escapes), and the trusted string helpers (skySwatch/scoreNumeral/icon)
// are wrapped in `unsafeHTML`. Score/time are filled in after render by
// enrichFavoriteCards — an imperative escape hatch over the data-* slots.

import { state, els } from "./state.js";
import { eventNoun, fmtTime, fmtWeekdayShort, isToday } from "./format.js";
import { t } from "./i18n.js";
import { getFavorites, removeFavorite } from "./store.js";
import { fetchForecast, nextSunset, conditionsAtTime } from "./api.js";
import { computeSunsetScore, scoreLabel } from "./score.js";
import { skyGradient, skyGradientCss } from "./sky.js";
import { scoreHue, scoreNumeral, skySwatch } from "./ui.js";
import { icon } from "./icons.js";
import { html, render, nothing, unsafeHTML, repeat } from "./render.js";

/** Dispatch the shared analyze event for a favorite id. */
function loadFavorite(id) {
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
}

/** One favorite card. Keyed by id (see repeat) so a delete never leaves a
 *  card showing a neighbour's stale enriched score. */
function favCardTemplate(f) {
  return html`
    <div
      class="place"
      role="button"
      tabindex="0"
      data-id=${f.id}
      @click=${(/** @type {MouseEvent} */ e) => {
        if (/** @type {Element} */ (e.target).closest("[data-del]")) return;
        loadFavorite(f.id);
      }}
      @keydown=${(/** @type {KeyboardEvent} */ e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          loadFavorite(f.id);
        }
      }}
    >
      ${unsafeHTML(skySwatch({ size: "md" }))}
      <span class="place__body">
        <span class="place__name">${f.label}</span>
        <span class="place__when" data-when>${t("fav.calc")}</span>
      </span>
      <span class="place__scorebox">
        <span class="score score--m place__score" data-score>—</span>
        <span class="place__word" data-word></span>
      </span>
      <button
        class="place__del"
        data-del=${f.id}
        title=${t("fav.remove")}
        aria-label=${t("fav.remove")}
        @click=${(/** @type {MouseEvent} */ e) => {
          e.stopPropagation();
          removeFavorite(f.id);
          renderFavorites();
        }}
      >
        ×
      </button>
    </div>
  `;
}

/** Draw the favorite place cards (home): swatch + name + time + score.
 *  Scores/times are filled in asynchronously so they don't block the render. */
export function renderFavorites() {
  const favs = getFavorites();
  const places = document.getElementById("places");
  if (places) places.hidden = favs.length === 0;

  const compare =
    favs.length >= 2
      ? html`<button
          type="button"
          class="place-compare"
          id="fav-compare"
          @click=${compareFavorites}
        >
          ${unsafeHTML(icon("compass", { size: 15 }))} ${t("fav.compare")}
        </button>`
      : nothing;

  render(
    html`${repeat(favs, (f) => f.id, favCardTemplate)}${compare}`,
    els.favorites,
  );

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
  const close = () => overlay.remove();
  render(
    html`
      <div class="cmp__box">
        <header class="cmp__header">
          <div>
            <h2 class="cmp__title display">${t("cmp.heading")}</h2>
            <p class="cmp__sub">${t("cmp.sub." + state.event)}</p>
          </div>
          <button
            class="cmp__close gcircle"
            aria-label=${t("cmp.close")}
            @click=${close}
          >
            ×
          </button>
        </header>
        <div class="cmp__list"><p class="cmp__calc">${t("cmp.calc")}</p></div>
      </div>
    `,
    overlay,
  );
  document.body.appendChild(overlay);
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
  const winnerTpl =
    winner && winner.score != null
      ? html`<div class="cmp__winner" style="--hue:${scoreHue(winner.score)}">
          <span class="cmp__best"
            >${unsafeHTML(icon("star", { size: 13, fill: true }))}
            ${t("cmp.best")}</span
          >
          <div class="cmp__winrow">
            ${unsafeHTML(skySwatch({ size: "lg", grad: rowGrad(winner) }))}
            <div class="cmp__wininfo">
              <strong>${winner.label}</strong>
              <span class="cmp__time">${when(winner)}</span>
            </div>
            <div class="cmp__winscore">
              ${unsafeHTML(
                scoreNumeral(winner.score, {
                  size: "l",
                  score: winner.score,
                  cls: "cmp__bignum",
                }),
              )}
              <span class="cmp__label"
                >${t("label." + scoreLabel(winner.score))}</span
              >
            </div>
          </div>
        </div>`
      : nothing;

  const rowsTpl = rest.map(
    (r, i) => html`
      <div class="cmp__row">
        <span class="cmp__rank mono">${i + 2}</span>
        ${unsafeHTML(skySwatch({ size: "sm", grad: rowGrad(r) }))}
        <div class="cmp__rowinfo">
          <strong>${r.label}</strong>
          <span class="cmp__time">${when(r)}</span>
        </div>
        ${unsafeHTML(
          scoreNumeral(r.score ?? "—", {
            size: "m",
            score: r.score ?? undefined,
            cls: "cmp__score",
          }),
        )}
      </div>
    `,
  );

  render(
    html`${winnerTpl}${rowsTpl}<p class="cmp__foot">
        ${t("cmp.foot." + state.event)}
      </p>`,
    list,
  );
}
