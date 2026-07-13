// Tests for the reactive store (patch merge + subscribe/notify). Run with:
// node --test. state.js reads the DOM at import time through a `typeof
// document` guard, so under Node `els` is all-null and importing is safe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { state, update, subscribe } from "../src/state.js";

test("update merges a patch into state", () => {
  update({ dayIndex: 3, event: "sunrise" });
  assert.equal(state.dayIndex, 3);
  assert.equal(state.event, "sunrise");
});

test("update notifies every subscriber once per call", () => {
  let a = 0;
  let b = 0;
  const offA = subscribe(() => a++);
  const offB = subscribe(() => b++);
  update({ dayIndex: 1 });
  assert.equal(a, 1);
  assert.equal(b, 1);
  offA();
  offB();
});

test("a bare update() notifies without changing a field", () => {
  const before = { ...state };
  let n = 0;
  const off = subscribe(() => n++);
  update();
  assert.equal(n, 1);
  assert.deepEqual({ ...state }, before);
  off();
});

test("unsubscribe stops further notifications and is idempotent", () => {
  let n = 0;
  const off = subscribe(() => n++);
  update({ dayIndex: 0 });
  assert.equal(n, 1);
  off();
  update({ dayIndex: 0 });
  assert.equal(n, 1); // no longer notified
  off(); // calling again is a no-op, not an error
  assert.equal(n, 1);
});

test("unsubscribing mid-notify does not skip other subscribers", () => {
  // update() iterates a snapshot, so a listener that unsubscribes another
  // (or itself) during notify must not drop a sibling from the same round.
  let a = 0;
  let b = 0;
  const offB = subscribe(() => b++);
  const offA = subscribe(() => {
    a++;
    offB(); // remove B while A is running
  });
  update();
  assert.equal(a, 1);
  assert.equal(b, 1); // B still ran this round
  update();
  assert.equal(a, 2);
  assert.equal(b, 1); // B gone from the next round
  offA();
});
