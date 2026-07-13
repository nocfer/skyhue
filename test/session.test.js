// Tests for the analysis session (staleness scopes). Run with: node --test.
// Uses the store's update() to move the identity, then asserts the two scopes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { update } from "../src/state.js";
import { beginRun } from "../src/session.js";

test("a fresh run is not stale in either scope", () => {
  update({ place: { id: "a" }, event: "sunset" });
  const run = beginRun();
  assert.equal(run.stalePlace(), false);
  assert.equal(run.staleEvent(), false);
});

test("changing the place is stale for both scopes", () => {
  update({ place: { id: "a" }, event: "sunset" });
  const run = beginRun();
  update({ place: { id: "b" } });
  assert.equal(run.stalePlace(), true);
  assert.equal(run.staleEvent(), true);
});

test("an event switch is stale for the event scope only, not the place scope", () => {
  update({ place: { id: "a" }, event: "sunset" });
  const run = beginRun();
  update({ event: "sunrise" });
  assert.equal(run.stalePlace(), false); // spots survive an event switch
  assert.equal(run.staleEvent(), true); // the light path does not
});

test("the run captures the identity by reference at begin", () => {
  const placeA = { id: "a" };
  update({ place: placeA, event: "sunset" });
  const run = beginRun();
  assert.equal(run.place, placeA);
  assert.equal(run.event, "sunset");
  // a fresh object with identical contents is still a different Place (by ref),
  // which is how a re-search of the "same" city correctly supersedes old work.
  update({ place: { id: "a" } });
  assert.equal(run.stalePlace(), true);
});
