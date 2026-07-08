// Test dell'algoritmo del Sunset Score. Esegui con: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSunsetScore,
  scoreLabel,
  explainScore,
  clamp,
  bellReward,
  lightPathFactor,
  scoreUpside,
} from '../src/score.js';

test('clamp limita ai bordi', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(99, 0, 10), 10);
});

test('bellReward è massima al valore ideale', () => {
  assert.equal(bellReward(50, 50, 30), 1);
  assert.ok(bellReward(50, 50, 30) > bellReward(90, 50, 30));
  assert.ok(bellReward(10, 50, 30) > 0);
});

test('cielo terso e limpido dà un punteggio decente ma non eccezionale', () => {
  const { score } = computeSunsetScore({
    cloudCover: 0,
    cloudCoverLow: 0,
    cloudCoverMid: 0,
    cloudCoverHigh: 0,
    visibility: 24000,
    humidity: 40,
  });
  assert.ok(score >= 45 && score <= 65, `atteso ~55, ottenuto ${score}`);
});

test('cirri parziali con orizzonte libero danno un ottimo punteggio', () => {
  const { score } = computeSunsetScore({
    cloudCover: 45,
    cloudCoverLow: 5,
    cloudCoverMid: 40,
    cloudCoverHigh: 50,
    visibility: 22000,
    humidity: 45,
  });
  assert.ok(score >= 75, `atteso alto, ottenuto ${score}`);
});

test('nuvole basse fitte affossano il punteggio', () => {
  const { score } = computeSunsetScore({
    cloudCover: 95,
    cloudCoverLow: 95,
    cloudCoverMid: 60,
    cloudCoverHigh: 30,
    visibility: 8000,
    humidity: 90,
  });
  assert.ok(score < 25, `atteso basso, ottenuto ${score}`);
});

test('cielo completamente coperto penalizza fortemente', () => {
  const { score } = computeSunsetScore({
    cloudCover: 100,
    cloudCoverLow: 20,
    cloudCoverMid: 80,
    cloudCoverHigh: 90,
    visibility: 15000,
    humidity: 70,
  });
  assert.ok(score < 30, `atteso basso per overcast, ottenuto ${score}`);
});

test('i cirri alti, anche fitti, non contano come overcast', () => {
  // Cielo pieno di cirri alti (90%) ma senza deck basso/medio: è lo scenario
  // migliore, NON deve subire la penalità "cielo coperto".
  const { factors, score } = computeSunsetScore({
    cloudCover: 90,
    cloudCoverLow: 0,
    cloudCoverMid: 0,
    cloudCoverHigh: 90,
    visibility: 22000,
    humidity: 45,
  });
  assert.equal(factors.overcast, 0, `overcast atteso 0, ottenuto ${factors.overcast}`);
  // Deve battere nettamente lo stesso cielo ma con un deck medio opaco.
  const conDeck = computeSunsetScore({
    cloudCover: 90,
    cloudCoverLow: 10,
    cloudCoverMid: 90,
    cloudCoverHigh: 90,
    visibility: 22000,
    humidity: 45,
  });
  assert.ok(conDeck.factors.overcast > 0.5, 'un deck medio fitto deve attivare overcast');
  assert.ok(score > conDeck.score, `cirri (${score}) devono battere deck (${conDeck.score})`);
});

test('il punteggio resta sempre in [0,100]', () => {
  for (const v of [0, 50, 100]) {
    const { score } = computeSunsetScore({
      cloudCover: v,
      cloudCoverLow: v,
      cloudCoverMid: v,
      cloudCoverHigh: v,
      visibility: v * 300,
      humidity: v,
    });
    assert.ok(score >= 0 && score <= 100);
  }
});

test('scoreLabel restituisce i codici della scala', () => {
  assert.equal(scoreLabel(90), 'exceptional');
  assert.equal(scoreLabel(60), 'good');
  assert.equal(scoreLabel(10), 'poor');
});

test('l’aerosol è opzionale e non cambia il punteggio se assente', () => {
  const base = {
    cloudCover: 45,
    cloudCoverLow: 5,
    cloudCoverMid: 40,
    cloudCoverHigh: 50,
    visibility: 22000,
    humidity: 45,
  };
  const senza = computeSunsetScore(base).score;
  const conNeutro = computeSunsetScore({ ...base, aerosol: null, pm25: null }).score;
  assert.equal(senza, conNeutro);
});

test('foschia da particolato elevato abbassa il punteggio', () => {
  const base = {
    cloudCover: 45,
    cloudCoverLow: 5,
    cloudCoverMid: 40,
    cloudCoverHigh: 50,
    visibility: 22000,
    humidity: 45,
  };
  const pulito = computeSunsetScore({ ...base, aerosol: 0.1, pm25: 5 }).score;
  const foschia = computeSunsetScore({ ...base, aerosol: 0.9, pm25: 90 }).score;
  assert.ok(foschia < pulito, `foschia (${foschia}) dovrebbe essere < pulito (${pulito})`);
});

test('aerosol moderato dà un piccolo bonus rispetto ad aria quasi assente', () => {
  const base = {
    cloudCover: 40,
    cloudCoverLow: 5,
    cloudCoverMid: 35,
    cloudCoverHigh: 45,
    visibility: 22000,
    humidity: 45,
  };
  const quasiZero = computeSunsetScore({ ...base, aerosol: 0.02, pm25: 3 }).score;
  const moderato = computeSunsetScore({ ...base, aerosol: 0.2, pm25: 8 }).score;
  assert.ok(moderato >= quasiZero, `moderato (${moderato}) >= quasiZero (${quasiZero})`);
});

test('explainScore segnala le nuvole basse come negative', () => {
  const { factors } = computeSunsetScore({
    cloudCover: 80,
    cloudCoverLow: 70,
    cloudCoverMid: 30,
    cloudCoverHigh: 40,
    visibility: 12000,
    humidity: 80,
  });
  const notes = explainScore(factors);
  const low = notes.find((n) => n.code === 'lowBad');
  assert.ok(low, 'attesa una nota sulle nuvole basse');
  assert.equal(low.sentiment, 'bad');
  assert.equal(low.params.low, 70);
});

// ---------------------------------------------------------------------------
// Percorso della luce (lightPathFactor + gate pathClear)
// ---------------------------------------------------------------------------

/** Campione sereno a una data distanza. */
const sereno = (distKm) => ({ distKm, cloudCoverLow: 0, cloudCoverMid: 0, cloudCoverHigh: 0 });
/** Muro di nuvole basse a una data distanza. */
const muro = (distKm) => ({ distKm, cloudCoverLow: 100, cloudCoverMid: 0, cloudCoverHigh: 0 });

test('lightPathFactor è null con meno di 2 campioni validi', () => {
  assert.equal(lightPathFactor([]), null);
  assert.equal(lightPathFactor([sereno(90)]), null);
  assert.equal(lightPathFactor([sereno(90), { distKm: 160 }]), null); // senza coperture
  assert.equal(lightPathFactor(null), null);
});

test('lightPathFactor con cielo sereno lungo tutto il raggio è ~1', () => {
  const clear = lightPathFactor([sereno(40), sereno(90), sereno(160), sereno(250)]);
  assert.ok(clear > 0.95, `atteso > 0.95, ottenuto ${clear}`);
});

test('un muro di nuvole basse a 90 km abbassa molto la trasparenza', () => {
  const clear = lightPathFactor([sereno(40), muro(90), sereno(160), sereno(250)]);
  assert.ok(clear < 0.6, `atteso < 0.6, ottenuto ${clear}`);
});

test('un muro lontano (250 km) pesa più di uno vicino (90 km)', () => {
  const vicino = lightPathFactor([sereno(40), muro(90), sereno(160), sereno(250)]);
  const lontano = lightPathFactor([sereno(40), sereno(90), sereno(160), muro(250)]);
  assert.ok(lontano < vicino, `lontano (${lontano}) dovrebbe essere < vicino (${vicino})`);
});

test('i cirri lontani sono traslucidi: penalità lieve', () => {
  const clear = lightPathFactor([
    sereno(40),
    sereno(90),
    sereno(160),
    { distKm: 250, cloudCoverLow: 0, cloudCoverMid: 0, cloudCoverHigh: 100 },
  ]);
  assert.ok(clear >= 0.75, `atteso >= 0.75, ottenuto ${clear}`);
});

test('lightPathFactor è monotono nella copertura', () => {
  const mk = (low) => [
    sereno(40),
    { distKm: 90, cloudCoverLow: low, cloudCoverMid: 0, cloudCoverHigh: 0 },
    sereno(160),
    sereno(250),
  ];
  assert.ok(lightPathFactor(mk(80)) < lightPathFactor(mk(40)));
  assert.ok(lightPathFactor(mk(40)) < lightPathFactor(mk(10)));
});

test('pathClear è opzionale: null o 1 non cambiano il punteggio', () => {
  const base = {
    cloudCover: 45,
    cloudCoverLow: 5,
    cloudCoverMid: 40,
    cloudCoverHigh: 50,
    visibility: 22000,
    humidity: 45,
  };
  const senza = computeSunsetScore(base).score;
  assert.equal(computeSunsetScore({ ...base, pathClear: null }).score, senza);
  assert.equal(computeSunsetScore({ ...base, pathClear: 1 }).score, senza);
});

test('un percorso della luce bloccato abbassa il punteggio', () => {
  const base = {
    cloudCover: 45,
    cloudCoverLow: 5,
    cloudCoverMid: 40,
    cloudCoverHigh: 50,
    visibility: 22000,
    humidity: 45,
  };
  const libero = computeSunsetScore({ ...base, pathClear: 0.9 }).score;
  const bloccato = computeSunsetScore({ ...base, pathClear: 0.2 }).score;
  assert.ok(bloccato < libero, `bloccato (${bloccato}) dovrebbe essere < libero (${libero})`);
  const muroTotale = computeSunsetScore({ ...base, pathClear: 0 }).score;
  assert.ok(muroTotale > 0 && muroTotale <= 100);
});

test('explainScore segnala il percorso bloccato come negativo', () => {
  const { factors } = computeSunsetScore({
    cloudCover: 45,
    cloudCoverLow: 5,
    cloudCoverMid: 40,
    cloudCoverHigh: 50,
    visibility: 22000,
    humidity: 45,
    pathClear: 0.2,
  });
  const nota = explainScore(factors).find((n) => n.code === 'pathBlocked');
  assert.ok(nota, 'attesa una nota pathBlocked');
  assert.equal(nota.sentiment, 'bad');
  assert.equal(nota.params.clear, 20);
});

test('explainScore: via libera è una nota positiva solo con drama locale', () => {
  const conDrama = computeSunsetScore({
    cloudCover: 45,
    cloudCoverLow: 5,
    cloudCoverMid: 40,
    cloudCoverHigh: 50,
    visibility: 22000,
    humidity: 45,
    pathClear: 0.9,
  }).factors;
  assert.ok(explainScore(conDrama).some((n) => n.code === 'pathClear'));

  const senzaDrama = computeSunsetScore({
    cloudCover: 0,
    cloudCoverLow: 0,
    cloudCoverMid: 0,
    cloudCoverHigh: 0,
    visibility: 24000,
    humidity: 40,
    pathClear: 0.9,
  }).factors;
  assert.ok(!explainScore(senzaDrama).some((n) => n.code.startsWith('path')));
});

test('explainScore: trasparenza intermedia dà una nota neutra', () => {
  const { factors } = computeSunsetScore({
    cloudCover: 45,
    cloudCoverLow: 5,
    cloudCoverMid: 40,
    cloudCoverHigh: 50,
    visibility: 22000,
    humidity: 45,
    pathClear: 0.6,
  });
  const nota = explainScore(factors).find((n) => n.code === 'pathPartial');
  assert.ok(nota, 'attesa una nota pathPartial');
  assert.equal(nota.sentiment, 'neutral');
});

test('senza dato di percorso non compaiono note path*', () => {
  const { factors } = computeSunsetScore({
    cloudCover: 45,
    cloudCoverLow: 5,
    cloudCoverMid: 40,
    cloudCoverHigh: 50,
    visibility: 22000,
    humidity: 45,
  });
  assert.ok(!explainScore(factors).some((n) => n.code.startsWith('path')));
});

// ---------------------------------------------------------------------------
// Leve controfattuali (scoreUpside): cosa manca per un punteggio più alto
// ---------------------------------------------------------------------------

test('scoreUpside: cielo sereno → i cirri sono la leva principale', () => {
  const upside = scoreUpside({
    cloudCover: 0,
    cloudCoverLow: 0,
    cloudCoverMid: 0,
    cloudCoverHigh: 0,
    visibility: 24000,
    humidity: 40,
  });
  assert.ok(upside.length >= 1);
  assert.equal(upside[0].code, 'cirrus');
  assert.ok(upside[0].gain >= 15, `atteso gain >= 15, ottenuto ${upside[0].gain}`);
});

test('scoreUpside: nuvole basse dominanti → orizzonte libero in testa', () => {
  const upside = scoreUpside({
    cloudCover: 80,
    cloudCoverLow: 70,
    cloudCoverMid: 10,
    cloudCoverHigh: 50,
    visibility: 24000,
    humidity: 45,
  });
  assert.equal(upside[0].code, 'horizon');
  assert.ok(upside[0].gain >= 30);
});

test('scoreUpside: condizioni ideali → nessuna leva', () => {
  const upside = scoreUpside({
    cloudCover: 50,
    cloudCoverLow: 0,
    cloudCoverMid: 0,
    cloudCoverHigh: 50,
    visibility: 24000,
    humidity: 45,
    aerosol: 0.2,
    pm25: 8,
    pathClear: 1,
  });
  assert.deepEqual(upside, []);
});

test('scoreUpside: la leva path esiste solo col dato presente', () => {
  const base = {
    cloudCover: 50,
    cloudCoverLow: 0,
    cloudCoverMid: 0,
    cloudCoverHigh: 50,
    visibility: 24000,
    humidity: 45,
  };
  const con = scoreUpside({ ...base, pathClear: 0.2 });
  assert.ok(con.some((l) => l.code === 'path'), 'attesa la leva path');
  const senza = scoreUpside(base);
  assert.ok(!senza.some((l) => l.code === 'path'));
});

test('scoreUpside: la leva haze è monotona e richiede il dato', () => {
  const base = {
    cloudCover: 50,
    cloudCoverLow: 0,
    cloudCoverMid: 0,
    cloudCoverHigh: 50,
    visibility: 24000,
    humidity: 45,
  };
  // Senza aerosol/pm25 la leva non esiste.
  assert.ok(!scoreUpside(base).some((l) => l.code === 'haze'));
  // Aria "troppo pulita": la patch min() non deve suggerire di AGGIUNGERE pulviscolo.
  assert.ok(!scoreUpside({ ...base, aerosol: 0.02, pm25: 3 }).some((l) => l.code === 'haze'));
  // Foschia pesante: la leva compare.
  assert.ok(scoreUpside({ ...base, aerosol: 0.9, pm25: 80 }).some((l) => l.code === 'haze'));
});

test('scoreUpside: guadagni positivi, coerenti, ordinati e al massimo 3', () => {
  const cond = {
    cloudCover: 60,
    cloudCoverLow: 45,
    cloudCoverMid: 20,
    cloudCoverHigh: 5,
    visibility: 6000,
    humidity: 90,
    aerosol: 0.7,
    pm25: 60,
    pathClear: 0.3,
  };
  const base = computeSunsetScore(cond).score;
  const upside = scoreUpside(cond);
  assert.ok(upside.length >= 1 && upside.length <= 3);
  for (const l of upside) {
    assert.ok(l.gain >= 5);
    assert.ok(l.target <= 100);
    assert.equal(l.target, base + l.gain);
  }
  for (let i = 1; i < upside.length; i++) {
    assert.ok(upside[i - 1].gain >= upside[i].gain, 'attesi guadagni decrescenti');
  }
});
