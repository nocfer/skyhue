// score.js — algoritmo del Sunset Score e generazione della spiegazione.
// Funzioni pure, indipendenti dal DOM e dalla rete: sono il cuore testabile
// dell'applicazione.

/** Limita un valore all'intervallo [min, max]. */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Ricompensa "a campana" (gaussiana): 1 quando x è vicino al valore ideale,
 * decresce dolcemente allontanandosi. Usata per le nuvole alte e medie, che
 * danno il meglio con una copertura parziale.
 */
export function bellReward(x, ideal, width) {
  const z = (x - ideal) / width;
  return Math.exp(-(z * z));
}

/**
 * Condizioni meteo/astronomiche all'ora del tramonto.
 * @typedef {Object} SunsetConditions
 * @property {number} cloudCover       copertura nuvolosa totale (%)
 * @property {number} cloudCoverLow    nuvole basse (%)
 * @property {number} cloudCoverMid    nuvole medie (%)
 * @property {number} cloudCoverHigh   nuvole alte (%)
 * @property {number} visibility       visibilità (metri)
 * @property {number} humidity         umidità relativa (%)
 * @property {number} [aerosol]        aerosol optical depth (adimensionale, opz.)
 * @property {number} [pm25]           particolato PM2.5 (µg/m³, opz.)
 */

// Pesi dei fattori compositi (documentati per rendere l'algoritmo trasparente).
export const WEIGHTS = {
  base: 0.35, // un cielo terso "vale" comunque qualcosa
  drama: 0.45, // nuvole alte/medie che catturano il colore
  clarity: 0.2, // trasparenza dell'atmosfera
};

/**
 * Calcola il Sunset Score (0-100) a partire dalle condizioni.
 * Restituisce anche i fattori intermedi, utili per la spiegazione.
 *
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

  // Le nuvole alte (cirri) sono l'ingrediente principale: rendono al meglio
  // con copertura parziale. Le medie contribuiscono in modo simile.
  const highReward = bellReward(high, 50, 30);
  const midReward = bellReward(mid, 45, 30);
  const drama = 0.6 * highReward + 0.4 * midReward; // 0..1

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

  const raw =
    100 * (WEIGHTS.base + WEIGHTS.drama * drama + WEIGHTS.clarity * clarity);

  const score = clamp(
    raw * (1 - 0.85 * lowBlock) * (1 - 0.9 * overcast) * aerosolMult,
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

  // Umidità
  if (f.humidityPenalty >= 0.6) {
    notes.push({ code: 'humidHigh', sentiment: 'bad', icon: 'droplet', params: { humidity: Math.round(f.humidity) } });
  } else if (f.humidityPenalty <= 0.1) {
    notes.push({ code: 'humidDry', sentiment: 'good', icon: 'wind', params: { humidity: Math.round(f.humidity) } });
  }

  return notes;
}
