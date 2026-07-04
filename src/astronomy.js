// astronomy.js — calcolo della posizione solare (algoritmo NOAA) e fasi crepuscolari.
// Tutte le funzioni sono pure: nessuna dipendenza esterna, testabili in isolamento.

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/**
 * Giorno giuliano da una data JavaScript (UTC).
 */
export function julianDay(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

/**
 * Posizione del Sole (azimut ed elevazione, in gradi) per un dato istante e
 * coordinate geografiche. Basato sugli algoritmi solari NOAA.
 *
 * @returns {{azimuth:number, elevation:number}}
 *   azimuth: 0 = Nord, 90 = Est, 180 = Sud, 270 = Ovest
 *   elevation: gradi sopra (+) o sotto (-) l'orizzonte
 */
export function sunPosition(date, latitude, longitude) {
  const jd = julianDay(date);
  const n = jd - 2451545.0; // giorni dall'epoca J2000.0

  // Longitudine media e anomalia media del Sole
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * DEG;

  // Longitudine eclittica
  const lambda =
    (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG;

  // Obliquità dell'eclittica
  const epsilon = (23.439 - 0.0000004 * n) * DEG;

  // Ascensione retta e declinazione
  const alpha = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));
  const delta = Math.asin(Math.sin(epsilon) * Math.sin(lambda));

  // Tempo siderale di Greenwich (approssimato)
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const lst = ((gmst * 15 + longitude) % 360) * DEG;

  // Angolo orario
  let ha = lst - alpha;
  while (ha < -Math.PI) ha += 2 * Math.PI;
  while (ha > Math.PI) ha -= 2 * Math.PI;

  const lat = latitude * DEG;

  const elevation = Math.asin(
    Math.sin(lat) * Math.sin(delta) + Math.cos(lat) * Math.cos(delta) * Math.cos(ha)
  );

  let azimuth = Math.atan2(
    -Math.sin(ha),
    Math.tan(delta) * Math.cos(lat) - Math.sin(lat) * Math.cos(ha)
  );
  azimuth = (azimuth * RAD + 360) % 360;

  return { azimuth, elevation: elevation * RAD };
}

/**
 * Converte un azimut (gradi) nella direzione cardinale corrispondente.
 */
export function azimuthToCardinal(azimuth) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  return dirs[Math.round(azimuth / 45) % 8];
}

/**
 * Fase lunare (0 = luna nuova, 0.5 = piena, 1 = luna nuova) per una data.
 * Approssimazione basata sul ciclo sinodico medio.
 */
export function moonPhase(date) {
  const synodic = 29.53058867;
  const knownNewMoon = 2451550.1; // 6 gennaio 2000, luna nuova
  const jd = julianDay(date);
  const phase = ((jd - knownNewMoon) % synodic) / synodic;
  return phase < 0 ? phase + 1 : phase;
}

export function moonPhaseName(phase) {
  const names = [
    'Luna nuova',
    'Luna crescente',
    'Primo quarto',
    'Gibbosa crescente',
    'Luna piena',
    'Gibbosa calante',
    'Ultimo quarto',
    'Luna calante',
  ];
  return names[Math.round(phase * 8) % 8];
}
