// Tests for the in-memory cache (TTL + dedup). Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cached, coordKey, clearCache, TTL, _setCacheBackend } from '../src/cache.js';

/** Fake persistent backend (Map) to exercise the L2 layer. */
function fakeBackend() {
  const m = new Map();
  return {
    _m: m,
    async get(k) {
      return m.get(k);
    },
    async set(k, e) {
      m.set(k, e);
    },
  };
}

test('coordKey rounds the coordinates and applies prefix/suffix', () => {
  assert.equal(coordKey('fc', 45.12345, 9.98765), 'fc:45.123,9.988');
  assert.equal(coordKey('spots', 45.12345, 9.98765, 2, '|25'), 'spots:45.12,9.99|25');
});

test('cached reuses the value for the same key (producer called once)', async () => {
  clearCache();
  let calls = 0;
  const producer = async () => ++calls;
  const a = await cached('k', TTL.FORECAST, producer);
  const b = await cached('k', TTL.FORECAST, producer);
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(calls, 1);
});

test('cached distinguishes different keys', async () => {
  clearCache();
  let calls = 0;
  const producer = async () => ++calls;
  await cached('a', TTL.FORECAST, producer);
  await cached('b', TTL.FORECAST, producer);
  assert.equal(calls, 2);
});

test('ttl=0 expires the entry immediately (no reuse)', async () => {
  clearCache();
  let calls = 0;
  const producer = async () => ++calls;
  await cached('k', 0, producer);
  await cached('k', 0, producer);
  assert.equal(calls, 2);
});

test('errors are not cached: the next call retries', async () => {
  clearCache();
  let calls = 0;
  const producer = async () => {
    calls++;
    if (calls === 1) throw new Error('boom');
    return 'ok';
  };
  await assert.rejects(() => cached('k', TTL.FORECAST, producer));
  const v = await cached('k', TTL.FORECAST, producer);
  assert.equal(v, 'ok');
  assert.equal(calls, 2);
});

test('IndexedDB (L2): serves the value after the memory is cleared', async () => {
  clearCache();
  const be = fakeBackend();
  _setCacheBackend(be);
  let calls = 0;
  const producer = async () => ++calls;
  const a = await cached('k', TTL.FORECAST, producer); // producer → L1 + L2
  clearCache(); // clears only the memory (L1)
  const b = await cached('k', TTL.FORECAST, producer); // hit from L2
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(calls, 1);
  assert.ok(be._m.has('k'), 'la voce è stata persistita nel backend');
  _setCacheBackend(null);
});

test('IndexedDB (L2): an expired entry is not served', async () => {
  clearCache();
  const be = fakeBackend();
  be._m.set('k', { value: 'vecchio', expires: Date.now() - 1000 });
  _setCacheBackend(be);
  let calls = 0;
  const v = await cached('k', TTL.FORECAST, async () => {
    calls++;
    return 'nuovo';
  });
  assert.equal(v, 'nuovo');
  assert.equal(calls, 1);
  _setCacheBackend(null);
});

test('IndexedDB (L2): a read error falls back to the producer', async () => {
  clearCache();
  _setCacheBackend({
    get: async () => {
      throw new Error('idb down');
    },
    set: async () => {},
  });
  const v = await cached('k', TTL.FORECAST, async () => 'ok');
  assert.equal(v, 'ok');
  _setCacheBackend(null);
});
