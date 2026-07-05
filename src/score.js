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

/** Etichetta qualitativa per un punteggio. */
export function scoreLabel(score) {
  if (score >= 85) return 'Eccezionale';
  if (score >= 70) return 'Ottimo';
  if (score >= 55) return 'Buono';
  if (score >= 40) return 'Discreto';
  if (score >= 20) return 'Mediocre';
  return 'Scarso';
}

/**
 * Genera una lista di spiegazioni leggibili dai fattori del punteggio.
 * Ogni voce ha: sentiment ('good'|'neutral'|'bad'), titolo e dettaglio.
 *
 * @param {ReturnType<typeof computeSunsetScore>['factors']} f
 * @returns {Array<{sentiment:string, icon:string, title:string, detail:string}>}
 */
export function explainScore(f) {
  const notes = [];

  // Nuvole alte
  if (f.high >= 20 && f.high <= 75) {
    notes.push({
      sentiment: 'good',
      icon: 'cloud',
      title: 'Nuvole alte favorevoli',
      detail: `Cirri al ${Math.round(f.high)}%: catturano e diffondono la luce radente all’orizzonte.`,
    });
  } else if (f.high > 75) {
    notes.push({
      sentiment: 'neutral',
      icon: 'cloud',
      title: 'Molte nuvole alte',
      detail: `Copertura alta al ${Math.round(f.high)}%: cielo forse troppo velato.`,
    });
  } else {
    notes.push({
      sentiment: 'neutral',
      icon: 'cloud-sun',
      title: 'Poche nuvole alte',
      detail: 'Mancano i cirri che accendono il cielo: tramonto più sobrio.',
    });
  }

  // Nuvole medie
  if (f.mid >= 20 && f.mid <= 65) {
    notes.push({
      sentiment: 'good',
      icon: 'cloud-sun',
      title: 'Nuvole medie ben distribuite',
      detail: `Strato medio al ${Math.round(f.mid)}%: aggiunge profondità e sfumature.`,
    });
  }

  // Nuvole basse (fattore critico)
  if (f.low >= 40) {
    notes.push({
      sentiment: 'bad',
      icon: 'haze',
      title: 'Nuvole basse all’orizzonte',
      detail: `Copertura bassa al ${Math.round(f.low)}%: rischia di bloccare il sole sull’orizzonte.`,
    });
  } else if (f.low >= 15) {
    notes.push({
      sentiment: 'neutral',
      icon: 'haze',
      title: 'Qualche nuvola bassa',
      detail: `Nuvole basse al ${Math.round(f.low)}%: orizzonte parzialmente disturbato.`,
    });
  } else {
    notes.push({
      sentiment: 'good',
      icon: 'sunset',
      title: 'Orizzonte libero',
      detail: 'Poche nuvole basse: il sole raggiungerà l’orizzonte senza ostacoli.',
    });
  }

  // Copertura totale
  if (f.overcast > 0.5) {
    notes.push({
      sentiment: 'bad',
      icon: 'cloud',
      title: 'Cielo coperto',
      detail: `Copertura totale al ${Math.round(f.total)}%: poca luce diretta.`,
    });
  }

  // Visibilità
  if (f.visFactor >= 0.85) {
    notes.push({
      sentiment: 'good',
      icon: 'eye',
      title: 'Visibilità eccellente',
      detail: `Atmosfera limpida (${(f.visibility / 1000).toFixed(0)} km): colori nitidi e saturi.`,
    });
  } else if (f.visFactor < 0.4) {
    notes.push({
      sentiment: 'bad',
      icon: 'cloud-fog',
      title: 'Visibilità ridotta',
      detail: `Solo ${(f.visibility / 1000).toFixed(0)} km di visibilità: foschia o particolato nell’aria.`,
    });
  }

  // Aerosol / particolato
  if (f.aerosol !== null && f.aerosol !== undefined) {
    if (f.aerosolHaze >= 0.5) {
      notes.push({
        sentiment: 'bad',
        icon: 'haze',
        title: 'Foschia da particolato',
        detail: `Aerosol elevato${
          f.pm25 != null ? ` (PM2.5 ${Math.round(f.pm25)} µg/m³)` : ''
        }: la luce si disperde e i colori si attenuano.`,
      });
    } else if (f.aerosolEnhance >= 0.6) {
      notes.push({
        sentiment: 'good',
        icon: 'flame',
        title: 'Aerosol favorevoli',
        detail: 'Un pulviscolo moderato nell’atmosfera tende ad accendere i rossi e gli arancioni.',
      });
    }
  }

  // Umidità
  if (f.humidityPenalty >= 0.6) {
    notes.push({
      sentiment: 'bad',
      icon: 'droplet',
      title: 'Umidità elevata',
      detail: `Umidità al ${Math.round(f.humidity)}%: colori più smorzati.`,
    });
  } else if (f.humidityPenalty <= 0.1) {
    notes.push({
      sentiment: 'good',
      icon: 'wind',
      title: 'Aria secca',
      detail: `Umidità al ${Math.round(f.humidity)}%: favorisce colori intensi.`,
    });
  }

  return notes;
}
