// Test della cache in memoria (TTL + deduplica). Esegui con: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cached, coordKey, clearCache, TTL } from '../src/cache.js';

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
