# SkyHue — domain & architecture glossary

The ubiquitous language for the app and the vocabulary for its module **seams**.
Name things in issues, tests, and refactors with the terms defined here; don't
drift to synonyms. Architecture terms (module, interface, seam, depth, locality,
leverage) follow the `codebase-design` vocabulary.

## Domain

- **Event** — a `sunset` or `sunrise`. The app scores and renders one Event at a
  time (`state.event`).
- **Place** — the geocoded location under analysis (`state.place`):
  `{ latitude, longitude, label }`.
- **Sunset Score** — the 0–100 **colour**-quality rating of a Place's sky at the
  Event (`computeSunsetScore`). It rates colour, not "beauty" — user-facing copy
  was deliberately reframed that way.
- **Spot** — a candidate viewpoint near the Place, rated for its outlook toward
  the sun. Sourced from OpenStreetMap (a "mapped" Spot) or generated from a
  coordinate grid (an "estimate" Spot).
- **Light path** — the clouds sampled along the ray toward the sun; one of the
  Sunset Score factors.

## Architecture seams

### The store — `src/state.js`

`state` is a single mutable object. The store **wraps** it rather than hiding
it: readers import `state` and read fields directly; writers go through
**`update(patch)`**, which merges the patch and notifies subscribers. **`render`
is the sole subscriber**, wired once in `main.js` via `subscribe(render)`.

The one rule: **every write that should redraw goes through `update`**, so a
forgotten redraw is structurally impossible — the redraw is a consequence of the
write, not a separate call to remember. Corollaries:

- Writes that used to precede a single `render()` become one grouped
  `update({ … })` call (synchronous, one notify per call — no microtask
  batching).
- A **bare `update()`** (no patch) notifies after an in-place mutation of nested
  state (e.g. a Spot's freshly-computed `skyScore`), where there is no field to
  patch but the view must redraw.
- The render functions themselves — `showHome` / `showResults` — write `state`
  **directly**, because they run *inside* the notify cycle and calling `update`
  would recurse through the subscription.
- Redraws triggered by things the store does **not** own — a language switch
  (i18n) or a favourites change (localStorage) — stay manual calls
  (`render()`, `renderFavorites()`), by design. The store owns exactly the
  `state` object, nothing more.

### The analysis session — *planned (candidate A)*

The async loaders in `main.js` (`loadSpots`, `loadLightPath`, `loadSky`,
`scanCoordinates`, …) currently guard against the user navigating away with
scattered `state.place !== place` / `state.event !== event` checks — the
cancellation protocol lives at ~10 call-sites. The planned deepening is an
**analysis session** module owning an epoch that bumps on Place/Event change;
each loader gates its `update()` commit through `session.live()`. It is
**orthogonal to the store** and composes at the call-site (`if (!s.live())
return;` before `update(…)`).

### The render layer — *migrating (candidate C)*

Rendering is moving from `innerHTML` template strings to lit-html (the single
CDN choke point is `src/render.js`). The share sheet (`openShareSheet`) is
migrated; the results screen is next, which will delete `bindResultsHandlers`
(imperative listener re-binding on every render) and retire the `escapeHtml`
requirement inside migrated views. The store contract is unchanged by this
migration: `subscribe(render)` still holds when `render` becomes a lit diff.
