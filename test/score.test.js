// Tests for the Sunset Score algorithm. Run with: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeSunsetScore,
  scoreLabel,
  explainScore,
  clamp,
  bellReward,
  lightPathFactor,
  scoreUpside,
  scoreCeiling,
} from "../src/score.js";

test("clamp limits to the bounds", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(99, 0, 10), 10);
});

test("bellReward is maximal at the ideal value", () => {
  assert.equal(bellReward(50, 50, 30), 1);
  assert.ok(bellReward(50, 50, 30) > bellReward(90, 50, 30));
  assert.ok(bellReward(10, 50, 30) > 0);
});

test("a crisp, clear sky gives a decent but not exceptional score", () => {
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

test("partial cirrus with a free horizon gives an excellent score", () => {
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

test("thick low clouds sink the score", () => {
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

test("a fully overcast sky penalizes heavily", () => {
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

test("high cirrus, even thick, does not count as overcast", () => {
  // Sky full of high cirrus (90%) but no low/mid deck: this is the best
  // scenario and must NOT take the "overcast sky" penalty.
  const { factors, score } = computeSunsetScore({
    cloudCover: 90,
    cloudCoverLow: 0,
    cloudCoverMid: 0,
    cloudCoverHigh: 90,
    visibility: 22000,
    humidity: 45,
  });
  assert.equal(
    factors.overcast,
    0,
    `overcast atteso 0, ottenuto ${factors.overcast}`,
  );
  // It must clearly beat the same sky but with an opaque mid deck.
  const conDeck = computeSunsetScore({
    cloudCover: 90,
    cloudCoverLow: 10,
    cloudCoverMid: 90,
    cloudCoverHigh: 90,
    visibility: 22000,
    humidity: 45,
  });
  assert.ok(
    conDeck.factors.overcast > 0.5,
    "un deck medio fitto deve attivare overcast",
  );
  assert.ok(
    score > conDeck.score,
    `cirri (${score}) devono battere deck (${conDeck.score})`,
  );
});

test("the score always stays in [0,100]", () => {
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

test("scoreLabel returns the scale codes", () => {
  assert.equal(scoreLabel(90), "exceptional");
  assert.equal(scoreLabel(60), "good");
  assert.equal(scoreLabel(10), "poor");
});

test("aerosol is optional and does not change the score when absent", () => {
  const base = {
    cloudCover: 45,
    cloudCoverLow: 5,
    cloudCoverMid: 40,
    cloudCoverHigh: 50,
    visibility: 22000,
    humidity: 45,
  };
  const without = computeSunsetScore(base).score;
  const withNeutral = computeSunsetScore({
    ...base,
    aerosol: null,
    pm25: null,
  }).score;
  assert.equal(without, withNeutral);
});

test("haze from high particulate lowers the score", () => {
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
  assert.ok(
    foschia < pulito,
    `foschia (${foschia}) dovrebbe essere < pulito (${pulito})`,
  );
});

test("moderate aerosol gives a small bonus over nearly absent air", () => {
  const base = {
    cloudCover: 40,
    cloudCoverLow: 5,
    cloudCoverMid: 35,
    cloudCoverHigh: 45,
    visibility: 22000,
    humidity: 45,
  };
  const quasiZero = computeSunsetScore({
    ...base,
    aerosol: 0.02,
    pm25: 3,
  }).score;
  const moderato = computeSunsetScore({ ...base, aerosol: 0.2, pm25: 8 }).score;
  assert.ok(
    moderato >= quasiZero,
    `moderato (${moderato}) >= quasiZero (${quasiZero})`,
  );
});

test("explainScore flags low clouds as negative", () => {
  const { factors } = computeSunsetScore({
    cloudCover: 80,
    cloudCoverLow: 70,
    cloudCoverMid: 30,
    cloudCoverHigh: 40,
    visibility: 12000,
    humidity: 80,
  });
  const notes = explainScore(factors);
  const low = notes.find((n) => n.code === "lowBad");
  assert.ok(low, "attesa una nota sulle nuvole basse");
  assert.equal(low.sentiment, "bad");
  assert.equal(low.params.low, 70);
});

// ---------------------------------------------------------------------------
// Light path (lightPathFactor + pathClear gate)
// ---------------------------------------------------------------------------

/** Clear sample at a given distance. */
const sereno = (distKm) => ({
  distKm,
  cloudCoverLow: 0,
  cloudCoverMid: 0,
  cloudCoverHigh: 0,
});
/** Wall of low clouds at a given distance. */
const muro = (distKm) => ({
  distKm,
  cloudCoverLow: 100,
  cloudCoverMid: 0,
  cloudCoverHigh: 0,
});

test("lightPathFactor is null with fewer than 2 valid samples", () => {
  assert.equal(lightPathFactor([]), null);
  assert.equal(lightPathFactor([sereno(90)]), null);
  assert.equal(lightPathFactor([sereno(90), { distKm: 160 }]), null); // no cover data
  assert.equal(lightPathFactor(null), null);
});

test("lightPathFactor with a clear sky along the whole ray is ~1", () => {
  const clear = lightPathFactor([
    sereno(40),
    sereno(90),
    sereno(160),
    sereno(250),
  ]);
  assert.ok(clear > 0.95, `atteso > 0.95, ottenuto ${clear}`);
});

test("a wall of low clouds at 90 km lowers the transparency a lot", () => {
  const clear = lightPathFactor([
    sereno(40),
    muro(90),
    sereno(160),
    sereno(250),
  ]);
  assert.ok(clear < 0.6, `atteso < 0.6, ottenuto ${clear}`);
});

test("a far wall (250 km) weighs more than a near one (90 km)", () => {
  const vicino = lightPathFactor([
    sereno(40),
    muro(90),
    sereno(160),
    sereno(250),
  ]);
  const lontano = lightPathFactor([
    sereno(40),
    sereno(90),
    sereno(160),
    muro(250),
  ]);
  assert.ok(
    lontano < vicino,
    `lontano (${lontano}) dovrebbe essere < vicino (${vicino})`,
  );
});

test("far cirrus is translucent: mild penalty", () => {
  const clear = lightPathFactor([
    sereno(40),
    sereno(90),
    sereno(160),
    { distKm: 250, cloudCoverLow: 0, cloudCoverMid: 0, cloudCoverHigh: 100 },
  ]);
  assert.ok(clear >= 0.75, `atteso >= 0.75, ottenuto ${clear}`);
});

test("lightPathFactor is monotone in the cover", () => {
  const mk = (low) => [
    sereno(40),
    { distKm: 90, cloudCoverLow: low, cloudCoverMid: 0, cloudCoverHigh: 0 },
    sereno(160),
    sereno(250),
  ];
  assert.ok(lightPathFactor(mk(80)) < lightPathFactor(mk(40)));
  assert.ok(lightPathFactor(mk(40)) < lightPathFactor(mk(10)));
});

test("pathClear is optional: null or 1 do not change the score", () => {
  const base = {
    cloudCover: 45,
    cloudCoverLow: 5,
    cloudCoverMid: 40,
    cloudCoverHigh: 50,
    visibility: 22000,
    humidity: 45,
  };
  const without = computeSunsetScore(base).score;
  assert.equal(computeSunsetScore({ ...base, pathClear: null }).score, without);
  assert.equal(computeSunsetScore({ ...base, pathClear: 1 }).score, without);
});

test("a blocked light path lowers the score", () => {
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
  assert.ok(
    bloccato < libero,
    `bloccato (${bloccato}) dovrebbe essere < libero (${libero})`,
  );
  const muroTotale = computeSunsetScore({ ...base, pathClear: 0 }).score;
  assert.ok(muroTotale > 0 && muroTotale <= 100);
});

test("explainScore flags the blocked path as negative", () => {
  const { factors } = computeSunsetScore({
    cloudCover: 45,
    cloudCoverLow: 5,
    cloudCoverMid: 40,
    cloudCoverHigh: 50,
    visibility: 22000,
    humidity: 45,
    pathClear: 0.2,
  });
  const nota = explainScore(factors).find((n) => n.code === "pathBlocked");
  assert.ok(nota, "attesa una nota pathBlocked");
  assert.equal(nota.sentiment, "bad");
  assert.equal(nota.params.clear, 20);
});

test("explainScore: a clear path is a positive note only with local drama", () => {
  const conDrama = computeSunsetScore({
    cloudCover: 45,
    cloudCoverLow: 5,
    cloudCoverMid: 40,
    cloudCoverHigh: 50,
    visibility: 22000,
    humidity: 45,
    pathClear: 0.9,
  }).factors;
  assert.ok(explainScore(conDrama).some((n) => n.code === "pathClear"));

  const senzaDrama = computeSunsetScore({
    cloudCover: 0,
    cloudCoverLow: 0,
    cloudCoverMid: 0,
    cloudCoverHigh: 0,
    visibility: 24000,
    humidity: 40,
    pathClear: 0.9,
  }).factors;
  assert.ok(!explainScore(senzaDrama).some((n) => n.code.startsWith("path")));
});

test("explainScore: intermediate transparency gives a neutral note", () => {
  const { factors } = computeSunsetScore({
    cloudCover: 45,
    cloudCoverLow: 5,
    cloudCoverMid: 40,
    cloudCoverHigh: 50,
    visibility: 22000,
    humidity: 45,
    pathClear: 0.6,
  });
  const nota = explainScore(factors).find((n) => n.code === "pathPartial");
  assert.ok(nota, "attesa una nota pathPartial");
  assert.equal(nota.sentiment, "neutral");
});

test("without path data no path* notes appear", () => {
  const { factors } = computeSunsetScore({
    cloudCover: 45,
    cloudCoverLow: 5,
    cloudCoverMid: 40,
    cloudCoverHigh: 50,
    visibility: 22000,
    humidity: 45,
  });
  assert.ok(!explainScore(factors).some((n) => n.code.startsWith("path")));
});

// ---------------------------------------------------------------------------
// Counterfactual levers (scoreUpside): what's missing for a higher score
// ---------------------------------------------------------------------------

test("scoreUpside: clear sky → cirrus is the main lever", () => {
  const upside = scoreUpside({
    cloudCover: 0,
    cloudCoverLow: 0,
    cloudCoverMid: 0,
    cloudCoverHigh: 0,
    visibility: 24000,
    humidity: 40,
  });
  assert.ok(upside.length >= 1);
  assert.equal(upside[0].code, "cirrus");
  assert.ok(
    upside[0].gain >= 15,
    `atteso gain >= 15, ottenuto ${upside[0].gain}`,
  );
});

test("scoreUpside: dominant low clouds → free horizon on top", () => {
  const upside = scoreUpside({
    cloudCover: 80,
    cloudCoverLow: 70,
    cloudCoverMid: 10,
    cloudCoverHigh: 50,
    visibility: 24000,
    humidity: 45,
  });
  assert.equal(upside[0].code, "horizon");
  assert.ok(upside[0].gain >= 30);
});

test("scoreUpside: ideal conditions → no levers", () => {
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

test("scoreUpside: the path lever only exists when the datum is present", () => {
  const base = {
    cloudCover: 50,
    cloudCoverLow: 0,
    cloudCoverMid: 0,
    cloudCoverHigh: 50,
    visibility: 24000,
    humidity: 45,
  };
  const withPath = scoreUpside({ ...base, pathClear: 0.2 });
  assert.ok(
    withPath.some((l) => l.code === "path"),
    "path lever expected",
  );
  const without = scoreUpside(base);
  assert.ok(!without.some((l) => l.code === "path"));
});

test("scoreUpside: the haze lever is monotone and requires the datum", () => {
  const base = {
    cloudCover: 50,
    cloudCoverLow: 0,
    cloudCoverMid: 0,
    cloudCoverHigh: 50,
    visibility: 24000,
    humidity: 45,
  };
  // Without aerosol/pm25 the lever does not exist.
  assert.ok(!scoreUpside(base).some((l) => l.code === "haze"));
  // "Too clean" air: the min() patch must not suggest ADDING particulate.
  assert.ok(
    !scoreUpside({ ...base, aerosol: 0.02, pm25: 3 }).some(
      (l) => l.code === "haze",
    ),
  );
  // Heavy haze: the lever appears.
  assert.ok(
    scoreUpside({ ...base, aerosol: 0.9, pm25: 80 }).some(
      (l) => l.code === "haze",
    ),
  );
});

test("scoreUpside: gains positive, consistent, sorted and at most 3", () => {
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
    assert.ok(
      upside[i - 1].gain >= upside[i].gain,
      "attesi guadagni decrescenti",
    );
  }
});

// ---------------------------------------------------------------------------
// scoreCeiling: all upside levers applied together
// ---------------------------------------------------------------------------

test("scoreCeiling: combined levers beat every single-lever target", () => {
  const cond = {
    cloudCover: 55,
    cloudCoverLow: 40,
    cloudCoverMid: 10,
    cloudCoverHigh: 5,
    visibility: 8000,
    humidity: 85,
    aerosol: 0.15,
    pm25: 8,
    pathClear: 1,
  };
  const ceiling = scoreCeiling(cond);
  assert.equal(ceiling, 95); // the reference scenario used in the UI verification
  for (const l of scoreUpside(cond)) {
    assert.ok(
      ceiling >= l.target,
      `ceiling (${ceiling}) >= target ${l.code} (${l.target})`,
    );
  }
});

test("scoreCeiling: ideal conditions leave the score unchanged", () => {
  const cond = {
    cloudCover: 50,
    cloudCoverLow: 0,
    cloudCoverMid: 0,
    cloudCoverHigh: 50,
    visibility: 24000,
    humidity: 45,
    aerosol: 0.2,
    pm25: 8,
    pathClear: 1,
  };
  assert.equal(scoreCeiling(cond), computeSunsetScore(cond).score);
});

test("scoreCeiling: 100 also needs the ~45% mid-cloud veil we do not suggest", () => {
  const cond = {
    cloudCover: 55,
    cloudCoverLow: 40,
    cloudCoverMid: 10,
    cloudCoverHigh: 5,
    visibility: 8000,
    humidity: 85,
    aerosol: 0.15,
    pm25: 8,
    pathClear: 1,
  };
  assert.ok(scoreCeiling(cond) < 100);
  assert.equal(scoreCeiling({ ...cond, cloudCoverMid: 45 }), 100);
});

test("scoreCeiling: never below the current score (monotone patches)", () => {
  const conds = [
    {
      cloudCover: 0,
      cloudCoverLow: 0,
      cloudCoverMid: 0,
      cloudCoverHigh: 0,
      visibility: 24000,
      humidity: 40,
    },
    {
      cloudCover: 90,
      cloudCoverLow: 80,
      cloudCoverMid: 60,
      cloudCoverHigh: 20,
      visibility: 4000,
      humidity: 95,
      aerosol: 0.8,
      pm25: 70,
      pathClear: 0.1,
    },
    {
      cloudCover: 50,
      cloudCoverLow: 10,
      cloudCoverMid: 45,
      cloudCoverHigh: 55,
      visibility: 20000,
      humidity: 55,
    },
  ];
  for (const c of conds) {
    assert.ok(scoreCeiling(c) >= computeSunsetScore(c).score);
  }
});
