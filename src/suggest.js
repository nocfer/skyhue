// Search bar: form submit, geocoder autocomplete (debounced, keyboard- and
// pointer-navigable) and the "use my location" button. Choosing a place
// dispatches the shared `skyhue:analyze` event (handled in main.js) instead of
// importing the controller, keeping this a leaf module. The event listeners are
// registered when this module is imported (main.js imports it at startup).

import { els } from "./state.js";
import { setStatus, escapeHtml } from "./format.js";
import { t, getLang } from "./i18n.js";
import { geocode, coordsLabel } from "./api.js";

/** Ask the controller (main.js) to analyze a place. */
function dispatchAnalyze(place) {
  window.dispatchEvent(new CustomEvent("skyhue:analyze", { detail: place }));
}

/** Readable label ("City, Region, Country") from a geocoder match. */
function matchLabel(m) {
  return [m.name, m.admin1, m.country].filter(Boolean).join(", ");
}

function matchToPlace(m) {
  return { latitude: m.latitude, longitude: m.longitude, label: matchLabel(m) };
}

// Place chosen from a suggestion: the label shown in the input
// ("City, Region, Country") can't be re-geocoded, so on submit we
// reuse its coordinates directly until the user edits the text.
let chosenPlace = null;

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = els.input.value.trim();
  if (!query) return;
  closeSuggest();
  // If the text still matches the chosen suggestion, use it as is.
  if (chosenPlace && chosenPlace.label === query) {
    dispatchAnalyze(chosenPlace);
    return;
  }
  setStatus(t("status.searching"), "info");
  try {
    const matches = await geocode(query, 5, getLang());
    if (matches.length === 0) {
      setStatus(t("status.noResults"), "error");
      return;
    }
    dispatchAnalyze(matchToPlace(matches[0]));
  } catch (err) {
    setStatus(t("status.error", { msg: err.message }), "error");
  }
});

// --- Search-bar autocomplete --------------------------------------------
// As the user types, we query the geocoder (debounced) and show the
// results in a list navigable by mouse and keyboard. Submit keeps
// working (first result) even without touching the suggestions.

const suggest = { matches: [], active: -1, seq: 0, open: false };
let suggestTimer = null;

export function updateSuggestAria() {
  els.suggest.setAttribute("aria-label", t("search.suggestAria"));
}

function closeSuggest() {
  suggest.open = false;
  suggest.matches = [];
  suggest.active = -1;
  els.suggest.hidden = true;
  els.suggest.innerHTML = "";
  els.input.setAttribute("aria-expanded", "false");
  els.input.removeAttribute("aria-activedescendant");
}

function showSuggest(matches) {
  if (!matches.length) {
    closeSuggest();
    return;
  }
  suggest.matches = matches;
  suggest.active = -1;
  els.suggest.innerHTML = matches
    .map((m, i) => {
      const meta = [m.admin1, m.country].filter(Boolean).join(", ");
      return `<li class="suggest__item" role="option" id="suggest-opt-${i}" data-i="${i}" aria-selected="false">
        <span class="suggest__name">${escapeHtml(m.name)}</span>
        ${meta ? `<span class="suggest__meta">${escapeHtml(meta)}</span>` : ""}
      </li>`;
    })
    .join("");
  els.suggest.hidden = false;
  suggest.open = true;
  els.input.setAttribute("aria-expanded", "true");
  els.input.removeAttribute("aria-activedescendant");
}

function moveActive(delta) {
  const n = suggest.matches.length;
  if (!n) return;
  suggest.active = (suggest.active + delta + n) % n;
  const items = els.suggest.querySelectorAll(".suggest__item");
  items.forEach((li, i) => {
    const on = i === suggest.active;
    li.classList.toggle("suggest__item--active", on);
    li.setAttribute("aria-selected", String(on));
  });
  els.input.setAttribute(
    "aria-activedescendant",
    `suggest-opt-${suggest.active}`,
  );
  items[suggest.active]?.scrollIntoView({ block: "nearest" });
}

function chooseSuggest(i) {
  const m = suggest.matches[i];
  if (!m) return;
  const place = matchToPlace(m);
  els.input.value = place.label;
  chosenPlace = place; // so the next submit doesn't re-geocode the label
  closeSuggest();
  dispatchAnalyze(place);
}

async function querySuggest(query) {
  const seq = ++suggest.seq;
  try {
    const matches = await geocode(query, 6, getLang());
    if (seq !== suggest.seq) return; // a newer request has arrived
    showSuggest(matches);
  } catch {
    if (seq === suggest.seq) closeSuggest();
  }
}

els.input.addEventListener("input", () => {
  const q = els.input.value.trim();
  chosenPlace = null; // the user is editing: the previous selection no longer applies
  clearTimeout(suggestTimer);
  if (q.length < 2) {
    suggest.seq++; // invalidate any in-flight requests
    closeSuggest();
    return;
  }
  suggestTimer = setTimeout(() => querySuggest(q), 220);
});

els.input.addEventListener("keydown", (e) => {
  if (!suggest.open) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    moveActive(1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    moveActive(-1);
  } else if (e.key === "Enter" && suggest.active >= 0) {
    e.preventDefault(); // pick the suggestion instead of submitting the form
    chooseSuggest(suggest.active);
  } else if (e.key === "Escape") {
    closeSuggest();
  }
});

// pointerdown (not click) so the pick fires before the input loses focus, and
// on touch too: `mousedown` is only synthesized inconsistently from a tap, so
// on mobile the suggestion often never registered.
els.suggest.addEventListener("pointerdown", (e) => {
  const li = /** @type {HTMLElement} */ (
    /** @type {Element} */ (e.target).closest(".suggest__item")
  );
  if (!li) return;
  e.preventDefault();
  chooseSuggest(Number(li.dataset.i));
});

els.input.addEventListener("blur", () => {
  setTimeout(closeSuggest, 120);
});

els.geoBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    setStatus(t("status.geoUnsupported"), "error");
    return;
  }
  setStatus(t("status.geolocating"), "info");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      dispatchAnalyze({
        latitude,
        longitude,
        label: `${t("geo.here")} (${coordsLabel(latitude, longitude)})`,
        isGeo: true,
      });
    },
    (err) =>
      setStatus(t("status.geoUnavailable", { msg: err.message }), "error"),
  );
});
