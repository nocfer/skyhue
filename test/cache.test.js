// Test della cache in memoria (TTL + deduplica). Esegui con: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cached, coordKey, clearCache, TTL, _setCacheBackend } from '../src/cache.js';

/** Backend persistente fittizio (Map) per esercitare il livello L2. */
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

test('coordKey arrotonda le coordinate e applica prefisso/suffisso', () => {
  assert.equal(coordKey('fc', 45.12345, 9.98765), 'fc:45.123,9.988');
  assert.equal(coordKey('spots', 45.12345, 9.98765, 2, '|25'), 'spots:45.12,9.99|25');
});

test('cached riusa il valore per la stessa chiave (producer chiamato una volta)', async () => {
  clearCache();
  let calls = 0;
  const producer = async () => ++calls;
  const a = await cached('k', TTL.FORECAST, producer);
  const b = await cached('k', TTL.FORECAST, producer);
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(calls, 1);
});

test('cached distingue chiavi diverse', async () => {
  clearCache();
  let calls = 0;
  const producer = async () => ++calls;
  await cached('a', TTL.FORECAST, producer);
  await cached('b', TTL.FORECAST, producer);
  assert.equal(calls, 2);
});

test('ttl=0 fa scadere subito la voce (nessun riuso)', async () => {
  clearCache();
  let calls = 0;
  const producer = async () => ++calls;
  await cached('k', 0, producer);
  await cached('k', 0, producer);
  assert.equal(calls, 2);
});

test('gli errori non vengono messi in cache: la chiamata successiva ritenta', async () => {
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

test('IndexedDB (L2): serve il valore dopo lo svuotamento della memoria', async () => {
  clearCache();
  const be = fakeBackend();
  _setCacheBackend(be);
  let calls = 0;
  const producer = async () => ++calls;
  const a = await cached('k', TTL.FORECAST, producer); // producer → L1 + L2
  clearCache(); // svuota solo la memoria (L1)
  const b = await cached('k', TTL.FORECAST, producer); // hit da L2
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(calls, 1);
  assert.ok(be._m.has('k'), 'la voce è stata persistita nel backend');
  _setCacheBackend(null);
});

test('IndexedDB (L2): una voce scaduta non viene servita', async () => {
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

test('IndexedDB (L2): un errore di lettura ricade sul producer', async () => {
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
