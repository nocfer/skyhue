# 05 — Verify end-to-end + stamp

Status: done
Blocked by: 02, 03, 04

## Work
- `npm run stamp` (shell changed; CI runs `stamp:check`).
- `npm test` + `node --check src/*.js`.
- Visual verify per CLAUDE.md recipe: throwaway Chrome profile, headless via CDP.
  - Reach the map with a real point: `?lat=..&lon=..&label=..&event=sunset`, then
    navigate to `#map`.
  - Tap a spot → card. Check both themes and a **phone-width viewport**:
    card legible, no horizontal scroll, cloud split scannable, buttons tappable.
  - Open the directions chooser (fixed-viewport capture for the overlay).
  - Confirm mini-map spot tap expands to the big map.

## Done when
- All checks pass and screenshots confirm mobile readability in both themes.
