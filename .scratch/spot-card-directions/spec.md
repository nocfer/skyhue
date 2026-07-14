# Spec: Enriched spot card + directions

Status: done

## Implementation notes (post-build)

- Extracted `condDesc` into a new pure module `src/conds.js` (imports only i18n),
  now shared by `views.js` and `map.js` — avoids duplicating the threshold set.
  Not added to sw.js SHELL (matches `analysis.js`/`session.js`, which the runtime
  fetch handler covers).
- Haze label is derived from **visibility** via `condDesc("vis", …)` — the
  codebase's existing air-clarity vocabulary (`crispAir`/`okVis`/`hazyVis`) —
  rather than raw AOD, so no new thresholds were invented.
- Found + fixed a pre-existing bug the richer card exposed: Leaflet's runtime CSS
  overrode `.leaflet-popup-content-wrapper` background, leaving the dark-theme
  popup white with near-white text (invisible). Fixed with `!important`
  (the file's established pattern for the Leaflet close-button).
- Verified via CDP on a 390px phone viewport, both themes: card readable, no
  horizontal overflow, cloud split + haze render, both actions ≥44px, chooser
  opens with correct origin-less/mode-less Apple/Google/OSM hrefs. No exceptions.

## Problem

Tapping a suggested-spot marker on the map opens a cramped Leaflet bubble showing
only name, view/sky score, distance/direction/drive-time and an "open on OSM" link.
Meanwhile `loadSky` fetches a full forecast per top spot and **discards** the
atmospheric detail (cloud split, visibility, humidity, temperature, aerosol, PM),
keeping only the derived `skyScore`. Users also have no way to route to a spot.

## Goal

1. Turn the spot popup into a readable **card, anchored on the tapped marker**, that
   surfaces the free-but-discarded data which *explains* the sky score.
2. Add a **directions** action so users can navigate to a spot.

## Decisions (from grilling session)

- **Trigger:** tap only, no hover (mobile-first PWA). Tap opens the card.
- **Surface:** the existing Leaflet `bindPopup`, restyled into a card, anchored on
  the marker. Leaflet auto-pans so an edge card slides into view.
- **Scope:** **big map (`#map`) only.** On the results mini-map a spot/map tap
  **expands to the big map** (wire spot clicks to `onExpand`); no card on the mini-map.
- **Markers:** spot markers only. The central analyzed-point bubble is unchanged.
- **Card contents:**
  - Existing: name, view score, sky score, distance / direction / drive-time.
  - New: **cloud split (low/mid/high)** + a **haze label** (clear/hazy/very hazy)
    from aerosol+PM — the two fields that explain the sky score. Reuse `condDesc`
    / existing conditions vocabulary and thresholds; do **not** invent new cutoffs.
  - Actions: **Directions** button (opens chooser) + **Evaluate this spot** button
    (the re-evaluation a tap used to trigger automatically — now explicit).
  - Remove today's plain "open on OSM" link.
- **Data source:** stop discarding `cond` in `loadSky`; store it on scored spots.
  Spots without their own `cond` **fall back to the analyzed point's conditions**
  (near-uniform over ~20 km). **Zero new network calls.**
- **Directions chooser:** overlay reusing the share-sheet pattern — **Apple Maps /
  Google Maps / OSM**.
  - **Origin omitted** → maps app uses the device's location (no geolocation
    permission in SkyHue).
  - **No travel mode** requested — each app's default.
  - Apple/Google deep-links; OSM → `openstreetmap.org/directions?to=<lat>,<lon>`.

## Hard requirement: mobile readability

The card carries a lot (name, two scores, three meta values, cloud split, haze,
two buttons). It **must stay legible and tidy on a small phone screen**:
- Constrain popup width to the viewport (never wider than the screen); let content
  wrap, don't force horizontal scroll.
- Group into scannable rows/sections, not one dense run-on line: a header row
  (name + scores), a meta row (distance · direction · drive), a conditions row
  (cloud split + haze), then the actions.
- Cloud split should read at a glance (e.g. compact H/M/L labelled values or mini
  bars), not three sentences.
- Both action buttons are full-width or comfortably tappable (≥44px tall targets).
- The directions chooser is a full-width bottom-anchored sheet on mobile.
- Verify on a phone-sized viewport in **both themes** before calling it done.

## Constraints / gotchas

- Card is imperative Leaflet `innerHTML`, **not lit** → `escapeHtml` mandatory on
  `s.name` and any user-controlled text (CLAUDE.md).
- New i18n keys in **both** `en` and `it`.
- Shell change → run `npm run stamp` (CI enforces `stamp:check`).
- Tests cover logic only; verify UI visually per the CLAUDE.md CDP recipe. Reach the
  results/map screens via `?lat=..&lon=..&label=..&event=sunset`.

## Out of scope

- Enriching the central analyzed-point popup.
- Per-spot live forecast fetch on card open.
- Requesting the user's geolocation inside SkyHue.
