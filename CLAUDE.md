# CLAUDE.md — working notes for agents on SkyHue

SkyHue is a **dependency-free, no-build vanilla-JS PWA**. Screens are rendered
from template strings in `src/main.js` (+ `src/map.js`) against `src/styles.css`.
There is no framework, no bundler, no `node_modules`. Leaflet is loaded lazily
from a CDN at runtime.

- Run locally: `python3 -m http.server 8000` (or any static server), open the page.
- Test: `npm test` (Node's built-in test runner).
- **Everything in the codebase is English** — code, comments, commit messages,
  test descriptions. The only Italian allowed is user-facing content: the `it`
  dictionary values in `src/i18n.js` and the IT fallback copy in `index.html`.
  Never add Italian comments.

## Architecture (read before editing UI)

- **Coherence contract:** `COHERENCE_SPEC.md`. The UI is a composition of a fixed
  **token layer** (`:root` / `:root[data-theme='light']` in `styles.css`) and a
  small set of **primitives**. Do not introduce a raw color/space/radius/font
  literal in a screen where a token or primitive exists.
- **Primitives live in two places:**
  - `src/ui.js` — pure string helpers (no DOM, no state, no i18n): `scoreNumeral`,
    `skySwatch`, `statCell`, `sectionHeader`, `chip`, `card`, `button`, `scoreHue`.
    Callers pass already-localized text. Keep this file pure so it stays testable.
  - CSS component classes in `styles.css`: `.score`, `.swatch`, `.stat`/`.statgrid`,
    `.btn`, the shared `.card` base (comma-selector), `.chip*`, `.sect__*`.
- **Every score numeral** goes through `scoreNumeral()`; every swatch through
  `skySwatch()`; every stat cell through `statCell()`; every section title through
  `sectionHeader()`. Don't hand-build these in a screen.
- **Gold has two tokens:** `--score-text*` / `--good-text` / `--bad-text` for TEXT
  (darkens in light theme), `--gold-img` + gradients for IMAGERY (stays bright).
  Pick the right one; never write `#ffce6f` raw.
- **Canvas / Leaflet can't read CSS vars.** `shareImage()` (canvas PNG) and
  `map.js` (Leaflet options) must use literal color strings — they mirror the
  imagery tokens via JS constants (`IMG` in map.js). That's expected, not a defect.
- **The map is a fixed dark inset in both themes** (`--map-canvas`/`--marker-ring`
  are fixed imagery; `tileUrl()` always returns the dark basemap). Don't
  re-introduce a light-theme tile swap.

## Gotchas that cost time here → do this instead

1. **Service worker (`sw.js`) is cache-first for the shell** (html/css/js). After
   the first load it serves a **stale `styles.css`/`main.js`**, so your edits look
   like they had no effect (this session: a phantom "circle score" that was really
   old cached CSS). → When visually verifying CSS/JS changes, **use a throwaway
   Chrome profile** (`--user-data-dir` you `rm -rf` first) or unregister the SW +
   clear Cache Storage. Don't trust a screenshot from a profile that already
   loaded the app.

2. **No browser drivers, no `node_modules`.** Playwright/chromium-cli aren't
   installed. → Drive headless Chrome directly over CDP with a tiny Node script.
   Node 22 here has a global `WebSocket`. Launch:
   `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new
   --remote-debugging-port=9222 --user-data-dir=/tmp/prof --hide-scrollbars`,
   `PUT http://localhost:9222/json/new`, connect the target's `webSocketDebuggerUrl`,
   then `Page.enable` → `Network.setCacheDisabled` → `Emulation.setDeviceMetricsOverride`
   → `Emulation.setEmulatedMedia {features:[{name:'prefers-color-scheme',value:'dark'|'light'}]}`
   (set BEFORE navigate so the inline theme script picks it up) → `Page.navigate`
   → wait `Page.loadEventFired` → `Page.captureScreenshot`.

3. **This env blocks the geocoding endpoint but allows forecast/air-quality.** →
   To reach the results screen without typing a city, navigate with URL params:
   `index.html?lat=40.85&lon=14.27&label=Napoli&event=sunset` (this calls
   `analyze()` directly via `initFromUrl()`).

4. **Browser data fetch + fonts need generous settle before a screenshot** — the
   forecast call resolves after `load`. ~3.5s was too short; use **~9s** for the
   results screen. Spots (Overpass) may still be blocked/slow and degrade to a
   "loading" note — that's fine, the rest renders.

5. **`position:fixed` overlays (share sheet 2d, compare modal 2c) don't compose
   with full-page capture.** Resizing device metrics to full document height
   pushes/loses the overlay. → Capture these with a **fixed viewport** and
   `captureBeyondViewport:false`.

6. **CDP quirks:** `Page.setBypassServiceWorker` isn't available on the page
   target (use a fresh profile instead). When injecting a click via
   `Runtime.evaluate`, an arrow expression `(${fn})` only *defines* it — call it:
   `(${fn})()`. Read results with `returnByValue:true` and `r.result.result.value`.

7. **`styles.css` had two eras** (legacy pre-"Atmosphere" + the Atmosphere
   redesign) with many **duplicated top-level selectors**; the legacy copy leaks
   any property the new copy doesn't override (that's what made the compare score
   render as an old circle). → When de-forking, find duplicates with
   `grep -oE '^\.[a-zA-Z][a-zA-Z0-9_-]*' src/styles.css | sort | uniq -d` and
   delete the superseded copy. Before deleting a rule, confirm the class is unused
   in markup: `grep -rF 'the-class' src/*.js index.html`.

8. **Tests cover only logic modules** (`score`, `astronomy`, `spots`, `sky`,
   `i18n`, `cache`) — **not** the DOM/CSS. A green `npm test` says nothing about
   presentation. Verify UI changes visually (see #1–#6). Conversely, CSS/markup
   refactors can't break the suite, so refactor presentation freely.

9. **Bash tool resets `cwd` between calls** and `cd` mid-command can prompt. Use
   absolute paths; start background servers with `(cmd &)`.

## Verifying a change end-to-end (quick recipe)

1. `rm -rf /tmp/skyprof` (kill stale SW cache), start a static server.
2. Launch headless Chrome with `--user-data-dir=/tmp/skyprof --remote-debugging-port=9222`.
3. Screenshot **both themes** via `setEmulatedMedia` and **both** home and
   `?lat=..&lon=..&label=..&event=sunset`; use fixed-viewport + a click injection
   for the fixed overlays (share/compare).
4. `npm test` and `node --check src/*.js`.
