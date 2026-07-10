const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export function julianDay(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

/**
 * @returns {{azimuth:number, elevation:number}}
 */
export function sunPosition(date, latitude, longitude) {
  const jd = julianDay(date);
  const n = jd - 2451545.0;

  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * DEG;

  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;

  const epsilon = (23.439 - 0.0000004 * n) * DEG;

  const alpha = Math.atan2(
    Math.cos(epsilon) * Math.sin(lambda),
    Math.cos(lambda),
  );
  const delta = Math.asin(Math.sin(epsilon) * Math.sin(lambda));

  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const lst = ((gmst * 15 + longitude) % 360) * DEG;
  let ha = lst - alpha;
  while (ha < -Math.PI) ha += 2 * Math.PI;
  while (ha > Math.PI) ha -= 2 * Math.PI;

  const lat = latitude * DEG;

  const elevation = Math.asin(
    Math.sin(lat) * Math.sin(delta) +
      Math.cos(lat) * Math.cos(delta) * Math.cos(ha),
  );

  let azimuth = Math.atan2(
    -Math.sin(ha),
    Math.tan(delta) * Math.cos(lat) - Math.sin(lat) * Math.cos(ha),
  );
  azimuth = (azimuth * RAD + 360) % 360;

  return { azimuth, elevation: elevation * RAD };
}

export function azimuthToCardinal(azimuth) {
  const dirs = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
  return dirs[Math.round(azimuth / 45) % 8];
}

export function moonPhase(date) {
  const synodic = 29.53058867;
  const knownNewMoon = 2451550.1;
  const jd = julianDay(date);
  const phase = ((jd - knownNewMoon) % synodic) / synodic;
  return phase < 0 ? phase + 1 : phase;
}

/** Illuminated fraction of the moon disc (0..1) from the phase fraction (0..1). */
export function moonIllumination(phase) {
  return (1 - Math.cos(2 * Math.PI * phase)) / 2;
}

export function moonPhaseName(phase) {
  const codes = [
    "new",
    "waxingCrescent",
    "firstQuarter",
    "waxingGibbous",
    "full",
    "waningGibbous",
    "lastQuarter",
    "waningCrescent",
  ];
  return codes[Math.round(phase * 8) % 8];
}

/**
 * @returns {{descending:boolean, golden:?Date, event:?Date, blue:?Date}}
 */
export function twilightTimes(eventDate, latitude, longitude) {
  const stepMs = 60 * 1000;
  const windowMs = 2.5 * 3600 * 1000;
  const base = eventDate.getTime();
  const samples = [];
  for (let t = base - windowMs; t <= base + windowMs; t += stepMs) {
    samples.push({
      t,
      el: sunPosition(new Date(t), latitude, longitude).elevation,
    });
  }
  const mid = Math.floor(samples.length / 2);
  const descending = samples[mid].el <= samples[mid - 1].el;

  const crossing = (target) => {
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1].el;
      const b = samples[i].el;
      if (a !== b && (a - target) * (b - target) <= 0) {
        const f = (target - a) / (b - a);
        return new Date(samples[i - 1].t + f * stepMs);
      }
    }
    return null;
  };

  return {
    descending,
    golden: crossing(6),
    event: crossing(-0.833),
    blue: crossing(-6),
  };
}
