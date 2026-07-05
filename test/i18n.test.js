// Test di completezza della i18n: le lingue devono avere le stesse chiavi e gli
// stessi segnaposto {…}. Esegui con: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DICTIONARIES, t, setLang } from '../src/i18n.js';

const langs = Object.keys(DICTIONARIES);

test('sono presenti almeno IT ed EN', () => {
  assert.ok(langs.includes('it'));
  assert.ok(langs.includes('en'));
});

test('ogni lingua ha esattamente lo stesso set di chiavi', () => {
  const itKeys = Object.keys(DICTIONARIES.it).sort();
  for (const l of langs) {
    if (l === 'it') continue;
    const keys = Object.keys(DICTIONARIES[l]).sort();
    const missing = itKeys.filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !itKeys.includes(k));
    assert.deepEqual(missing, [], `${l}: chiavi mancanti rispetto a IT`);
    assert.deepEqual(extra, [], `${l}: chiavi in più rispetto a IT`);
  }
});

test('i segnaposto {…} coincidono tra le lingue', () => {
  const ph = (s) => (String(s).match(/\{[a-zA-Z0-9]+\}/g) || []).sort().join(',');
  for (const k of Object.keys(DICTIONARIES.it)) {
    const ref = ph(DICTIONARIES.it[k]);
    for (const l of langs) {
      if (l === 'it') continue;
      assert.equal(ph(DICTIONARIES[l][k]), ref, `${l}: segnaposto diversi per "${k}"`);
    }
  }
});

test('t() interpola i parametri e ha fallback', () => {
  setLang('it');
  assert.equal(t('cmp.na'), 'dati non disponibili');
  setLang('en');
  assert.equal(t('cmp.na'), 'data unavailable');
  // interpolazione
  assert.ok(t('map.pointLabel', { lat: '1.0', lon: '2.0' }).includes('1.0'));
  // chiave inesistente → restituisce la chiave stessa
  assert.equal(t('chiave.inesistente'), 'chiave.inesistente');
  setLang('it');
});
