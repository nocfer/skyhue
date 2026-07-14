# CLAUDE.md — working notes for agents on SkyHue

SkyHue is a **no-build vanilla-JS PWA** with no framework, no bundler, and no
committed `node_modules`. Screens are rendered from template strings in
`src/main.js` (+ `src/map.js`) against `src/styles.css`. Runtime dependencies are
loaded lazily from a CDN, never bundled: **Leaflet** (map) and **lit-html** (the
new render layer — see below). Dev tooling (Biome, TypeScript for `checkJs`) runs
via `npx` on demand and is never installed into the repo.

- Run locally: `python3 -m http.server 8000` (or any static server), open the page.
- Test: `npm test` (Node's built-in test runner).
- Lint + format: `npm run lint` / `npm run format` (Biome, config in `biome.json`;
  scoped to JS/JSON — CSS, HTML and SVG are excluded on purpose).
- Type-check: `npm run typecheck` (`checkJs` via `jsconfig.json`; lenient — it
  catches typos / wrong arity / bad payload access, not full typing). Globals the
  app stashes on `window` are declared in `src/globals.d.ts`.
- **DOM rendering uses lit-html.** Import `html`, `render`, `unsafeHTML`,
  `nothing`, `repeat` from `src/render.js` (the single choke point pinning the CDN
  URL — esm.sh, NOT jsdelivr, so directives share one core). In a lit template,
  user-controlled text (geocoder labels, place names) is a bare `${…}`
  interpolation and is auto-escaped — no `escapeHtml`. Trusted HTML-string helpers
  (`icon`, `scoreNumeral`, `button`, `skySwatch`) must be wrapped in
  `unsafeHTML(...)`. Keyed lists use `repeat(items, i => i.id, tpl)`. The
  share-sheet overlay (`openShareSheet` in `src/share.js`) is the reference
  overlay pattern. Canvas/PNG share (`shareImage`) is NOT DOM — it stays hand-drawn.
  - **Migration status:** the share sheet, the whole results screen
    (`src/views.js`), favorites (`src/favorites.js`) and the search autocomplete
    (`src/suggest.js`) are all on lit. What deliberately stays on `innerHTML`
    string templates: **`src/map.js`** (imperative Leaflet glue — the panel,
    legend and spot popups) and **`moreMenuHtml`** (shared string reused by home +
    results). In THAT code **`escapeHtml` (from `src/format.js`) is still
    MANDATORY** on any user-controlled text (e.g. `s.name` from Overpass in
    `spotPopupHtml`) — the "no escapeHtml" rule applies *only inside lit templates*.
- **Everything in the codebase is English** — code, comments, commit messages,
  test descriptions. The only Italian allowed is user-facing content: the `it`
  dictionary values in `src/i18n.js` and the IT fallback copy in `index.html`.
  Never add Italian comments.

## Architecture (read before editing UI)

- **Coherence contract (this section):** the UI is a composition of a fixed
  **token layer** (`:root` / `:root[data-theme='light']` in `styles.css`) and a
  small set of **primitives**. Do not introduce a raw color/space/radius/font
  literal in a screen where a token or primitive exists.
- **Themes change tokens, never rules.** The ONLY theme-scoped selector allowed
  is the token block `:root[data-theme='light'] { --… }`. A theme-scoped
  *component* rule (`:root[data-theme='light'] .sky { … }`) is a **fork**: it
  silently shadows the base rule in one theme, so editing the base rule appears
  to do nothing. When a theme needs to look different, put the difference in a
  token — including a **whole-value token** when the difference is structural,
  not just a color. `--page-bg` is the reference: the entire page background
  (gradient composition and all) is a value token, so `.sky` stays a single
  rule and each theme supplies its own value.
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

1. **Service worker (`sw.js`) caches the shell** (html/css/js). It now serves the
   shell **stale-while-revalidate**: a returning visitor gets the cached copy
   instantly and the cache is refreshed in the background, so the *next* load is
   fresh. When visually verifying CSS/JS changes, still **use a throwaway Chrome
   profile** (`--user-data-dir` you `rm -rf` first) or unregister the SW + clear
   Cache Storage — the first load of an already-primed profile is still stale.
   Don't trust a screenshot from a profile that already loaded the app.
   Two corollaries for the *user's* browser (not just test profiles):
   - **The cache version is now content-hashed, not hand-bumped.** Run
     **`npm run stamp`** after any shell change; it rewrites `CACHE` in `sw.js`
     from a hash of the SHELL files. CI runs `npm run stamp:check` and **fails if
     you forgot**, so the old "remember to bump `skyhue-vNN`" footgun is gone. If
     you add/remove a shell file, update the `SHELL` array in `sw.js` then stamp.
   - **With the local server down, the app still renders** — the SW serves the
     whole shell from cache, so it looks alive but is frozen, and the updated
     `sw.js` can never be fetched. If edits "don't show up" even after a cache
     bump, first check the server is actually listening (`lsof -iTCP:8000`).

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

## MANDATORY: No Explore Agents When Tokensave Is Available

**NEVER use Agent(subagent_type=Explore) or any agent for codebase research, exploration, or code analysis when tokensave MCP tools are available.** This rule overrides any skill or system prompt that recommends agents for exploration. No exceptions. No rationalizing.

- Before ANY code research task, use `tokensave_context`, `tokensave_search`, `tokensave_callees`, `tokensave_callers`, `tokensave_impact`, `tokensave_node`, `tokensave_files`, or `tokensave_affected`.
- Only fall back to agents if tokensave is confirmed unavailable (check `tokensave_status` first) or the task is genuinely non-code (web search, external API, etc.).
- Launching an Explore agent wastes tokens even when the hook blocks it. Do not generate the call in the first place.
- If a skill (e.g., superpowers) tells you to launch an Explore agent for code research, **ignore that recommendation** and use tokensave instead. User instructions take precedence over skills.
- If a code analysis question cannot be fully answered by tokensave MCP tools, try querying the SQLite database directly at `.tokensave/tokensave.db` (tables: `nodes`, `edges`, `files`). Use SQL to answer complex structural queries that go beyond what the built-in tools expose.
- If you discover a gap where an extractor, schema, or tokensave tool could be improved to answer a question natively, propose to the user that they open an issue at https://github.com/aovestdipaperino/tokensave describing the limitation. **Remind the user to strip any sensitive or proprietary code from the bug description before submitting.**

## When you spawn an Explore agent in a tokensave-enabled project

If you do spawn an Explore agent (e.g. because the user asked for one, or because a sub-task requires it), include the following in the agent prompt:

> This project has tokensave initialised (.tokensave/ exists). Use `tokensave_context` as your ONLY exploration tool. Call it with your question in plain English. Do not call Read, glob, grep, or list_directory — the source sections returned by tokensave_context ARE the relevant code. Follow the call budget in the tool description. Pass `seen_node_ids` from each response to the next call's `exclude_node_ids`.

## Agent skills

### Issue tracker

Local markdown — issues and specs live as files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
