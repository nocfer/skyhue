// main.js is the controller + app shell: it owns the view (render/renderResults),
// the chrome (menus, theme, language, startup) and the event wiring. The analysis
// domain — fetching + scoring — lives behind analysis.js, whose four verbs it
// drives; the store (state.js) and its sole subscriber (render) live here too.
import { html, render as litRender, unsafeHTML, nothing } from "./render.js";
import { coordsLabel } from "./api.js";
import { twilightTimes } from "./astronomy.js";
import { toggleFavorite } from "./store.js";
import { icon } from "./icons.js";
import { mountMiniMap } from "./map.js";
import { t, initLang, getLang, setLang, applyStaticI18n } from "./i18n.js";
import { state, els, update, subscribe } from "./state.js";
import { eventNoun, fmtWeekdayLong } from "./format.js";
import {
  spotsSectionHtml,
  heroTemplate,
  introHtml,
  eventToggleHtml,
  weekRibbonHtml,
  conditionsHtml,
  whyHtml,
  hourlyHtml,
  lookAtHtml,
  pointHtml,
  moreMenuHtml,
} from "./views.js";
import { openShareSheet } from "./share.js";
import { renderFavorites } from "./favorites.js";
import { updateSuggestAria } from "./suggest.js";
import {
  analyze,
  refreshForEvent,
  scanCoordinates,
  resultsModel,
} from "./analysis.js";

/** Show the home (no place). If focusSearch, move the cursor into the
 *  search bar (used by the "search" button in the results hero).
 *  This is a render function — `render()` calls it when there is no forecast —
 *  so it resets `state` directly rather than via `update()`, which would
 *  re-enter the notify cycle it is already running inside. */
function showHome(focusSearch) {
  state.forecast = null;
  state.place = null;
  state.spots = null;
  state.rawSpots = null;
  els.results.hidden = true;
  litRender(nothing, els.results); // clear lit-managed content safely
  const home = document.getElementById("home");
  if (home) home.hidden = false;
  updateHomeTagline(); // event may have changed while on the results screen
  renderFavorites();
  window.scrollTo(0, 0);
  if (focusSearch === true) setTimeout(() => els.input?.focus(), 50);
}

/** Show the results screen (hides the home). */
function showResults() {
  const home = document.getElementById("home");
  if (home) home.hidden = true;
  els.results.hidden = false;
}

/** Switch event (sunrise/sunset) and re-render keeping all toggles in sync. */
function setEvent(ev) {
  if (ev !== "sunset" && ev !== "sunrise") return;
  // The azimuth changes a lot between sunrise and sunset: re-rate the spots'
  // outlook and resample the light path (nearly opposite ray).
  const reSpots = state.rawSpots && state.rawSpotsFor === state.place;
  const patch = { event: ev, lightPath: null };
  if (reSpots) {
    patch.spots = null;
    patch.spotsError = false;
  }
  // Notifies → render(): a results redraw, or the home via showHome() (which
  // itself refreshes the tagline + favorites' scores for the new event).
  update(patch);
  document.querySelectorAll(".mode").forEach((/** @type {HTMLElement} */ b) => {
    b.classList.toggle("mode--active", b.dataset.event === ev);
  });
  // The domain decides what the new event invalidates (light path always; spots
  // only if we already have raw spots for this place) — usually a cache hit.
  refreshForEvent();
}

/** Wire up the sunrise/sunset buttons contained in `root`. */
function bindModes(root) {
  root.querySelectorAll(".mode").forEach((btn) => {
    btn.addEventListener("click", () => setEvent(btn.dataset.event));
  });
}

/** Redraw the whole view from state: home (no place) or
 *  results (sky hero + sections in a single scroll). */
function render() {
  if (!state.forecast) {
    showHome();
    return;
  }
  showResults();
  const { day, scored } = resultsModel();
  renderResults(day, scored);
}

/** Assemble the results screen and wire up the handlers. */
function renderResults(data, scored) {
  const { place, event, eventDate, sun } = data;
  const tw = twilightTimes(eventDate, place.latitude, place.longitude);

  // "Top sunset incoming" banner (best day ≥85 and not today).
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a), scored[0]);
  const bannerBest =
    best && best.score >= 85 && best.d.dayIndex >= 1 ? best : null;
  const bannerHtml = bannerBest
    ? `<button type="button" class="topbanner" id="topbanner">${icon("flame", {
        size: 18,
      })} <span>${t("banner.top", {
        noun: eventNoun(event),
        day: fmtWeekdayLong(best.date),
        score: best.score,
      })}</span></button>`
    : "";

  // lit render: the hero is a migrated lit template with inline @click; the
  // other sections are still `innerHTML` string builders, wrapped in unsafeHTML
  // until their slice lands. Their handlers stay in bindResultsHandlers below.
  litRender(
    html`
      ${heroTemplate(data, {
        onHome: () => showHome(),
        onSearch: () => showHome(true),
        onShare: () => openShareSheet(data),
        onToggleFav: () => {
          toggleFavorite(place);
          renderFavorites();
          update(); // re-render so the hero star reflects the new state
        },
      })}
      <div class="rcontent">
        ${unsafeHTML(bannerHtml)} ${unsafeHTML(introHtml(data))}
        ${unsafeHTML(eventToggleHtml())}
        ${unsafeHTML(
          weekRibbonHtml(scored, bannerBest ? bannerBest.d.dayIndex : null),
        )}
        <div class="rcol rcol--a">
          ${unsafeHTML(whyHtml(data))} ${unsafeHTML(lookAtHtml(sun, tw, event))}
          ${unsafeHTML(pointHtml(data))}
        </div>
        <div class="rcol rcol--b">
          ${unsafeHTML(hourlyHtml(data, tw, event))}
          ${unsafeHTML(conditionsHtml(data.cond))}
          ${unsafeHTML(spotsSectionHtml(place, sun, data.factors))}
        </div>
        <footer class="rfoot">
          <p data-i18n-html="foot.credits">${t("foot.credits")}</p>
        </footer>
      </div>
    `,
    els.results,
  );

  bindResultsHandlers(data, best);
  els.results.scrollTop = 0;
}

/** Wire up the handlers for the just-rendered results screen. */
function bindResultsHandlers(data, best) {
  const { place, event, score, sun } = data;

  // The hero (back/search/share/favorite) is migrated to lit @click in
  // heroTemplate; its handlers are passed there from renderResults.

  // "More options" menu (theme + language), mirrored from the home. The menu is
  // shared with the home screen and keeps its own imperative open/close wiring.
  const resMenu = els.results.querySelector(".menu");
  if (resMenu) bindMoreMenu(resMenu);

  // Sunrise/sunset toggle (compact variant in the results).
  bindModes(els.results);

  // Banner → jump to the best day.
  els.results.querySelector("#topbanner")?.addEventListener("click", () => {
    update({ dayIndex: best.d.dayIndex });
  });

  // Week ribbon → switch day.
  els.results
    .querySelectorAll(".wk__col")
    .forEach((/** @type {HTMLElement} */ btn) => {
      btn.addEventListener("click", () => {
        update({ dayIndex: Number(btn.dataset.day) });
      });
    });

  // "Show all" factors.
  const whyMore = /** @type {HTMLElement} */ (
    els.results.querySelector("#why-more")
  );
  const drivers = els.results.querySelector("#drivers");
  if (whyMore && drivers) {
    whyMore.addEventListener("click", () => {
      const collapsed = drivers.classList.toggle("is-collapsed");
      whyMore.textContent = collapsed
        ? whyMore.dataset.more
        : whyMore.dataset.less;
    });
  }

  // "Search unmapped points too".
  const scanBtn = els.results.querySelector(".scan-btn");
  if (scanBtn) scanBtn.addEventListener("click", scanCoordinates);

  // "See all points".
  const spotsMore = /** @type {HTMLElement} */ (
    els.results.querySelector("#spots-more")
  );
  const spotsList = els.results.querySelector("#spots-list");
  if (spotsMore && spotsList) {
    spotsMore.addEventListener("click", () => {
      const collapsed = spotsList.classList.toggle("is-collapsed");
      spotsMore.textContent = collapsed
        ? spotsMore.dataset.more
        : spotsMore.dataset.less;
    });
  }

  // Context for the big map (refreshed on every render).
  const mapCtx = {
    lat: place.latitude,
    lon: place.longitude,
    azimuth: sun.azimuth,
    score,
    event,
    visibility: data.cond.visibility,
    spots: Array.isArray(state.spots) ? state.spots : [],
  };
  lastMapContext = mapCtx;
  els.results
    .querySelector("#open-bigmap")
    ?.addEventListener("click", openBigMap);

  mountMiniMap(els.results.querySelector("#detail-map"), {
    ...mapCtx,
    onExpand: openBigMap,
  }).catch((err) => console.warn("Mini-map not available:", err));
}

// Last known map context (current place/event/day): the big map
// reads it from window.skyhueMapContext when opened.
let lastMapContext = null;

/** Open the in-app big map with the current context (all points marked). */
function openBigMap() {
  if (lastMapContext) window.skyhueMapContext = lastMapContext;
  location.hash = "#map";
}

// Home sunrise / sunset selector. The compact toggles in the results are
// wired in renderResults() on every render.
const homeEl = document.getElementById("home");
if (homeEl) bindModes(homeEl);

/** Close every open menu instance (home + results). */
function closeAllMenus() {
  document
    .querySelectorAll(".more-menu")
    .forEach((/** @type {HTMLElement} */ pop) => {
      pop.hidden = true;
    });
  document.querySelectorAll(".more-btn").forEach((b) => {
    b.setAttribute("aria-expanded", "false");
  });
}

/** Wire one menu instance (a `.menu` root): open/close + the two toggles. */
function bindMoreMenu(root) {
  const btn = root.querySelector(".more-btn");
  const pop = /** @type {HTMLElement} */ (root.querySelector(".more-menu"));
  if (!btn || !pop) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = pop.hidden;
    closeAllMenus();
    pop.hidden = !willOpen;
    btn.setAttribute("aria-expanded", String(willOpen));
  });
  // Picking an entry closes the menu: otherwise it stays open and the click
  // seems to have had no effect.
  pop.querySelectorAll(".menu__item").forEach((item) => {
    item.addEventListener("click", closeAllMenus);
  });
  root.querySelector(".theme-toggle")?.addEventListener("click", toggleTheme);
  root.querySelector(".lang-toggle")?.addEventListener("click", toggleLanguage);
}

// Outside click / Escape closes any open menu (bound once).
document.addEventListener("click", (e) => {
  if (!(/** @type {Element} */ (e.target).closest(".menu"))) closeAllMenus();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAllMenus();
});

/** On startup, if the URL contains a shared place, open it. */
function initFromUrl() {
  const p = new URLSearchParams(location.search);
  const lat = parseFloat(p.get("lat"));
  const lon = parseFloat(p.get("lon"));
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    const event = p.get("event") === "sunrise" ? "sunrise" : "sunset";
    update({ event }); // home shows during analyze()'s async fetch, as before
    document
      .querySelectorAll(".mode")
      .forEach((/** @type {HTMLElement} */ b) => {
        b.classList.toggle("mode--active", b.dataset.event === event);
      });
    const label = p.get("label") || coordsLabel(lat, lon);
    analyze({ latitude: lat, longitude: lon, label });
  }
}

// A point picked on the map requests the full analysis: we run it here.
window.addEventListener("skyhue:analyze", (e) => analyze(e.detail));

// Refresh the theme row (icon + value) on every menu instance. Both describe
// the CURRENT theme, so there is no "is this the state or the action?" ambiguity.
function updateThemeToggle() {
  const light = document.documentElement.dataset.theme === "light";
  const value = light ? t("menu.themeLight") : t("menu.themeDark");
  document.querySelectorAll(".theme-toggle").forEach((b) => {
    const ico = b.querySelector(".menu__ico");
    if (ico)
      ico.outerHTML = icon(light ? "sun" : "moon", {
        size: 16,
        cls: "menu__ico",
      });
    const v = b.querySelector(".menu__value");
    if (v) v.textContent = value;
  });
}

// Light/dark theme toggle (the theme is already applied in <head> before paint).
function toggleTheme() {
  const next =
    document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("skyhue.theme", next);
  } catch {
    /* storage unavailable */
  }
  updateThemeToggle();
  // Notify the map so it can swap the light/dark tiles with the theme.
  window.dispatchEvent(new CustomEvent("skyhue:themechange", { detail: next }));
}

// IT/EN language toggle: update the dictionary, the static texts and re-render.
function toggleLanguage() {
  setLang(getLang() === "en" ? "it" : "en");
  document.documentElement.lang = getLang();
  applyStaticI18n();
  updateHomeTagline(); // not covered by data-i18n: refresh in the new language
  mountHomeMenu(); // rebuild the home menu (labels/value) in the new language
  updateSuggestAria();
  renderFavorites();
  // The "your position" text was translated only once, at geolocation
  // time: it must be regenerated in the new language before re-rendering.
  if (state.place?.isGeo) {
    state.place.label = `${t("geo.here")} (${coordsLabel(state.place.latitude, state.place.longitude)})`;
  }
  // Re-render the current result, if any (this rebuilds its menu too).
  if (state.forecast && state.place) render();
  // Refresh the map panel if open.
  window.dispatchEvent(
    new CustomEvent("skyhue:langchange", { detail: getLang() }),
  );
}

/** Set the home tagline for the current event (sunset/sunrise); the copy is
 *  static markup otherwise, so it must be refreshed on event/language change. */
function updateHomeTagline() {
  const el = document.querySelector(".home__tagline");
  if (el) el.textContent = t(`app.tagline.${state.event}`);
}

/** Build + wire the home menu (called at startup and after a language switch). */
function mountHomeMenu() {
  const slot = document.getElementById("home-menu");
  if (!slot) return;
  slot.innerHTML = moreMenuHtml();
  bindMoreMenu(slot);
}

// The store's sole subscriber: every `update()` redraws through here. Wired
// before the first `update()` (in initFromUrl / analyze) can fire.
subscribe(render);

// Startup: language, static texts, the home menu, favorites and shared link.
initLang();
document.documentElement.lang = getLang();
applyStaticI18n();
updateHomeTagline();
mountHomeMenu();
updateSuggestAria();
renderFavorites();
initFromUrl();

// Signal a healthy boot to the self-heal watchdog in index.html: if the module
// graph linked and this startup ran, we are NOT in the bricked-shell state the
// watchdog guards against. Without this the watchdog misfires every session,
// unregistering the service worker and clearing caches on each fresh load.
window.__skyhueBooted = true;
