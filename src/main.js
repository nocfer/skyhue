// main.js — orchestrazione: geolocalizzazione/ricerca → previsioni → punteggio → UI.
import {
  geocode,
  fetchForecast,
  fetchAirQuality,
  airAtTime,
  conditionsAtTime,
  conditionsWindow,
  nextSunset,
  dailyList,
  coordsLabel,
} from './api.js';
import { computeSunsetScore, scoreLabel, explainScore } from './score.js';
import {
  sunPosition,
  azimuthToCardinal,
  moonPhase,
  moonPhaseName,
  twilightTimes,
} from './astronomy.js';
import { getFavorites, isFavorite, toggleFavorite, removeFavorite } from './store.js';
import { skyGradient, skyGradientCss } from './sky.js';
import { icon } from './icons.js';
import { mountMiniMap } from './map.js';
import { t, cardinal, initLang, getLang, setLang, applyStaticI18n } from './i18n.js';
import {
  fetchSunsetSpots,
  distanceKm,
  bearing,
  kindInfo,
  destinationPoint,
  SAMPLE_DISTANCES,
  evaluateHorizon,
  spotVerdict,
  fetchElevations,
  angleDiff,
  driveMinutes,
  gridCandidates,
  prescoreGrid,
  horizonDistanceKm,
  reverseGeocode,
} from './spots.js';

const els = {
  form: document.getElementById('search-form'),
  input: document.getElementById('search-input'),
  geoBtn: document.getElementById('geo-btn'),
  results: document.getElementById('results'),
  status: document.getElementById('status'),
  favorites: document.getElementById('favorites'),
};

// Stato corrente: località e previsione caricate, giorno ed evento selezionati.
const state = {
  place: null,
  forecast: null,
  air: null, // dati qualità dell'aria (può restare null se il fetch fallisce)
  dayIndex: 0,
  event: 'sunset', // 'sunset' | 'sunrise'
  spots: null, // punti panoramici valutati: null=caricamento, []=nessuno, Array=trovati
  spotsError: false,
  rawSpots: null, // cache dei punti grezzi da OSM (indipendenti dall'evento)
  rawSpotsFor: null, // riferimento alla località per cui rawSpots è valida
  estimatedSpots: null, // punti "da coordinate" (griglia), su richiesta
  estimating: false,
  estimateError: false,
};

// Quanti punti valutare (per limitare la chiamata batch sulle quote) e mostrare.
// Con raggio ampio (~25 km) selezioniamo i candidati privilegiando la direzione
// del tramonto, così le performance restano sotto controllo.
const SPOTS_EVALUATE = 14;
const SPOTS_SHOW = 6;
const SPOTS_SKY = 3; // per quanti finalisti calcolare il punteggio-cielo nel punto
const NEAR_KM = 6; // entro questo raggio teniamo tutti i punti, a prescindere dalla direzione

/** Nome localizzato dell'evento ('Tramonto'/'Sunset' ecc.). */
function eventNoun(ev) {
  return t('event.' + ev);
}

function setStatus(msg, kind = 'info') {
  els.status.textContent = msg || '';
  els.status.dataset.kind = kind;
}

/** Scarica i dati per una località e mostra il risultato. */
async function analyze(place) {
  setStatus(t('status.fetching', { label: place.label }), 'info');
  els.results.innerHTML = '';
  try {
    // Meteo e qualità dell'aria in parallelo; l'aria è opzionale e non blocca.
    const [forecast, air] = await Promise.all([
      fetchForecast(place.latitude, place.longitude),
      fetchAirQuality(place.latitude, place.longitude).catch(() => null),
    ]);
    const { dayIndex } = nextSunset(forecast, new Date());
    state.place = place;
    window.skyhueLastPlace = { latitude: place.latitude, longitude: place.longitude };
    state.forecast = forecast;
    state.air = air;
    state.dayIndex = dayIndex;
    state.spots = null;
    state.spotsError = false;
    state.estimatedSpots = null;
    state.estimating = false;
    state.estimateError = false;
    render();
    setStatus('', 'info');
    loadSpots(place); // in background: non blocca la vista principale
  } catch (err) {
    console.error(err);
    setStatus(t('status.error', { msg: err.message }), 'error');
  }
}

/** Carica in background i punti panoramici (OSM) e ne valuta l'affaccio. */
async function loadSpots(place) {
  try {
    const raw = await fetchSunsetSpots(place.latitude, place.longitude);
    if (state.place !== place) return; // l'utente ha cambiato località nel frattempo
    state.rawSpots = raw;
    state.rawSpotsFor = place;
    await evaluateSpots();
  } catch (err) {
    console.warn('Punti panoramici non disponibili:', err);
    if (state.place !== place) return;
    state.spotsError = true;
    render();
  }
}

/** Azimut del sole per l'evento e il giorno correntemente selezionati. */
function currentAzimuth() {
  const { forecast, place, event, dayIndex } = state;
  const iso = dailyList(forecast)[dayIndex][event];
  return sunPosition(new Date(iso), place.latitude, place.longitude).azimuth;
}

/**
 * Valuta l'affaccio dei punti grezzi verso il sole (ostruzioni + mare aperto),
 * usando le quote del terreno campionate lungo l'azimut. Riusa rawSpots, così
 * cambiando alba/tramonto ricalcola senza re-interrogare OSM.
 */
async function evaluateSpots() {
  const place = state.place;
  const raw = state.rawSpots;
  if (!raw) return;
  if (raw.length === 0) {
    state.spots = [];
    render();
    return;
  }

  const azimuth = currentAzimuth();

  // Pre-selezione ottimizzata per direzione: entro NEAR_KM teniamo tutto; oltre,
  // paghiamo un "costo" maggiore se il punto non è verso il tramonto. Così, pur
  // con raggio ampio, valutiamo (parte costosa: le quote) solo i più promettenti.
  const nearest = raw
    .map((s) => {
      const dist = distanceKm(place.latitude, place.longitude, s.lat, s.lon);
      const dirDiff = angleDiff(bearing(place.latitude, place.longitude, s.lat, s.lon), azimuth);
      const offSunset = dist > NEAR_KM && dirDiff > 90 ? 2 : 1; // penalizza i lontani "dal lato sbagliato"
      return { ...s, dist, dirDiff, cost: dist * offSunset };
    })
    .sort((a, b) => a.cost - b.cost)
    .slice(0, SPOTS_EVALUATE);

  const evaluated = await refineCandidates(nearest, azimuth, place);
  if (state.place !== place) return;

  // Ordina per punteggio finale (affaccio − distanza), poi per vicinanza.
  evaluated.sort((a, b) => b.finalScore - a.finalScore || a.dist - b.dist);
  state.spots = evaluated;
  render();

  // In background: calcola il punteggio-cielo direttamente nei punti finalisti.
  loadSky(state.spots, place);
}

/**
 * Rifinitura condivisa: per ogni candidato campiona il terreno lungo il raggio
 * verso il sole, valuta l'affaccio e calcola verdetto + punteggio finale.
 * Usata sia dai punti OSM sia dalla stima da coordinate.
 */
async function refineCandidates(candidates, azimuth, place) {
  const points = [];
  for (const s of candidates) {
    for (const d of SAMPLE_DISTANCES) {
      points.push(d === 0 ? { lat: s.lat, lon: s.lon } : destinationPoint(s.lat, s.lon, azimuth, d));
    }
  }
  let elevations = null;
  try {
    elevations = await fetchElevations(points);
  } catch (err) {
    console.warn('Quote non disponibili, salto la valutazione affaccio:', err);
  }
  const n = SAMPLE_DISTANCES.length;
  return candidates.map((s, i) => {
    let horizon = null;
    let elev = null;
    if (elevations && elevations.length >= (i + 1) * n) {
      elev = elevations[i * n];
      const ahead = SAMPLE_DISTANCES.slice(1).map((distKm, k) => ({
        distKm,
        elev: elevations[i * n + 1 + k],
      }));
      horizon = evaluateHorizon(elev, ahead);
    }
    const verdict = spotVerdict(s.kind, horizon);
    const dist = s.dist ?? distanceKm(place.latitude, place.longitude, s.lat, s.lon);
    const finalScore = verdict.score - Math.max(0, dist - NEAR_KM) * 0.4;
    return {
      ...s,
      dist,
      elev,
      dir: azimuthToCardinal(bearing(place.latitude, place.longitude, s.lat, s.lon)),
      driveMin: driveMinutes(dist),
      verdict,
      finalScore,
    };
  });
}

/**
 * Ricerca "da coordinate" (su richiesta): genera una griglia di punti, pre-
 * seleziona quelli su terra vicino alla costa dalle sole quote, poi rifinisce
 * i migliori con la stessa valutazione d'affaccio dei punti mappati.
 */
async function scanCoordinates() {
  const place = state.place;
  if (!place || state.estimating) return;
  state.estimating = true;
  state.estimateError = false;
  render();
  try {
    const azimuth = currentAzimuth();
    const radius = 20;
    const perSide = 9;
    const grid = gridCandidates(place.latitude, place.longitude, radius, perSide);
    const gelev = await fetchElevations(grid);
    if (state.place !== place) return;
    const step = (2 * radius) / (perSide - 1);
    const candidates = prescoreGrid(grid, gelev, step)
      .filter((p) => p.prescore > -Infinity)
      .sort((a, b) => b.prescore - a.prescore)
      .slice(0, SPOTS_EVALUATE)
      .map((p) => ({ lat: p.lat, lon: p.lon, kind: 'estimate', name: null }));
    const evaluated = await refineCandidates(candidates, azimuth, place);
    if (state.place !== place) return;
    evaluated.sort((a, b) => b.finalScore - a.finalScore || a.dist - b.dist);
    state.estimatedSpots = evaluated.slice(0, SPOTS_SHOW);
    state.estimating = false;
    render();
    loadSky(state.estimatedSpots, place);
    nameEstimatedSpots(state.estimatedSpots, place);
  } catch (err) {
    console.warn('Scansione da coordinate non riuscita:', err);
    if (state.place !== place) return;
    state.estimating = false;
    state.estimateError = true;
    render();
  }
}

/**
 * Per i primi finalisti di una lista scarica il meteo nel punto e ne calcola il
 * Sunset Score, così ogni meta mostra sia l'affaccio sia la qualità del cielo.
 */
/**
 * Dà un nome ai primi punti stimati via reverse-geocoding (Nominatim), in modo
 * sequenziale per rispettare il rate-limit. Aggiorna il nome e ridisegna.
 */
async function nameEstimatedSpots(spots, place) {
  const top = (spots || []).filter((s) => s.kind === 'estimate').slice(0, 3);
  for (const s of top) {
    try {
      const name = await reverseGeocode(s.lat, s.lon, getLang());
      if (name) s.name = name;
    } catch (err) {
      /* resta "Punto stimato" */
    }
  }
  if (state.place !== place) return;
  render();
}

async function loadSky(list, place) {
  const top = (list || []).slice(0, SPOTS_SKY);
  if (!top.length) return;
  const scores = await Promise.all(
    top.map(async (s) => {
      try {
        const f = await fetchForecast(s.lat, s.lon);
        const day = dailyList(f)[state.dayIndex] ?? dailyList(f)[0];
        const iso = day[state.event];
        const cond = { ...conditionsAtTime(f, iso), ...airAtTime(state.air, iso) };
        return computeSunsetScore(cond).score;
      } catch (err) {
        console.warn('Punteggio-cielo del punto non disponibile:', err);
        return null;
      }
    })
  );
  if (state.place !== place) return;
  top.forEach((s, i) => {
    s.skyScore = scores[i];
  });

  // Integra i colori previsti nel ranking: un punto con affaccio ottimo ma
  // cielo mediocre non deve restare in cima solo per la vista. Per i finalisti
  // di cui conosciamo il cielo usiamo un punteggio combinato (affaccio pesa più
  // del cielo, che sull'area è quasi uniforme, meno la penalità distanza);
  // gli altri mantengono il finalScore, su scala comparabile.
  top.forEach((s) => {
    if (s.skyScore == null) return;
    const distPenalty = Math.max(0, s.dist - NEAR_KM) * 0.4;
    s.overallScore = 0.6 * s.verdict.score + 0.4 * s.skyScore - distPenalty;
  });
  list.sort(
    (a, b) =>
      (b.overallScore ?? b.finalScore) - (a.overallScore ?? a.finalScore) ||
      a.dist - b.dist
  );
  render();
}

/** Calcola punteggio + spiegazione per l'evento (alba/tramonto) di un giorno. */
function evaluateDay(dayIndex) {
  const { forecast, place, event } = state;
  const day = dailyList(forecast)[dayIndex];
  const eventIso = day[event];
  const cond = { ...conditionsAtTime(forecast, eventIso), ...airAtTime(state.air, eventIso) };
  const { score, factors } = computeSunsetScore(cond);
  const notes = explainScore(factors);
  const eventDate = new Date(eventIso);
  const sun = sunPosition(eventDate, place.latitude, place.longitude);
  const phase = moonPhase(eventDate);

  // Timeline: evoluzione delle condizioni del cielo nelle ore attorno all'evento.
  const timeline = conditionsWindow(forecast, eventIso, 2, 2).map((c) => ({
    time: new Date(c.time),
    score: computeSunsetScore({ ...c, ...airAtTime(state.air, c.time) }).score,
    isCenter: c.isCenter,
  }));

  return { day, eventDate, cond, score, factors, notes, sun, phase, timeline };
}

function locale() {
  return getLang() === 'en' ? 'en-GB' : 'it-IT';
}

function fmtTime(date) {
  return date.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
}

function fmtDay(date) {
  return date.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
}

function fmtWeekdayShort(date) {
  return date.toLocaleDateString(locale(), { weekday: 'short' });
}

/** Tinta del punteggio: rampa calda e monocromatica, in tinta col tramonto.
 *  Rosso-brace (basso, ~10°) → arancio → oro (alto, ~46°). Niente verde. */
function scoreHue(score) {
  return Math.round(10 + (score / 100) * 36);
}

/**
 * Mini-mappa Leaflet del punto analizzato: contenitore vuoto (Leaflet vi viene
 * montato da `mountMiniMap` dopo l'inserimento nel DOM) + chip "Espandi" e
 * pulsante che aprono la mappa grande in-app con tutti i punti marcati.
 */
function mapEmbedHtml() {
  return `
    <div class="map-wrap">
      <div class="map-slot" id="detail-map"></div>
      <span class="map-slot__expand" aria-hidden="true">${icon('maximize', {
        size: 15,
      })} ${t('detail.expand')}</span>
    </div>
    <button type="button" class="map__open" id="open-bigmap">${icon('map', {
      size: 16,
    })} ${t('detail.openMap')}</button>`;
}

/** Riga di un punto suggerito (usata sia per i POI sia per i punti stimati). */
function spotRowHtml(s) {
  const info = kindInfo(s.kind);
  const dist = s.dist < 10 ? s.dist.toFixed(1) : Math.round(s.dist);
  const v = s.verdict;
  const url = `https://www.openstreetmap.org/?mlat=${s.lat.toFixed(5)}&mlon=${s.lon.toFixed(
    5
  )}#map=15/${s.lat.toFixed(4)}/${s.lon.toFixed(4)}`;
  const sky =
    s.skyScore != null
      ? `<span class="spot__sky" style="--hue:${scoreHue(
          s.skyScore
        )}" title="Sunset Score">${icon('sunset', {
          size: 15,
        })} ${t('spot.sky', { n: s.skyScore })}</span>`
      : '';
  const quota = s.kind === 'estimate' && s.elev != null ? ` · ${Math.round(s.elev)} m` : '';
  return `<li class="spot spot--${v.sentiment}">
    <span class="spot__icon">${icon(info.icon, { size: 22 })}</span>
    <div class="spot__body">
      <a href="${url}" target="_blank" rel="noopener">${s.name || t(info.labelKey)}</a>
      <span class="spot__verdict">${icon(v.icon, { size: 15 })} ${t('verdict.' + v.code)} ${sky}</span>
      <span class="spot__meta">${t(info.labelKey)} · ${dist} km · ~${s.driveMin} min · ${cardinal(s.dir)}${quota}</span>
    </div>
    <span class="spot__score" title="${t('spot.viewQuality')}">${v.score}</span>
  </li>`;
}

/** Blocco della stima "da coordinate" (pulsante + eventuale lista). */
function estimateBlockHtml() {
  let list = '';
  if (state.estimateError) {
    list = `<p class="muted">${t('spots.estimateError')}</p>`;
  } else if (state.estimatedSpots && state.estimatedSpots.length) {
    list = `<ul class="spots">${state.estimatedSpots.map(spotRowHtml).join('')}</ul>
      <p class="muted spots__hint">${t('spots.estimateHint')}</p>`;
  } else if (state.estimatedSpots && state.estimatedSpots.length === 0) {
    list = `<p class="muted">${t('spots.estimateNone')}</p>`;
  }
  return `
    <button class="scan-btn" ${state.estimating ? 'disabled' : ''}>
      ${
        state.estimating
          ? t('spots.scanning')
          : `${icon('compass', { size: 16 })} ${t('spots.scan')}`
      }
    </button>
    ${list}`;
}

/** Sezione "Dove andare a guardarlo": punti panoramici vicini. */
function spotsSectionHtml(place, sun) {
  const dirNote = t('spots.dirNote', {
    verb: t(state.event === 'sunset' ? 'verb.sets' : 'verb.rises'),
    dir: cardinal(azimuthToCardinal(sun.azimuth)),
    deg: Math.round(sun.azimuth),
  });

  let body;
  if (state.spotsError) {
    body = `<p class="muted">${t('spots.error')}</p>`;
  } else if (state.spots === null) {
    body = `<p class="muted">${t('spots.loading')}</p>`;
  } else if (state.spots.length === 0) {
    body = `<p class="muted">${t('spots.none')}</p>`;
  } else {
    body = `<ul class="spots">${state.spots.slice(0, SPOTS_SHOW).map(spotRowHtml).join('')}</ul>`;
  }

  return `
    <section>
      <h3>${t('section.spots')}</h3>
      <p class="muted spots__hint">${dirNote}</p>
      ${body}
      <div class="estimate">${estimateBlockHtml()}</div>
    </section>`;
}

/** Bussola SVG con il sole posizionato sull'azimut (0°=N, 90°=E, …). */
function compassSvg(azimuth) {
  const cx = 70;
  const cy = 70;
  const r = 54;
  const rad = (azimuth * Math.PI) / 180;
  const sx = (cx + r * Math.sin(rad)).toFixed(1);
  const sy = (cy - r * Math.cos(rad)).toFixed(1);
  return `
    <svg viewBox="0 0 140 140" class="compass" role="img" aria-label="${t('stat.direction')}">
      <circle cx="70" cy="70" r="54" class="compass__ring" />
      <line x1="70" y1="70" x2="${sx}" y2="${sy}" class="compass__ray" />
      <circle cx="${sx}" cy="${sy}" r="9" class="compass__sun" />
      <circle cx="70" cy="70" r="3" class="compass__center" />
      <text x="70" y="22" class="compass__lbl">N</text>
      <text x="122" y="75" class="compass__lbl">E</text>
      <text x="70" y="132" class="compass__lbl">S</text>
      <text x="18" y="75" class="compass__lbl">O</text>
    </svg>`;
}

/** Ridisegna l'intera vista: striscia dei giorni + dettaglio del giorno scelto. */
function render() {
  const { forecast } = state;
  els.results.innerHTML = '';

  // Punteggi dei prossimi giorni (riusati per striscia e banner).
  const days = dailyList(forecast);
  const scored = days.map((d) => {
    const cond = { ...conditionsAtTime(forecast, d[state.event]), ...airAtTime(state.air, d[state.event]) };
    return { d, score: computeSunsetScore(cond).score, date: new Date(d[state.event]) };
  });

  // --- Avviso "tramonto top in arrivo" ---
  const TOP_THRESHOLD = 85;
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a), scored[0]);
  if (best && best.score >= TOP_THRESHOLD && best.d.dayIndex >= 1) {
    const banner = document.createElement('button');
    banner.className = 'topbanner';
    banner.innerHTML = `${icon('flame', { size: 18 })} <span>${t('banner.top', {
      noun: eventNoun(state.event),
      day: fmtWeekdayShort(best.date),
      score: best.score,
    })}</span>`;
    banner.addEventListener('click', () => {
      state.dayIndex = best.d.dayIndex;
      render();
    });
    els.results.appendChild(banner);
  }

  // --- Striscia multi-giorno ---
  const strip = document.createElement('div');
  strip.className = 'daystrip';
  strip.innerHTML = scored
    .map(({ d, score, date }) => {
      const active = d.dayIndex === state.dayIndex ? ' daychip--active' : '';
      return `
        <button class="daychip${active}" data-day="${d.dayIndex}">
          <span class="daychip__day">${fmtWeekdayShort(date)}</span>
          <span class="daychip__score" style="--hue:${scoreHue(score)}">${score}</span>
          <span class="daychip__time">${fmtTime(date)}</span>
        </button>`;
    })
    .join('');
  els.results.appendChild(strip);

  strip.querySelectorAll('.daychip').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.dayIndex = Number(btn.dataset.day);
      render();
    });
  });

  // --- Dettaglio del giorno selezionato ---
  renderDetail(evaluateDay(state.dayIndex));
}

function renderDetail({ eventDate, cond, score, factors, notes, sun, phase, timeline }) {
  const { place, event } = state;
  const card = document.createElement('article');
  card.className = 'card';

  const skyCss = skyGradientCss(skyGradient(factors, score));

  // Coordinate richieste e cella di griglia effettivamente usata da Open-Meteo.
  const grid = state.forecast;
  const gridNote =
    grid && Number.isFinite(grid.latitude)
      ? t('grid.note', {
          reqLat: place.latitude.toFixed(3),
          reqLon: place.longitude.toFixed(3),
          gLat: grid.latitude.toFixed(3),
          gLon: grid.longitude.toFixed(3),
        })
      : '';

  const timelineHtml = timeline
    .map(
      (c) => `
      <div class="tl__col${c.isCenter ? ' tl__col--center' : ''}">
        <span class="tl__val">${c.score}</span>
        <div class="tl__bar" style="height:${Math.max(4, c.score)}%;--hue:${scoreHue(
        c.score
      )}"></div>
        <span class="tl__time">${fmtTime(c.time)}</span>
      </div>`
    )
    .join('');

  // Orari della luce (golden/blue hour) attorno all'evento.
  const tw = twilightTimes(eventDate, place.latitude, place.longitude);
  const fmtRange = (a, b) => (a && b ? `${fmtTime(a)}–${fmtTime(b)}` : '—');
  const goldenRange = event === 'sunset' ? fmtRange(tw.golden, tw.event) : fmtRange(tw.event, tw.golden);
  const blueRange = event === 'sunset' ? fmtRange(tw.event, tw.blue) : fmtRange(tw.blue, tw.event);
  const lightHtml = `
    <section class="light">
      <h3>${icon(event === 'sunset' ? 'sunset' : 'sunrise', { size: 16 })} ${t('section.light')}</h3>
      <div class="light__chips">
        <div class="light__chip light__chip--golden"><span class="light__k">${t(
          'light.golden'
        )}</span><strong>${goldenRange}</strong></div>
        <div class="light__chip light__chip--blue"><span class="light__k">${t(
          'light.blue'
        )}</span><strong>${blueRange}</strong></div>
      </div>
    </section>`;

  const notesHtml = notes
    .map((n) => {
      const p = { ...n.params };
      if (n.code === 'hazeBad') {
        p.pm25note = p.pm25 != null ? t('explain.hazeBad.pm25', { pm25: p.pm25 }) : '';
      }
      return `
      <li class="note note--${n.sentiment}">
        <span class="note__icon">${icon(n.icon, { size: 22 })}</span>
        <div>
          <strong>${t('explain.' + n.code + '.title', p)}</strong>
          <p>${t('explain.' + n.code + '.detail', p)}</p>
        </div>
      </li>`;
    })
    .join('');

  card.innerHTML = `
    <header class="card__head">
      <div>
        <h2>
          ${place.label}
          <button class="fav-toggle" title="${t('detail.favSave')}" aria-pressed="${isFavorite(
            place
          )}" aria-label="${t('detail.favSave')}">${icon('star', {
    size: 20,
    fill: isFavorite(place),
  })}</button>
          <button class="share-btn" title="${t('detail.share')}" aria-label="${t('detail.shareAria')}">${icon(
            'share',
            { size: 18 }
          )}</button>
          <button class="shareimg-btn" title="${t('detail.shareImg')}" aria-label="${t('detail.shareImg')}">${icon(
            'map',
            { size: 18 }
          )}</button>
        </h2>
        <p class="muted">${t('detail.head', { noun: eventNoun(event), day: fmtDay(eventDate), time: fmtTime(eventDate) })}</p>
      </div>
      <div class="gauge" style="--score:${score};--hue:${scoreHue(score)}">
        <div class="gauge__value">${score}</div>
        <div class="gauge__label">${t('label.' + scoreLabel(score))}</div>
      </div>
    </header>

    <div class="skypreview" style="background:${skyCss}">
      <span class="skypreview__label">${t('sky.preview')}</span>
    </div>

    <section class="stats">
      <div class="stat"><span>${icon('compass', {
        size: 16,
      })} ${t('stat.direction')}</span><strong>${cardinal(azimuthToCardinal(sun.azimuth))} (${Math.round(
    sun.azimuth
  )}°)</strong></div>
      <div class="stat"><span>${icon('thermometer', {
        size: 16,
      })} ${t('stat.temp')}</span><strong>${Math.round(cond.temperature)}°C</strong></div>
      <div class="stat"><span>${icon('eye', { size: 16 })} ${t('stat.visibility')}</span><strong>${(
    cond.visibility / 1000
  ).toFixed(0)} km</strong></div>
      ${
        Number.isFinite(state.forecast?.elevation)
          ? `<div class="stat"><span>${icon('mountain', {
              size: 16,
            })} ${t('stat.horizon', { m: Math.round(state.forecast.elevation) })}</span><strong>~${horizonDistanceKm(
              state.forecast.elevation
            ).toFixed(0)} km</strong></div>`
          : ''
      }
      <div class="stat"><span>${icon('droplet', {
        size: 16,
      })} ${t('stat.humidity')}</span><strong>${Math.round(cond.humidity)}%</strong></div>
      <div class="stat"><span>${icon('cloud', {
        size: 16,
      })} ${t('stat.clouds')}</span><strong>${Math.round(cond.cloudCoverLow)}/${Math.round(
    cond.cloudCoverMid
  )}/${Math.round(cond.cloudCoverHigh)}%</strong></div>
      ${
        cond.aerosol != null
          ? `<div class="stat"><span>${icon('haze', {
              size: 16,
            })} ${t('stat.aerosol')}</span><strong>${cond.aerosol.toFixed(2)} · ${
              cond.pm25 != null ? Math.round(cond.pm25) + ' µg/m³' : '—'
            }</strong></div>`
          : ''
      }
      <div class="stat"><span>${icon('moon', { size: 16 })} ${t('stat.moon')}</span><strong>${t(
    'moon.' + moonPhaseName(phase)
  )}</strong></div>
    </section>

    <section>
      <h3>${t('section.point')}</h3>
      ${mapEmbedHtml()}
      ${gridNote ? `<p class="muted map__note">${gridNote}</p>` : ''}
    </section>

    <section class="lookat">
      <div>
        <h3>${t('section.lookAt')}</h3>
        <p class="muted">${t('lookAt.text', {
          verb: t(event === 'sunset' ? 'verb.willSet' : 'verb.willRise'),
          dir: cardinal(azimuthToCardinal(sun.azimuth)),
          deg: Math.round(sun.azimuth),
        })}</p>
      </div>
      ${compassSvg(sun.azimuth)}
    </section>

    ${lightHtml}

    ${spotsSectionHtml(place, sun)}

    <section>
      <h3>${t('section.trend', { when: t(event === 'sunset' ? 'when.sunset' : 'when.sunrise') })}</h3>
      <div class="timeline">${timelineHtml}</div>
      <p class="muted tl__hint">${t('trend.hint', {
        when: t(event === 'sunset' ? 'when.sunset2' : 'when.sunrise2'),
      })}</p>
    </section>

    <section>
      <h3>${t('section.why')}</h3>
      <ul class="notes">${notesHtml}</ul>
    </section>
  `;

  const favBtn = card.querySelector('.fav-toggle');
  favBtn.addEventListener('click', () => {
    const saved = toggleFavorite(place);
    favBtn.innerHTML = icon('star', { size: 20, fill: saved });
    favBtn.classList.toggle('fav-toggle--on', saved);
    favBtn.setAttribute('aria-pressed', String(saved));
    renderFavorites();
  });
  favBtn.classList.toggle('fav-toggle--on', isFavorite(place));

  card.querySelector('.share-btn').addEventListener('click', () => shareCurrent(score));
  card.querySelector('.shareimg-btn').addEventListener('click', () =>
    shareImage({ place, score, factors, eventDate, event, sun })
  );

  const scanBtn = card.querySelector('.scan-btn');
  if (scanBtn) scanBtn.addEventListener('click', scanCoordinates);

  els.results.appendChild(card);

  // Contesto della mappa grande: gli stessi dati della mini-mappa. Aggiornato ad
  // ogni render (giorno/evento) così la mappa grande apre sempre la vista corrente.
  const mapCtx = {
    lat: place.latitude,
    lon: place.longitude,
    azimuth: sun.azimuth,
    score,
    event,
    visibility: cond.visibility,
    spots: Array.isArray(state.spots) ? state.spots : [],
  };
  lastMapContext = mapCtx;

  // Il pulsante e l'anteprima aprono la mappa grande in-app (rotta #map).
  card.querySelector('#open-bigmap')?.addEventListener('click', openBigMap);

  // Monta la mini-mappa Leaflet nel contenitore appena inserito nel DOM
  // (marker colorato per punteggio + raggio verso il sole). Non blocca il
  // render: se Leaflet non si carica (offline) il resto del dettaglio resta.
  // Un click sull'area della mini-mappa (non su un marker) espande alla grande.
  mountMiniMap(card.querySelector('#detail-map'), {
    ...mapCtx,
    onExpand: openBigMap,
  }).catch((err) => console.warn('Mini-mappa non disponibile:', err));
}

// Ultimo contesto mappa noto (località/evento/giorno correnti): la mappa grande
// lo legge da window.skyhueMapContext all'apertura.
let lastMapContext = null;

/** Apre la mappa grande in-app con il contesto corrente (tutti i punti marcati). */
function openBigMap() {
  if (lastMapContext) window.skyhueMapContext = lastMapContext;
  location.hash = '#map';
}

/** Costruisce un link condivisibile allo stato corrente (località + evento). */
function buildShareUrl() {
  const { place, event } = state;
  const url = new URL(location.origin + location.pathname);
  url.searchParams.set('lat', place.latitude.toFixed(4));
  url.searchParams.set('lon', place.longitude.toFixed(4));
  url.searchParams.set('label', place.label);
  url.searchParams.set('event', event);
  return url.toString();
}

/** Condivide via Web Share API, con fallback alla copia negli appunti. */
async function shareCurrent(score) {
  const url = buildShareUrl();
  const text = t('share.text', { noun: eventNoun(state.event), score, label: state.place.label });
  try {
    if (navigator.share) {
      await navigator.share({ title: 'SkyHue', text, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    setStatus(t('status.linkCopied'), 'info');
  } catch {
    // Ultima spiaggia: mostra l'URL nella barra di stato.
    setStatus(url, 'info');
  }
}

/**
 * Genera un'immagine (canvas) con il Sunset Score, località, orario e direzione
 * del sole, sul gradiente atteso del cielo, e la condivide (Web Share API con
 * file) o la scarica come fallback. Nessuna dipendenza esterna.
 */
async function shareImage({ place, score, factors, eventDate, event, sun }) {
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Sfondo: gradiente del cielo atteso (stessi stop della preview).
  const stops = skyGradient(factors, score);
  const hsl = (s) => `hsl(${s.h} ${s.s}% ${s.l}%)`;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, hsl(stops[0]));
  g.addColorStop(0.55, hsl(stops[1]));
  g.addColorStop(0.8, hsl(stops[2]));
  g.addColorStop(1, hsl(stops[3]));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const noun = eventNoun(event);
  ctx.textAlign = 'center';

  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = '600 46px system-ui, -apple-system, sans-serif';
  ctx.fillText('🌅 SkyHue', W / 2, 96);

  ctx.fillStyle = '#fff';
  ctx.font = '800 330px system-ui, -apple-system, sans-serif';
  ctx.fillText(String(score), W / 2, H / 2 + 30);

  ctx.font = '700 66px system-ui, -apple-system, sans-serif';
  ctx.fillText(t('label.' + scoreLabel(score)), W / 2, H / 2 + 150);

  // Località (riduci il font se troppo larga).
  let labelSize = 54;
  ctx.font = `600 ${labelSize}px system-ui, -apple-system, sans-serif`;
  while (ctx.measureText(place.label).width > W - 120 && labelSize > 28) {
    labelSize -= 3;
    ctx.font = `600 ${labelSize}px system-ui, -apple-system, sans-serif`;
  }
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.fillText(place.label, W / 2, H - 250);

  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '400 40px system-ui, -apple-system, sans-serif';
  ctx.fillText(
    t('share.imgTime', { noun, time: fmtTime(eventDate), day: fmtDay(eventDate) }),
    W / 2,
    H - 185
  );
  ctx.fillText(
    `${t('stat.direction')}: ${cardinal(azimuthToCardinal(sun.azimuth))} (${Math.round(sun.azimuth)}°)`,
    W / 2,
    H - 135
  );

  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '400 34px system-ui, -apple-system, sans-serif';
  ctx.fillText('nocfer.github.io/skyhue', W / 2, H - 64);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) {
    setStatus(t('status.imgError'), 'error');
    return;
  }
  const file = new File([blob], 'skyhue.png', { type: 'image/png' });
  const text = t('share.text', { noun, score, label: place.label });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'SkyHue', text });
      return;
    }
  } catch {
    /* condivisione annullata o non riuscita: si passa al download */
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'skyhue.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  setStatus(t('status.imgSaved'), 'info');
}

/** Disegna la barra dei preferiti (chip cliccabili con rimozione). */
function renderFavorites() {
  const favs = getFavorites();
  els.favorites.innerHTML =
    favs
      .map(
        (f) => `
      <span class="fav-chip" data-id="${f.id}">
        <button class="fav-chip__load" data-load="${f.id}">${f.label}</button>
        <button class="fav-chip__del" data-del="${f.id}" title="${t('fav.remove')}" aria-label="${t('fav.remove')}">×</button>
      </span>`
      )
      .join('') +
    (favs.length >= 2
      ? `<button class="fav-compare" id="fav-compare">${icon('compass', {
          size: 15,
        })} ${t('fav.compare')}</button>`
      : '');

  els.favorites.querySelectorAll('[data-load]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const fav = getFavorites().find((f) => f.id === btn.dataset.load);
      if (fav) analyze({ latitude: fav.latitude, longitude: fav.longitude, label: fav.label });
    });
  });
  els.favorites.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      removeFavorite(btn.dataset.del);
      renderFavorites();
    });
  });
  const cmp = els.favorites.querySelector('#fav-compare');
  if (cmp) cmp.addEventListener('click', compareFavorites);
}

/**
 * Confronta i preferiti per l'evento corrente (prossimo tramonto/alba): scarica
 * il meteo di ciascuno, calcola il Sunset Score e li mostra ordinati in un
 * modale. Nessun aerosol per punto (meno chiamate): confronto puramente meteo.
 */
async function compareFavorites() {
  const favs = getFavorites();
  if (favs.length < 2) return;
  const overlay = document.createElement('div');
  overlay.className = 'cmp';
  overlay.innerHTML = `
    <div class="cmp__box">
      <button class="cmp__close" aria-label="${t('cmp.close')}">×</button>
      <h3>${t('cmp.title', { event: eventNoun(state.event).toLowerCase() })}</h3>
      <div class="cmp__list muted">${t('cmp.calc')}</div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.cmp__close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  const rows = await Promise.all(
    favs.map(async (f) => {
      try {
        const fc = await fetchForecast(f.latitude, f.longitude);
        const ne = nextSunset(fc, new Date());
        const iso = state.event === 'sunset' ? ne.sunset : ne.sunrise;
        const cond = conditionsAtTime(fc, iso);
        return { label: f.label, score: computeSunsetScore(cond).score, time: new Date(iso) };
      } catch (err) {
        return { label: f.label, score: null, time: null };
      }
    })
  );
  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  const list = overlay.querySelector('.cmp__list');
  if (list) {
    list.classList.remove('muted');
    list.innerHTML = rows
      .map(
        (r) => `
      <div class="cmp__row">
        <span class="cmp__score" style="--hue:${scoreHue(r.score ?? 0)}">${
          r.score ?? '—'
        }</span>
        <div class="cmp__body">
          <strong>${r.label}</strong>
          <span class="muted">${
            r.time ? eventNoun(state.event) + ' ' + fmtTime(r.time) : t('cmp.na')
          }</span>
        </div>
      </div>`
      )
      .join('');
  }
}

// --- Eventi UI -------------------------------------------------------------

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = els.input.value.trim();
  if (!query) return;
  setStatus(t('status.searching'), 'info');
  try {
    const matches = await geocode(query, 5, getLang());
    if (matches.length === 0) {
      setStatus(t('status.noResults'), 'error');
      return;
    }
    const m = matches[0];
    const parts = [m.name, m.admin1, m.country].filter(Boolean);
    await analyze({
      latitude: m.latitude,
      longitude: m.longitude,
      label: parts.join(', '),
    });
  } catch (err) {
    setStatus(t('status.error', { msg: err.message }), 'error');
  }
});

els.geoBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    setStatus(t('status.geoUnsupported'), 'error');
    return;
  }
  setStatus(t('status.geolocating'), 'info');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      analyze({ latitude, longitude, label: `${t('geo.here')} (${coordsLabel(latitude, longitude)})` });
    },
    (err) => setStatus(t('status.geoUnavailable', { msg: err.message }), 'error')
  );
});

// Selettore alba / tramonto
document.querySelectorAll('.mode').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.event = btn.dataset.event;
    document
      .querySelectorAll('.mode')
      .forEach((b) => b.classList.toggle('mode--active', b === btn));
    if (state.forecast) render();
    // L'azimut cambia molto tra alba e tramonto: rivaluta l'affaccio dei punti.
    if (state.rawSpots && state.rawSpotsFor === state.place) {
      state.spots = null;
      state.spotsError = false;
      render();
      evaluateSpots();
    }
  });
});

/** All'avvio, se l'URL contiene una località condivisa, la apre. */
function initFromUrl() {
  const p = new URLSearchParams(location.search);
  const lat = parseFloat(p.get('lat'));
  const lon = parseFloat(p.get('lon'));
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    const event = p.get('event') === 'sunrise' ? 'sunrise' : 'sunset';
    state.event = event;
    document
      .querySelectorAll('.mode')
      .forEach((b) => b.classList.toggle('mode--active', b.dataset.event === event));
    const label = p.get('label') || coordsLabel(lat, lon);
    analyze({ latitude: lat, longitude: lon, label });
  }
}

// Un punto scelto sulla mappa chiede l'analisi completa: la eseguiamo qui.
window.addEventListener('skyhue:analyze', (e) => analyze(e.detail));

// Toggle tema chiaro/scuro (il tema è già applicato in <head> prima del paint).
function updateThemeToggle() {
  const b = document.getElementById('theme-toggle');
  if (b) b.textContent = document.documentElement.dataset.theme === 'light' ? '☾' : '☀';
}
const themeBtn = document.getElementById('theme-toggle');
if (themeBtn) {
  themeBtn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('skyhue.theme', next);
    } catch (e) {
      /* storage non disponibile */
    }
    updateThemeToggle();
    // Notifica la mappa così può scambiare i tile chiari/scuri col tema.
    window.dispatchEvent(new CustomEvent('skyhue:themechange', { detail: next }));
  });
  updateThemeToggle();
}

// Toggle lingua IT/EN: aggiorna il dizionario, i testi statici e ri-renderizza.
function updateLangToggle() {
  const b = document.getElementById('lang-toggle');
  if (b) b.textContent = getLang() === 'en' ? 'IT' : 'EN';
}
const langBtn = document.getElementById('lang-toggle');
if (langBtn) {
  langBtn.addEventListener('click', () => {
    setLang(getLang() === 'en' ? 'it' : 'en');
    document.documentElement.lang = getLang();
    applyStaticI18n();
    updateLangToggle();
    renderFavorites();
    // Ri-renderizza il risultato corrente, se presente.
    if (state.forecast && state.place) render();
    // Aggiorna il pannello mappa se aperto.
    window.dispatchEvent(new CustomEvent('skyhue:langchange', { detail: getLang() }));
  });
}

// Avvio: lingua, testi statici, preferiti salvati e link condiviso.
initLang();
document.documentElement.lang = getLang();
applyStaticI18n();
updateLangToggle();
renderFavorites();
initFromUrl();
