export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function bellReward(x, ideal, width) {
  const z = (x - ideal) / width;
  return Math.exp(-(z * z));
}

/**
 * @param {Array<{distKm:number, cloudCoverLow?:number, cloudCoverMid?:number,
 *                cloudCoverHigh?:number}>} samples
 * @returns {number|null}
 */
export function lightPathFactor(samples) {
  const valid = (samples ?? []).filter(
    (s) =>
      s &&
      Number.isFinite(s.distKm) &&
      (Number.isFinite(s.cloudCoverLow) ||
        Number.isFinite(s.cloudCoverMid) ||
        Number.isFinite(s.cloudCoverHigh))
  );
  if (valid.length < 2) return null; // dati parziali → neutro, non un falso segnale

  let clear = 1;
  for (const s of valid) {
    const low = clamp(s.cloudCoverLow ?? 0, 0, 100);
    const mid = clamp(s.cloudCoverMid ?? 0, 0, 100);
    const high = clamp(s.cloudCoverHigh ?? 0, 0, 100);
    const block = clamp((low + 0.85 * mid + 0.25 * high) / 100, 0, 1);
    const occlusion = clamp(0.35 + 0.0018 * s.distKm, 0, 0.85);
    clear *= 1 - occlusion * block;
  }
  return clear;
}

/**
 * @typedef {Object} SunsetConditions
 */
export const WEIGHTS = {
  base: 0.35, // un cielo terso "vale" comunque qualcosa
  drama: 0.45, // nuvole alte/medie che catturano il colore
  clarity: 0.2, // trasparenza dell'atmosfera
};

/**
 * @param {SunsetConditions} c
 * @returns {{score:number, factors:Object}}
 */
export function computeSunsetScore(c) {
  const high = clamp(c.cloudCoverHigh ?? 0, 0, 100);
  const mid = clamp(c.cloudCoverMid ?? 0, 0, 100);
  const low = clamp(c.cloudCoverLow ?? 0, 0, 100);
  const total = clamp(c.cloudCover ?? 0, 0, 100);
  const visibility = Math.max(0, c.visibility ?? 24000);
  const humidity = clamp(c.humidity ?? 50, 0, 100);

  const highReward = bellReward(high, 50, 30);
  const midReward = bellReward(mid, 45, 30);
  const drama = 0.6 * highReward + 0.4 * midReward;

  // Trasparenza atmosferica: visibilità alta + umidità bassa = colori vividi.
  const visFactor = clamp(visibility / 24000, 0, 1); // 24 km = eccellente
  const humidityPenalty = clamp((humidity - 60) / 40, 0, 1);
  const clarity = clamp(0.7 * visFactor + 0.3 * (1 - humidityPenalty), 0, 1);

  // Le nuvole basse bloccano il sole sull'orizzonte: penalità moltiplicativa.
  const lowBlock = clamp(low / 70, 0, 1); // ~70% di nuvole basse = orizzonte chiuso
  // "Overcast": il cielo lascia passare poca luce diretta. Conta solo il deck
  // OPACO (nuvole basse + medie): i cirri alti, anche fitti, restano traslucidi
  // e lasciano filtrare la luce radente — usarli per l'overcast penalizzerebbe
  // proprio lo scenario migliore (cielo pieno di cirri accesi). Stimiamo la
  // copertura combinata basse/medie come unione con overlap indipendente.
  const opaqueDeck = clamp(low + mid - (low * mid) / 100, 0, 100);
  const overcast = clamp((opaqueDeck - 70) / 30, 0, 1);

  // Aerosol: un pulviscolo moderato (AOD ~0.2) accende i rossi diffondendo la
  // luce; troppo (foschia/particolato) attenua i colori. Opzionale: se assente
  // non modifica il punteggio (retrocompatibile).
  const aod = c.aerosol ?? null;
  const pm25 = c.pm25 ?? null;
  let aerosolEnhance = 0;
  let aerosolHaze = 0;
  let aerosolMult = 1;
  if (aod !== null) {
    aerosolEnhance = bellReward(aod, 0.2, 0.18); // massimo attorno a 0.2
    aerosolHaze = clamp((aod - 0.45) / 0.55, 0, 1); // foschia oltre ~0.45
    aerosolMult *= 1 + 0.1 * aerosolEnhance - 0.3 * aerosolHaze;
  }
  if (pm25 !== null) {
    const pmHaze = clamp((pm25 - 35) / 65, 0, 1); // >35 µg/m³ inizia a velare
    aerosolHaze = Math.max(aerosolHaze, pmHaze);
    aerosolMult *= 1 - 0.25 * pmHaze;
  }

  // Percorso della luce: quanto è sgombra l'atmosfera LONTANA verso il sole
  // (vedi lightPathFactor). Un muro di nubi a 40-250 km spegne la luce radente
  // prima che arrivi. K=0.45: più della foschia (0.3), meno del lowBlock locale
  // (0.85) — la previsione a quelle distanze ha skill minore e la luce
  // crepuscolare di base sopravvive. Opzionale: assente → punteggio invariato.
  const pathClear = c.pathClear ?? null;
  const pathMult =
    pathClear === null ? 1 : 1 - 0.45 * (1 - clamp(pathClear, 0, 1));

  const raw =
    100 * (WEIGHTS.base + WEIGHTS.drama * drama + WEIGHTS.clarity * clarity);

  const score = clamp(
    raw * (1 - 0.85 * lowBlock) * (1 - 0.9 * overcast) * aerosolMult * pathMult,
    0,
    100
  );

  return {
    score: Math.round(score),
    factors: {
      high,
      mid,
      low,
      total,
      visibility,
      humidity,
      highReward,
      midReward,
      drama,
      clarity,
      visFactor,
      humidityPenalty,
      lowBlock,
      opaqueDeck,
      overcast,
      aerosol: aod,
      pm25,
      aerosolEnhance,
      aerosolHaze,
      pathClear: pathClear === null ? null : clamp(pathClear, 0, 1),
    },
  };
}

/**
 * Codice qualitativo per un punteggio (risolto in testo dalla UI via i18n).
 * @returns {'exceptional'|'great'|'good'|'fair'|'mediocre'|'poor'}
 */
export function scoreLabel(score) {
  if (score >= 85) return 'exceptional';
  if (score >= 70) return 'great';
  if (score >= 55) return 'good';
  if (score >= 40) return 'fair';
  if (score >= 20) return 'mediocre';
  return 'poor';
}

/**
 * Genera le note esplicative dai fattori del punteggio, in forma NEUTRA rispetto
 * alla lingua: ogni voce ha { code, sentiment, icon, params }. Il testo (titolo +
 * dettaglio) viene risolto dalla UI via i18n con la chiave `explain.<code>`.
 *
 * @param {ReturnType<typeof computeSunsetScore>['factors']} f
 * @returns {Array<{code:string, sentiment:string, icon:string, params:Object}>}
 */
export function explainScore(f) {
  const notes = [];
  const visKm = Math.round(f.visibility / 1000);

  // Nuvole alte
  if (f.high >= 20 && f.high <= 75) {
    notes.push({ code: 'highGood', sentiment: 'good', icon: 'cloud', params: { high: Math.round(f.high) } });
  } else if (f.high > 75) {
    notes.push({ code: 'highMuch', sentiment: 'neutral', icon: 'cloud', params: { high: Math.round(f.high) } });
  } else {
    notes.push({ code: 'highFew', sentiment: 'neutral', icon: 'cloud-sun', params: {} });
  }

  // Nuvole medie
  if (f.mid >= 20 && f.mid <= 65) {
    notes.push({ code: 'midGood', sentiment: 'good', icon: 'cloud-sun', params: { mid: Math.round(f.mid) } });
  }

  // Nuvole basse (fattore critico)
  if (f.low >= 40) {
    notes.push({ code: 'lowBad', sentiment: 'bad', icon: 'haze', params: { low: Math.round(f.low) } });
  } else if (f.low >= 15) {
    notes.push({ code: 'lowSome', sentiment: 'neutral', icon: 'haze', params: { low: Math.round(f.low) } });
  } else {
    notes.push({ code: 'lowClear', sentiment: 'good', icon: 'sunset', params: {} });
  }

  // Copertura totale
  if (f.overcast > 0.5) {
    notes.push({ code: 'overcast', sentiment: 'bad', icon: 'cloud', params: { total: Math.round(f.total) } });
  }

  // Visibilità
  if (f.visFactor >= 0.85) {
    notes.push({ code: 'visGood', sentiment: 'good', icon: 'eye', params: { visKm } });
  } else if (f.visFactor < 0.4) {
    notes.push({ code: 'visBad', sentiment: 'bad', icon: 'cloud-fog', params: { visKm } });
  }

  // Aerosol / particolato
  if (f.aerosol !== null && f.aerosol !== undefined) {
    if (f.aerosolHaze >= 0.5) {
      notes.push({
        code: 'hazeBad',
        sentiment: 'bad',
        icon: 'haze',
        params: { pm25: f.pm25 != null ? Math.round(f.pm25) : null },
      });
    } else if (f.aerosolEnhance >= 0.6) {
      notes.push({ code: 'aerosolGood', sentiment: 'good', icon: 'flame', params: {} });
    }
  }

  // Percorso della luce (solo se i campioni lontani sono disponibili)
  if (f.pathClear !== null && f.pathClear !== undefined) {
    const clear = Math.round(f.pathClear * 100);
    if (f.pathClear < 0.45) {
      notes.push({ code: 'pathBlocked', sentiment: 'bad', icon: 'cloud-fog', params: { clear } });
    } else if (f.pathClear < 0.8) {
      notes.push({ code: 'pathPartial', sentiment: 'neutral', icon: 'compass', params: { clear } });
    } else if (f.drama >= 0.4) {
      // Via libera + nuvole "sceniche" locali: il deck può accendersi da sotto.
      notes.push({ code: 'pathClear', sentiment: 'good', icon: 'sunset', params: { clear } });
    }
  }

  // Umidità
  if (f.humidityPenalty >= 0.6) {
    notes.push({ code: 'humidHigh', sentiment: 'bad', icon: 'droplet', params: { humidity: Math.round(f.humidity) } });
  } else if (f.humidityPenalty <= 0.1) {
    notes.push({ code: 'humidDry', sentiment: 'good', icon: 'wind', params: { humidity: Math.round(f.humidity) } });
  }

  return notes;
}

/**
 * Leve controfattuali: quanto salirebbe il punteggio se, DA SOLO, un
 * ingrediente mancante fosse ideale. Ogni leva è una patch MONOTONA delle
 * condizioni (min/max: mai suggerire un peggioramento; input già ideali →
 * guadagno 0 → filtrata). I guadagni sono indipendenti e NON si sommano.
 * Niente leva sulle nuvole medie: al 45% alzano il drama ma toccano anche
 * l'overcast (segno ambiguo) e il messaggio sarebbe confuso.
 *
 * @param {SunsetConditions} c
 * @returns {Array<{code:string, gain:number, target:number}>} per guadagno
 *          decrescente, solo guadagni ≥ 5 punti, al massimo 3 voci
 */
export function scoreUpside(c) {
  const base = computeSunsetScore(c).score;

  const levers = [
    { code: 'cirrus', patch: { cloudCoverHigh: 50 } },
    { code: 'horizon', patch: { cloudCoverLow: 0 } },
    {
      code: 'clearAir',
      patch: {
        visibility: Math.max(c.visibility ?? 24000, 24000),
        humidity: Math.min(c.humidity ?? 50, 60),
      },
    },
    ...(c.aerosol != null || c.pm25 != null
      ? [
          {
            code: 'haze',
            patch: {
              aerosol: c.aerosol != null ? Math.min(c.aerosol, 0.2) : null,
              pm25: c.pm25 != null ? Math.min(c.pm25, 10) : null,
            },
          },
        ]
      : []),
    ...(c.pathClear != null ? [{ code: 'path', patch: { pathClear: 1 } }] : []),
  ];

  return levers
    .map(({ code, patch }) => {
      const target = computeSunsetScore({ ...c, ...patch }).score;
      return { code, gain: target - base, target };
    })
    .filter((l) => l.gain >= 5)
    .sort((a, b) => b.gain - a.gain) // sort stabile: pari → ordine di dichiarazione
    .slice(0, 3);
}
