// i18n completeness tests: languages must have the same keys and the same
// {…} placeholders. Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DICTIONARIES, t, setLang } from '../src/i18n.js';

const langs = Object.keys(DICTIONARIES);

test('at least IT and EN are present', () => {
  assert.ok(langs.includes('it'));
  assert.ok(langs.includes('en'));
});

test('every language has exactly the same key set', () => {
  const itKeys = Object.keys(DICTIONARIES.it).sort();
  for (const l of langs) {
    if (l === 'it') continue;
    const keys = Object.keys(DICTIONARIES[l]).sort();
    const missing = itKeys.filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !itKeys.includes(k));
    assert.deepEqual(missing, [], `${l}: keys missing compared to IT`);
    assert.deepEqual(extra, [], `${l}: extra keys compared to IT`);
  }
});

test('the {…} placeholders match across languages', () => {
  const ph = (s) => (String(s).match(/\{[a-zA-Z0-9]+\}/g) || []).sort().join(',');
  for (const k of Object.keys(DICTIONARIES.it)) {
    const ref = ph(DICTIONARIES.it[k]);
    for (const l of langs) {
      if (l === 'it') continue;
      assert.equal(ph(DICTIONARIES[l][k]), ref, `${l}: segnaposto diversi per "${k}"`);
    }
  }
});

test('t() interpolates the parameters and has a fallback', () => {
  setLang('it');
  assert.equal(t('cmp.na'), 'dati non disponibili');
  setLang('en');
  assert.equal(t('cmp.na'), 'data unavailable');
  // interpolation
  assert.ok(t('map.pointLabel', { lat: '1.0', lon: '2.0' }).includes('1.0'));
  // missing key → returns the key itself
  assert.equal(t('chiave.inesistente'), 'chiave.inesistente');
  setLang('it');
});
