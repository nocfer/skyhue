// The analysis session: guards async loaders against the user navigating away
// mid-fetch. A "run" captures the analysis identity — the Place, and the Event
// — at the moment a loader starts. When its async work resolves, the loader
// asks whether the run has gone stale and drops a superseded result instead of
// committing it. Nothing is aborted: the in-flight fetch simply goes unused, as
// it did before this module existed.
//
// Two scopes, because the data has two dependencies:
//   - stalePlace(): the Place changed. Spots, elevations and sky scores are
//     tied to the Place only, so they survive an Event switch.
//   - staleEvent(): the Place OR the Event changed. The light-path ray flips
//     between sunrise and sunset, so it must also invalidate on an Event switch.
// Making that split explicit — rather than a subtle difference between two
// hand-written `state.place !== place` checks — is the point of this module.
//
// Future extension (see CONTEXT.md): hand each run an AbortSignal so navigating
// cancels the fetches outright rather than only ignoring their results.
import { state } from "./state.js";

/** Capture the current analysis identity for the loader about to run. */
export function beginRun() {
  const place = state.place;
  const event = state.event;
  return {
    place,
    event,
    /** True once the Place has changed since the run began. */
    stalePlace: () => state.place !== place,
    /** True once the Place or the Event has changed since the run began. */
    staleEvent: () => state.place !== place || state.event !== event,
  };
}
