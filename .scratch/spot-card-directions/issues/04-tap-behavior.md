# 04 — Tap behavior: card-only + explicit re-eval; mini-map expands

Status: done
Blocked by: 02

## Big map (#map)
- Today `addSpotMarkers` binds both a popup AND `onSpotClick → selectPoint`
  (re-evaluates the spot as a new point). Change so a tap **only opens the card**.
- The re-evaluation moves into the card's **Evaluate this spot** button, which
  calls the same `selectPoint(s.lat, s.lon)` path.

## Results mini-map
- `mountMiniMap` builds overlays without `onSpotClick`; spot dots still open the
  old bubble. Change so tapping a spot on the mini-map **expands to the big map**
  (route to `#map`, same as `onExpand`), rather than opening a bubble there.

## Done when
- Big-map spot tap shows the card; re-eval only via its button.
- Mini-map spot tap opens the big map (no card/bubble on the mini-map).
