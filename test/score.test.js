// Test dell'algoritmo del Sunset Score. Esegui con: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSunsetScore,
  scoreLabel,
  explainScore,
  clamp,
  bellReward,
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
