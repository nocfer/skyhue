# 02 — Restyle spot popup into a readable card

Status: done
Blocked by: 01

Rework `spotPopupHtml` (src/map.js) + `.mappop` CSS into a card.

## Contents
- Header: name + view score + sky score.
- Meta row: distance · direction · drive-time (existing values).
- Conditions row (NEW): cloud split low/mid/high + haze label. Source conditions
  via the resolver from #01. Reuse `condDesc` / existing conditions vocabulary and
  thresholds for wording — no new cutoffs.
- Actions: **Directions** button (opens chooser, see #03) + **Evaluate this spot**
  button (see #04). Remove the plain "open on OSM" link.

## Mobile readability (hard requirement — see spec)
- Popup width ≤ viewport; content wraps, no horizontal scroll.
- Distinct scannable rows, not one dense line.
- Cloud split reads at a glance (compact labelled H/M/L values or mini bars).
- Buttons ≥44px tall, full-width or comfortably tappable.

## Constraints
- Imperative Leaflet innerHTML → `escapeHtml` on `s.name` and any user text.
- New i18n keys in both `en` and `it`.

## Done when
- Card renders legibly on a phone-width viewport in both themes.
