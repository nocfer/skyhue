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

### The analysis session — `src/session.js`

The async loaders in `main.js` (`loadSpots`, `loadLightPath`, `loadSky`,
`scanCoordinates`, `evaluateSpots`, `nameEstimatedSpots`) must drop their result
if the user navigates away mid-fetch. That cancellation protocol used to live as
~10 scattered `state.place !== place` / `state.event !== event` checks; it is now
one module. A loader calls **`beginRun()`** at entry to capture the analysis
identity, and after its `await` asks whether the run has gone stale before it
commits via `update(…)`:

```js
const run = beginRun();
const raw = await fetchSunsetSpots(…);
if (run.stalePlace()) return;   // superseded — drop it
update({ rawSpots: raw });
```

**Two scopes**, because the data has two dependencies — this is the distinction
the module makes explicit:

- **`stalePlace()`** — the Place changed. Spots, elevations and sky scores are
  tied to the Place only, so they survive an Event switch.
- **`staleEvent()`** — the Place *or* the Event changed. Only the light path
  uses this: its ray flips between sunrise and sunset.

The session is **orthogonal to the store** — it reads `state` but composes with
`update` only at the call-site, and holds no state of its own. Nothing is
aborted; a superseded fetch simply goes unused. **Future extension:** hand each
run an `AbortSignal` to cancel the in-flight fetches (`api.js` / `spots.js` /
`lightpath.js`) outright — a network-efficiency win with a larger blast radius,
deliberately deferred.

### The analysis domain — `src/analysis.js`

Everything that turns a Place + Event into the scored model lives here — fetching
(weather, air, spots, elevations, light path), rating scenic Spots, and computing
the Sunset Score. It draws nothing; `main.js` is the controller that drives it and
renders. The interface is **four verbs** over eleven private functions:

- **`analyze(place)`** — full analysis for a newly chosen Place.
- **`refreshForEvent()`** — recompute the Event-dependent data after a sunrise/
  sunset switch (concentrates the "what does the new Event invalidate?" rule).
- **`scanCoordinates()`** — the on-demand "search unmapped points" grid scan.
- **`resultsModel()`** — pure, synchronous `{ day, scored }` for `render()` to draw.

Writes flow through the store's `update()`; staleness is gated by the session's
`beginRun()`. `resultsModel`/`evaluateDay` are DOM-free and unit-tested against a
forecast fixture. The async loaders are **not** unit-tested yet: they call `fetch`
directly and `api.js` exposes no injection seam — adding one (so the loaders can
be driven with fixtures) is the natural follow-up.

### The render layer — *migrating (candidate C)*

Rendering is moving from `innerHTML` template strings to lit-html (the single
CDN choke point is `src/render.js`). The share sheet (`openShareSheet`) is
migrated; the results screen is next, which will delete `bindResultsHandlers`
(imperative listener re-binding on every render) and retire the `escapeHtml`
requirement inside migrated views. The store contract is unchanged by this
migration: `subscribe(render)` still holds when `render` becomes a lit diff.
