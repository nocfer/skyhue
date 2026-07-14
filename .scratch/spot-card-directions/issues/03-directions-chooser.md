# 03 — Directions chooser overlay

Status: done

A provider chooser opened by the card's **Directions** button, reusing the
share-sheet overlay pattern (`openShareSheet` in src/share.js is the reference).

## Providers (destination = spot lat/lon; origin OMITTED; no travel mode)
- **Apple Maps** — `https://maps.apple.com/?daddr=<lat>,<lon>`
- **Google Maps** — `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lon>`
- **OSM** — `https://www.openstreetmap.org/directions?to=<lat>,<lon>`

Open in a new tab (`target="_blank" rel="noopener"`).

## Mobile
- Full-width, bottom-anchored sheet; each provider a ≥44px tappable row.
- `position:fixed` overlay — capture with fixed viewport when screenshotting
  (CLAUDE.md gotcha #5).

## Constraints
- New i18n keys (both `en`/`it`) for the sheet title + provider labels.

## Done when
- Each option opens the correct maps target for the spot; sheet dismisses cleanly.
