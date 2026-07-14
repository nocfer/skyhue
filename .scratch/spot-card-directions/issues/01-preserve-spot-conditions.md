# 01 — Preserve per-spot conditions (data layer)

Status: done

Currently `loadSky` (src/analysis.js) builds `cond = {...conditionsAtTime, ...airAtTime}`
per scored spot and discards it after `computeSunsetScore(cond).score`.

## Work
- Store `cond` on the spot (e.g. `s.cond = cond`) instead of discarding it.
- Add a small resolver the card can call: given a spot, return its conditions —
  the spot's own `cond` if present, else the analyzed point's conditions
  (`conditionsAtTime(state.forecast, iso)` + `airAtTime(state.air, iso)` for the
  current event/day). Keep it pure/testable where possible.
- No new network calls.

## Done when
- Scored spots carry their real conditions; others resolve to the point's.
- `npm test` + `node --check src/*.js` pass.
