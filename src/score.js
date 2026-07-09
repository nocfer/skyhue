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
  if (valid.length < 2) return null; // partial data → neutral, not a false signal

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
  base: 0.35, // a clear sky is still "worth" something
  drama: 0.45, // high/mid clouds that catch the color
  clarity: 0.2, // transparency of the atmosphere
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

  // Atmospheric transparency: high visibility + low humidity = vivid colors.
  const visFactor = clamp(visibility / 24000, 0, 1); // 24 km = excellent
  const humidityPenalty = clamp((humidity - 60) / 40, 0, 1);
  const clarity = clamp(0.7 * visFactor + 0.3 * (1 - humidityPenalty), 0, 1);

  // Low clouds block the sun at the horizon: multiplicative penalty.
  const lowBlock = clamp(low / 70, 0, 1); // ~70% low clouds = closed horizon
  // "Overcast": the sky lets little direct light through. Only the OPAQUE
  // deck counts (low + mid clouds): high cirrus, even dense, stays translucent
  // and lets the grazing light filter through — using it for overcast would
  // penalize precisely the best scenario (a sky full of lit-up cirrus). We
  // estimate the combined low/mid cover as a union with independent overlap.
  const opaqueDeck = clamp(low + mid - (low * mid) / 100, 0, 100);
  const overcast = clamp((opaqueDeck - 70) / 30, 0, 1);

  // Aerosol: moderate dust (AOD ~0.2) fires up the reds by scattering the
  // light; too much (haze/particulates) mutes the colors. Optional: if absent
  // it doesn't change the score (backwards compatible).
  const aod = c.aerosol ?? null;
  const pm25 = c.pm25 ?? null;
  let aerosolEnhance = 0;
  let aerosolHaze = 0;
  let aerosolMult = 1;
  if (aod !== null) {
    aerosolEnhance = bellReward(aod, 0.2, 0.18); // peaks around 0.2
    aerosolHaze = clamp((aod - 0.45) / 0.55, 0, 1); // haze beyond ~0.45
    aerosolMult *= 1 + 0.1 * aerosolEnhance - 0.3 * aerosolHaze;
  }
  if (pm25 !== null) {
    const pmHaze = clamp((pm25 - 35) / 65, 0, 1); // >35 µg/m³ starts to veil
    aerosolHaze = Math.max(aerosolHaze, pmHaze);
    aerosolMult *= 1 - 0.25 * pmHaze;
  }

  // Light path: how clear the FAR atmosphere is towards the sun
  // (see lightPathFactor). A wall of clouds 40-250 km away kills the grazing
  // light before it arrives. K=0.45: more than haze (0.3), less than the local
  // lowBlock (0.85) — the forecast at those distances has less skill and the
  // baseline twilight light survives. Optional: absent → score unchanged.
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
 * Qualitative code for a score (resolved to text by the UI via i18n).
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
 * Generates the explanatory notes from the score factors, in a language-
 * NEUTRAL form: each entry has { code, sentiment, icon, params }. The text
 * (title + detail) is resolved by the UI via i18n with the `explain.<code>` key.
 *
 * @param {ReturnType<typeof computeSunsetScore>['factors']} f
 * @returns {Array<{code:string, sentiment:string, icon:string, params:Object}>}
 */
export function explainScore(f) {
  const notes = [];
  const visKm = Math.round(f.visibility / 1000);

  // High clouds
  if (f.high >= 20 && f.high <= 75) {
    notes.push({ code: 'highGood', sentiment: 'good', icon: 'cloud', params: { high: Math.round(f.high) } });
  } else if (f.high > 75) {
    notes.push({ code: 'highMuch', sentiment: 'neutral', icon: 'cloud', params: { high: Math.round(f.high) } });
  } else {
    notes.push({ code: 'highFew', sentiment: 'neutral', icon: 'cloud-sun', params: {} });
  }

  // Mid clouds
  if (f.mid >= 20 && f.mid <= 65) {
    notes.push({ code: 'midGood', sentiment: 'good', icon: 'cloud-sun', params: { mid: Math.round(f.mid) } });
  }

  // Low clouds (critical factor)
  if (f.low >= 40) {
    notes.push({ code: 'lowBad', sentiment: 'bad', icon: 'haze', params: { low: Math.round(f.low) } });
  } else if (f.low >= 15) {
    notes.push({ code: 'lowSome', sentiment: 'neutral', icon: 'haze', params: { low: Math.round(f.low) } });
  } else {
    notes.push({ code: 'lowClear', sentiment: 'good', icon: 'sunset', params: {} });
  }

  // Total cover
  if (f.overcast > 0.5) {
    notes.push({ code: 'overcast', sentiment: 'bad', icon: 'cloud', params: { total: Math.round(f.total) } });
  }

  // Visibility
  if (f.visFactor >= 0.85) {
    notes.push({ code: 'visGood', sentiment: 'good', icon: 'eye', params: { visKm } });
  } else if (f.visFactor < 0.4) {
    notes.push({ code: 'visBad', sentiment: 'bad', icon: 'cloud-fog', params: { visKm } });
  }

  // Aerosol / particulates
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

  // Light path (only if the far samples are available)
  if (f.pathClear !== null && f.pathClear !== undefined) {
    const clear = Math.round(f.pathClear * 100);
    if (f.pathClear < 0.45) {
      notes.push({ code: 'pathBlocked', sentiment: 'bad', icon: 'cloud-fog', params: { clear } });
    } else if (f.pathClear < 0.8) {
      notes.push({ code: 'pathPartial', sentiment: 'neutral', icon: 'compass', params: { clear } });
    } else if (f.drama >= 0.4) {
      // Clear path + local "scenic" clouds: the deck can light up from below.
      notes.push({ code: 'pathClear', sentiment: 'good', icon: 'sunset', params: { clear } });
    }
  }

  // Humidity
  if (f.humidityPenalty >= 0.6) {
    notes.push({ code: 'humidHigh', sentiment: 'bad', icon: 'droplet', params: { humidity: Math.round(f.humidity) } });
  } else if (f.humidityPenalty <= 0.1) {
    notes.push({ code: 'humidDry', sentiment: 'good', icon: 'wind', params: { humidity: Math.round(f.humidity) } });
  }

  return notes;
}

/**
 * Counterfactual levers: how much the score would rise if, ON ITS OWN, one
 * missing ingredient were ideal. Each lever is a MONOTONE patch of the
 * conditions (min/max: never suggest a worsening; already-ideal inputs →
 * zero gain → filtered out). Gains are independent and do NOT add up.
 * No lever on mid clouds: at 45% they raise drama but also touch the
 * overcast (ambiguous sign) and the message would be confusing.
 *
 * @param {SunsetConditions} c
 * @returns {Array<{code:string, gain:number, target:number}>} by decreasing
 *          gain, only gains ≥ 5 points, at most 3 entries
 */
// Counterfactual levers as monotone condition patches (min/max: never suggest
// a worsening; already-ideal inputs yield zero gain and get filtered out).
function upsideLevers(c) {
  return [
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
}

export function scoreUpside(c) {
  const base = computeSunsetScore(c).score;

  return upsideLevers(c)
    .map(({ code, patch }) => {
      const target = computeSunsetScore({ ...c, ...patch }).score;
      return { code, gain: target - base, target };
    })
    .filter((l) => l.gain >= 5)
    .sort((a, b) => b.gain - a.gain) // stable sort: ties keep declaration order
    .slice(0, 3);
}

/**
 * Counterfactual ceiling: the score with ALL upside levers applied together.
 * Because the score is a product of factors, this sits well above the sum of
 * the single-lever gains. It is not 100 by construction: the absolute maximum
 * also needs a ~45% mid-cloud veil, which we deliberately don't suggest.
 *
 * @param {SunsetConditions} c
 * @returns {number}
 */
export function scoreCeiling(c) {
  const patch = Object.assign({}, ...upsideLevers(c).map((l) => l.patch));
  return computeSunsetScore({ ...c, ...patch }).score;
}
