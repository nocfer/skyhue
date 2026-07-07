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
import { computeSunsetScore, scoreLabel, explainScore, WEIGHTS } from './score.js';
import {
  sunPosition,
  azimuthToCardinal,
  moonPhase,
  moonPhaseName,
  twilightTimes,
} from './astronomy.js';
import { getFavorites, isFavorite, toggleFavorite, removeFavorite } from './store.js';
import { skyGradient, skyGradientCss } from './sky.js';
import { icon, ICONS } from './icons.js';
import {
  scoreHue,
  scoreNumeral,
  skySwatch,
  statCell,
  sectionHeader,
  chip,
  button,
} from './ui.js';
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
  suggest: document.getElementById('search-suggest'),
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
  // Conserviamo anche i factors, così ogni ora può disegnare il proprio swatch.
  const timeline = conditionsWindow(forecast, eventIso, 2, 2).map((c) => {
    const hourCond = { ...c, ...airAtTime(state.air, c.time) };
    const { score: s, factors: f } = computeSunsetScore(hourCond);
    return { time: new Date(c.time), score: s, factors: f, isCenter: c.isCenter };
  });

  return { day, eventDate, cond, score, factors, notes, sun, phase, timeline, event, place };
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

function fmtWeekdayLong(date) {
  return date.toLocaleDateString(locale(), { weekday: 'long' });
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
    ${button(t('detail.openMap'), { variant: 'primary', icon: 'map', id: 'open-bigmap', cls: 'map__open' })}`;
}

/** Card di un punto suggerito (usata sia per i POI sia per i punti stimati). */
function spotRowHtml(s) {
  const info = kindInfo(s.kind);
  const dist = s.dist < 10 ? s.dist.toFixed(1) : Math.round(s.dist);
  const v = s.verdict;
  const est = s.kind === 'estimate';
  const url = `https://www.openstreetmap.org/?mlat=${s.lat.toFixed(5)}&mlon=${s.lon.toFixed(
    5
  )}#map=15/${s.lat.toFixed(4)}/${s.lon.toFixed(4)}`;
  // Pillola "cielo NN": il colore atteso nel punto (mostrata anche per affacci ostruiti).
  const skyPill =
    s.skyScore != null
      ? chip({
          variant: 'sky',
          value: t('spot.sky', { n: s.skyScore }),
          score: s.skyScore,
          title: t('spot.skyTitle'),
        })
      : '';
  const quota = est && s.elev != null ? ` · ${Math.round(s.elev)} ${t('unit.m')}` : '';
  const kindLabel = est ? t('kind.estimate') : t(info.labelKey);
  const meta = `${kindLabel} · ${dist} ${t('unit.km')} · ~${s.driveMin} ${t('unit.min')} · ${cardinal(
    s.dir
  )}${quota}`;
  return `<li class="spot spot--${v.sentiment}">
    ${skySwatch({ size: 'lg', tag: est ? t('spot.estTag') : '' })}
    <div class="spot__body">
      <a class="spot__name" href="${url}" target="_blank" rel="noopener">${escapeHtml(
        s.name || t(info.labelKey)
      )}</a>
      <span class="spot__verdict">${icon(v.icon, { size: 15 })} ${t(
        'verdict.' + v.code
      )}<span class="spot__kind" title="${escapeHtml(kindLabel)}">${icon(info.icon, {
        size: 14,
      })}</span></span>
      <span class="spot__meta mono">${meta}</span>
    </div>
    <div class="spot__scores">
      ${scoreNumeral(v.score, { size: 'm', score: v.score, title: t('spot.viewQuality') })}
      ${skyPill}
    </div>
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
    ${button(state.estimating ? t('spots.scanning') : t('spots.scan'), {
      variant: 'outline',
      icon: state.estimating ? undefined : 'compass',
      cls: 'scan-btn',
      attrs: state.estimating ? 'disabled' : '',
    })}
    ${list}`;
}

/** Sezione "Dove andare a guardarlo": punti panoramici vicini (doppio punteggio). */
function spotsSectionHtml(place, sun) {
  const dirNote = t('spots.dirNote', {
    verb: t(state.event === 'sunset' ? 'verb.sets' : 'verb.rises'),
    dir: cardinal(azimuthToCardinal(sun.azimuth)),
    deg: Math.round(sun.azimuth),
  });

  let body = '';
  let more = '';
  if (state.spotsError) {
    body = `<p class="sect__note">${t('spots.error')}</p>`;
  } else if (state.spots === null) {
    body = `<p class="sect__note">${t('spots.loading')}</p>`;
  } else if (state.spots.length === 0) {
    body = `<p class="sect__note">${t('spots.none')}</p>`;
  } else {
    const shown = state.spots.slice(0, SPOTS_EVALUATE);
    body = `<ul class="spots is-collapsed" id="spots-list">${shown.map(spotRowHtml).join('')}</ul>`;
    if (shown.length > 3) {
      more = `<button type="button" class="linkbtn" id="spots-more" data-more="${t('spots.seeAll', {
        n: shown.length,
      })}" data-less="${t('spots.seeLess')}">${t('spots.seeAll', { n: shown.length })}</button>`;
    }
  }

  return `
    <section class="sect">
      ${sectionHeader(t('section.spots'))}
      <p class="sect__cap">${dirNote}</p>
      <p class="dualscore mono">${t('spot.dualLegend')}</p>
      ${body}
      ${more}
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
      <text x="70" y="22" class="compass__lbl">${cardinal('N')}</text>
      <text x="122" y="75" class="compass__lbl">${cardinal('E')}</text>
      <text x="70" y="132" class="compass__lbl">${cardinal('S')}</text>
      <text x="18" y="75" class="compass__lbl">${cardinal('O')}</text>
    </svg>`;
}

/** Mostra la home (nessuna località). Se focusSearch, porta il cursore nella
 *  barra di ricerca (usato dal pulsante "cerca" nell'hero dei risultati). */
function showHome(focusSearch) {
  state.forecast = null;
  state.place = null;
  state.spots = null;
  state.rawSpots = null;
  els.results.hidden = true;
  els.results.innerHTML = '';
  const home = document.getElementById('home');
  if (home) home.hidden = false;
  renderFavorites();
  window.scrollTo(0, 0);
  if (focusSearch === true) setTimeout(() => els.input && els.input.focus(), 50);
}

/** Mostra la schermata risultati (nasconde la home). */
function showResults() {
  const home = document.getElementById('home');
  if (home) home.hidden = true;
  els.results.hidden = false;
}

/** Cambia evento (alba/tramonto) e ri-renderizza mantenendo tutti i toggle sincronizzati. */
function setEvent(ev) {
  if (ev !== 'sunset' && ev !== 'sunrise') return;
  state.event = ev;
  document
    .querySelectorAll('.mode')
    .forEach((b) => b.classList.toggle('mode--active', b.dataset.event === ev));
  // L'azimut cambia molto tra alba e tramonto: rivaluta l'affaccio dei punti.
  if (state.rawSpots && state.rawSpotsFor === state.place) {
    state.spots = null;
    state.spotsError = false;
  }
  if (state.forecast) render();
  if (state.rawSpots && state.rawSpotsFor === state.place) evaluateSpots();
  if (!state.forecast) renderFavorites(); // aggiorna i punteggi dei preferiti in home
}

/** Collega i pulsanti alba/tramonto contenuti in `root`. */
function bindModes(root) {
  root.querySelectorAll('.mode').forEach((btn) => {
    btn.addEventListener('click', () => setEvent(btn.dataset.event));
  });
}

/** Ridisegna l'intera vista in base allo stato: home (nessuna località) o
 *  risultati (hero cielo + sezioni in un unico scroll). */
function render() {
  if (!state.forecast) {
    showHome();
    return;
  }
  showResults();

  const { forecast } = state;
  const days = dailyList(forecast);
  const scored = days.map((d) => {
    const cond = {
      ...conditionsAtTime(forecast, d[state.event]),
      ...airAtTime(state.air, d[state.event]),
    };
    return { d, score: computeSunsetScore(cond).score, date: new Date(d[state.event]) };
  });

  renderResults(evaluateDay(state.dayIndex), scored);
}

/** Nome cardinale localizzato dall'azimut. */
function dirName(azimuth) {
  return cardinal(azimuthToCardinal(azimuth));
}

/** Parola contestuale dell'occhiello ("Stasera" oggi, altrimenti il giorno). */
function whenWord(date, event) {
  return event === 'sunset' && state.dayIndex === 0 ? t('time.tonight') : fmtWeekdayShort(date);
}

/* ---------- Hero cielo (schermata risultati 1b) ---------- */
function heroHtml({ eventDate, score, event }) {
  const { place } = state;
  const label = scoreLabel(score);
  // Punteggi bassi: cielo meno vivido (desatura + scurisce proporzionalmente).
  const satu = (0.4 + 0.6 * (score / 100)).toFixed(2);
  const bright = (0.72 + 0.28 * (score / 100)).toFixed(2);
  return `
    <header class="rhero" style="--hue:${scoreHue(score)}">
      <div class="rhero__sky" style="filter:saturate(${satu}) brightness(${bright})"></div>
      <div class="rhero__melt"></div>
      <span class="rhero__sun" aria-hidden="true"></span>
      <div class="rhero__top">
        <button type="button" class="rhero__loc" id="rhero-loc" aria-label="${t('rhero.change')}">
          ${icon('pin', { size: 16 })}<span>${escapeHtml(place.label)}</span>${icon('chevron-down', {
    size: 16,
  })}
        </button>
        <div class="rhero__actions">
          <button type="button" class="gcircle" id="rhero-search" aria-label="${t('rhero.searchAria')}">${icon(
    'search',
    { size: 17 }
  )}</button>
          <button type="button" class="gcircle" id="rhero-share" aria-label="${t('detail.shareAria')}">${icon(
    'share',
    { size: 16 }
  )}</button>
          <button type="button" class="gcircle fav-toggle" aria-pressed="${isFavorite(
            place
          )}" aria-label="${t('detail.favSave')}">${icon('star', {
    size: 17,
    fill: isFavorite(place),
  })}</button>
        </div>
      </div>
      <div class="rhero__verdict">
        <p class="rhero__eyebrow mono">${whenWord(eventDate, event)} · ${eventNoun(
    event
  )} ${fmtTime(eventDate)}</p>
        <h1 class="verdict__headline">${t('headline.' + label + '.' + event)}</h1>
        <p class="rhero__score">${scoreNumeral(score, {
          size: 'l',
          score,
        })}<span>${t('results.scoreOutOf')}</span></p>
        <div class="rhero__meter" role="presentation" aria-hidden="true">
          <span class="rhero__meterfill" style="width:${Math.max(0, Math.min(100, score))}%"></span>
        </div>
      </div>
    </header>`;
}

function introHtml({ score, sun }) {
  return `<p class="rintro">${t('intro.' + scoreLabel(score), {
    dir: dirName(sun.azimuth),
    verb: t(state.event === 'sunset' ? 'verb.sets' : 'verb.rises'),
  })}</p>`;
}

/* Toggle compatto alba/tramonto nella schermata risultati. */
function eventToggleHtml() {
  const mk = (ev, ico) =>
    `<button type="button" class="mode${state.event === ev ? ' mode--active' : ''}" data-event="${ev}">${icon(
      ico,
      { size: 15 }
    )} <span>${t('mode.' + ev)}</span></button>`;
  return `<div class="modes modes--compact" role="group" aria-label="${t(
    'mode.groupAria'
  )}">${mk('sunset', 'sunset')}${mk('sunrise', 'sunrise')}</div>`;
}

/* "This week": nastro a 7 giorni con pallino + numero colorato. */
function weekRibbonHtml(scored, bestDayIndex = null) {
  // Riepilogo settimanale: la didascalia usa il massimo; il bagliore evidenzia
  // solo il giorno "da banner" (≥85 e non oggi), o nessuno se non qualifica.
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a), scored[0]);
  const cols = scored
    .map(({ d, score, date }) => {
      const isBest = bestDayIndex != null && d.dayIndex === bestDayIndex;
      const active = d.dayIndex === state.dayIndex;
      return `
      <button class="wk__col${active ? ' wk__col--active' : ''}${
        isBest ? ' wk__col--best' : ''
      }" data-day="${d.dayIndex}">
        ${scoreNumeral(score, { size: 'xs', score, cls: 'wk__score' })}
        <span class="wk__dot"></span>
        <span class="wk__day">${fmtWeekdayShort(date)}</span>
      </button>`;
    })
    .join('');
  return `
    <section class="sect sect--week">
      ${sectionHeader(t('section.week'))}
      <p class="sect__cap">${t('week.caption', {
        day: fmtWeekdayShort(best.date),
        score: best.score,
      })}</p>
      <div class="wk">${cols}</div>
    </section>`;
}

/* "Conditions": 2×2 di card meteo con descrittore breve. */
function condDesc(type, v) {
  const key =
    type === 'high'
      ? v >= 20 && v <= 75
        ? 'litCirrus'
        : v > 75
        ? 'heavyHigh'
        : 'fewHigh'
      : type === 'low'
      ? v < 15
        ? 'clearHorizon'
        : v < 40
        ? 'someLow'
        : 'blockedLow'
      : type === 'vis'
      ? v >= 20
        ? 'crispAir'
        : v >= 10
        ? 'okVis'
        : 'hazyVis'
      : v <= 50
      ? 'dryAir'
      : v <= 70
      ? 'okHum'
      : 'humidAir';
  return t('desc.' + key);
}

function conditionsHtml(cond) {
  const visKm = cond.visibility / 1000;
  return `
    <section class="sect">
      ${sectionHeader(t('section.conditions'))}
      <div class="statgrid">
        ${statCell({ icon: 'cloud-sun', label: t('cond.highCloud'), value: Math.round(cond.cloudCoverHigh) + '%', note: condDesc('high', cond.cloudCoverHigh) })}
        ${statCell({ icon: 'cloud', label: t('cond.lowCloud'), value: Math.round(cond.cloudCoverLow) + '%', note: condDesc('low', cond.cloudCoverLow) })}
        ${statCell({ icon: 'eye', label: t('stat.visibility'), value: visKm.toFixed(0) + ' km', note: condDesc('vis', visKm) })}
        ${statCell({ icon: 'droplet', label: t('stat.humidity'), value: Math.round(cond.humidity) + '%', note: condDesc('hum', cond.humidity) })}
      </div>
      <p class="sect__cap cond__mid">${t('cond.midNote', { mid: Math.round(cond.cloudCoverMid ?? 0) })}</p>
    </section>`;
}

/* "Why this score": barra "come si compone" + card fattori (top 3 + mostra tutti). */
function whyHtml({ score, factors, notes }) {
  const b0 = WEIGHTS.base * 100;
  const d0 = WEIGHTS.drama * 100 * (factors.drama ?? 0);
  const c0 = WEIGHTS.clarity * 100 * (factors.clarity ?? 0);
  const rawSum = b0 + d0 + c0 || 1;
  const k = score / rawSum; // riporta le componenti al punteggio finale (penalità incluse)
  const base = Math.round(b0 * k);
  const drama = Math.round(d0 * k);
  const clarity = Math.max(0, score - base - drama);
  const pct = (n) => ((n / Math.max(score, 1)) * 100).toFixed(1);

  const cards = notes
    .map((n, i) => {
      const p = { ...n.params };
      if (n.code === 'hazeBad') {
        p.pm25note = p.pm25 != null ? t('explain.hazeBad.pm25', { pm25: p.pm25 }) : '';
      }
      return `
      <li class="driver driver--${n.sentiment}${i >= 3 ? ' driver--extra' : ''}">
        <span class="driver__ico">${icon(n.icon, { size: 20 })}</span>
        <div>
          <strong>${t('explain.' + n.code + '.title', p)}</strong>
          <p>${t('explain.' + n.code + '.detail', p)}</p>
        </div>
      </li>`;
    })
    .join('');

  const more =
    notes.length > 3
      ? `<button type="button" class="linkbtn" id="why-more" data-more="${t('why.showAll', {
          n: notes.length,
        })}" data-less="${t('why.showLess')}">${t('why.showAll', { n: notes.length })}</button>`
      : '';

  return `
    <section class="sect">
      ${sectionHeader(t('section.why'))}
      <div class="addsup">
        <div class="addsup__head"><span class="mono">${t('why.addsUp')}</span>${scoreNumeral(
          score,
          { size: 's', score, cls: 'addsup__score' }
        )}</div>
        <div class="addsup__bar">
          <span class="addsup__seg addsup__seg--base" style="width:${pct(base)}%"></span>
          <span class="addsup__seg addsup__seg--drama" style="width:${pct(drama)}%"></span>
          <span class="addsup__seg addsup__seg--clarity" style="width:${pct(clarity)}%"></span>
        </div>
        <div class="addsup__legend">
          <span><i class="dotc dotc--base"></i>${t('why.baseline')} ${base}</span>
          <span><i class="dotc dotc--drama"></i>${t('why.drama')} +${drama}</span>
          <span><i class="dotc dotc--clarity"></i>${t('why.clarity')} +${clarity}</span>
        </div>
        <p class="addsup__foot">${t('why.footnote')}</p>
      </div>
      <ul class="drivers is-collapsed" id="drivers">${cards}</ul>
      ${more}
      <p class="why-legend">
        <span class="why-legend__c why-legend__c--good"></span>${t('why.legendGood')}
        <span class="why-legend__c why-legend__c--neutral"></span>${t('why.legendNeutral')}
        <span class="why-legend__c why-legend__c--bad"></span>${t('why.legendBad')}
      </p>
    </section>`;
}

/* "Tonight's arc": grafico ad area SVG + swatch di colore previsto per ora. */
function areaChartSvg(timeline) {
  const W = 320;
  const H = 132;
  const padX = 14;
  const padTop = 26;
  const padBot = 22;
  const n = timeline.length;
  const x = (i) => padX + (i * (W - 2 * padX)) / Math.max(1, n - 1);
  const y = (s) => padTop + (1 - s / 100) * (H - padTop - padBot);
  const pts = timeline.map((c, i) => [x(i), y(c.score)]);

  // Path liscio (quadratiche per punti medi).
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const mx = (px + cx) / 2;
    d += ` Q ${px} ${py} ${mx} ${(py + cy) / 2} T ${cx} ${cy}`;
  }
  const area = `${d} L ${pts[n - 1][0]} ${H - padBot} L ${pts[0][0]} ${H - padBot} Z`;

  const grid = [25, 50, 75]
    .map((g) => `<line x1="${padX}" x2="${W - padX}" y1="${y(g)}" y2="${y(g)}" class="arc__grid"/>`)
    .join('');

  const dots = timeline
    .map((c, i) => {
      if (c.isCenter) return '';
      return `<circle cx="${pts[i][0]}" cy="${pts[i][1]}" r="3.2" class="arc__dot"/>`;
    })
    .join('');

  const ci = timeline.findIndex((c) => c.isCenter);
  const center = ci >= 0 ? pts[ci] : null;
  const guide = center
    ? `<line x1="${center[0]}" x2="${center[0]}" y1="${y(timeline[ci].score)}" y2="${
        H - padBot
      }" class="arc__guide"/>
       <circle cx="${center[0]}" cy="${center[1]}" r="6" class="arc__mark"/>
       <text x="${center[0]}" y="${center[1] - 12}" class="arc__val">${timeline[ci].score}</text>`
    : '';

  const labels = timeline
    .map(
      (c, i) =>
        `<text x="${pts[i][0]}" y="${H - 6}" class="arc__x${
          c.isCenter ? ' arc__x--center' : ''
        }">${fmtTime(c.time)}</text>`
    )
    .join('');

  return `<svg viewBox="0 0 ${W} ${H}" class="arc" role="img" aria-label="${t('section.trend', {
    when: t(state.event === 'sunset' ? 'when.sunset' : 'when.sunrise'),
  })}">
    <defs><linearGradient id="arcfill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-opacity="0.5"/>
      <stop offset="1" stop-opacity="0"/>
    </linearGradient></defs>
    ${grid}
    <path d="${area}" fill="url(#arcfill)"/>
    <path d="${d}" class="arc__line"/>
    ${dots}${guide}${labels}
  </svg>`;
}

function hourlyHtml({ timeline }, tw, event) {
  const swatches = timeline
    .map(
      (c) =>
        `<span class="trendsw${c.isCenter ? ' trendsw--center' : ''}" style="background:${skyGradientCss(
          skyGradient(c.factors, c.score)
        )}"></span>`
    )
    .join('');
  return `
    <section class="sect">
      ${sectionHeader(t('trend.arc'))}
      <p class="sect__cap">${t('trend.hint', {
        when: t(state.event === 'sunset' ? 'when.sunset2' : 'when.sunrise2'),
      })}</p>
      <div class="arc-card">${areaChartSvg(timeline)}</div>
      <div class="swatches">
        <span class="swatches__k mono">${t('trend.predicted')}</span>
        <div class="swatches__row">${swatches}</div>
      </div>
      ${lightChipsHtml(tw, event)}
    </section>`;
}

/* Chip golden/blue hour (riusate in "Where to look" e nel trend orario). */
function lightChipsHtml(tw, event) {
  const fmtRange = (a, b) => (a && b ? `${fmtTime(a)}–${fmtTime(b)}` : '—');
  const goldenRange =
    event === 'sunset' ? fmtRange(tw.golden, tw.event) : fmtRange(tw.event, tw.golden);
  const blueRange = event === 'sunset' ? fmtRange(tw.event, tw.blue) : fmtRange(tw.blue, tw.event);
  return `<div class="chips">
        ${chip({ variant: 'golden', label: t('light.golden'), value: goldenRange })}
        ${chip({ variant: 'blue', label: t('light.blue'), value: blueRange })}
      </div>`;
}

/* "Where to look": bussola + testo direzione + chip golden/blue hour. */
function lookAtHtml(sun, tw, event) {
  return `
    <section class="sect">
      ${sectionHeader(t('section.lookAt'))}
      <div class="lookat">
        ${compassSvg(sun.azimuth)}
        <div class="lookat__body">
          <p class="lookat__dir">${dirName(sun.azimuth)}, ${Math.round(sun.azimuth)}°</p>
          <p class="lookat__txt">${t('lookAt.text', {
            verb: t(event === 'sunset' ? 'verb.willSet' : 'verb.willRise'),
            dir: dirName(sun.azimuth),
            deg: Math.round(sun.azimuth),
          })}</p>
        </div>
      </div>
      ${lightChipsHtml(tw, event)}
    </section>`;
}

/* "The point" (3d): mini-mappa + nota di griglia + griglia Atmosfera 2×2. */
function pointHtml({ cond, phase }) {
  const { place } = state;
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

  const atmo = (name, label, value, cap) =>
    statCell({ icon: name, label, value, note: cap, noteAccent: true });

  const aerosolCard =
    cond.aerosol != null
      ? atmo(
          'haze',
          t('stat.aerosol'),
          `${cond.aerosol.toFixed(2)} · ${cond.pm25 != null ? Math.round(cond.pm25) : '—'}`,
          t('atmo.aerosolCap')
        )
      : '';
  const horizonCard = Number.isFinite(grid?.elevation)
    ? atmo(
        'mountain',
        t('atmo.horizon'),
        `~${horizonDistanceKm(grid.elevation).toFixed(0)} km`,
        t('atmo.horizonCap', { m: Math.round(grid.elevation) })
      )
    : '';

  return `
    <section class="sect">
      ${sectionHeader(t('section.point'))}
      ${mapEmbedHtml()}
      ${gridNote ? `<p class="gridnote mono">${gridNote}</p>` : ''}
      ${sectionHeader(t('section.atmosphere'), { variant: 'mono', sub: true })}
      <div class="statgrid">
        ${aerosolCard}
        ${atmo('moon', t('stat.moon'), Math.round(phase * 100) + '%', t('moon.' + moonPhaseName(phase)))}
        ${horizonCard}
        ${atmo('thermometer', t('stat.temp'), Math.round(cond.temperature) + '°C', t('atmo.tempCap.' + state.event))}
      </div>
    </section>`;
}

/** Assembla la schermata risultati e collega gli handler. */
function renderResults(data, scored) {
  const { place, event } = data;
  const { eventDate, score, factors, sun } = data;
  const tw = twilightTimes(eventDate, place.latitude, place.longitude);

  // Banner "tramonto top in arrivo" (miglior giorno ≥85 e non oggi).
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a), scored[0]);
  const bannerBest = best && best.score >= 85 && best.d.dayIndex >= 1 ? best : null;
  const bannerHtml =
    bannerBest
      ? `<button type="button" class="topbanner" id="topbanner">${icon('flame', {
          size: 18,
        })} <span>${t('banner.top', {
          noun: eventNoun(event),
          day: fmtWeekdayLong(best.date),
          score: best.score,
        })}</span></button>`
      : '';

  els.results.innerHTML = `
    ${heroHtml(data)}
    <div class="rcontent">
      ${bannerHtml}
      ${introHtml(data)}
      ${eventToggleHtml()}
      ${weekRibbonHtml(scored, bannerBest ? bannerBest.d.dayIndex : null)}
      ${whyHtml(data)}
      ${hourlyHtml(data, tw, event)}
      ${conditionsHtml(data.cond)}
      ${lookAtHtml(sun, tw, event)}
      ${spotsSectionHtml(place, sun)}
      ${pointHtml(data)}
      <footer class="rfoot"><p data-i18n-html="foot.credits">${t('foot.credits')}</p></footer>
    </div>`;

  // --- Handler ---
  // Torna alla home (nuova ricerca / cambia località).
  els.results.querySelector('#rhero-loc')?.addEventListener('click', showHome);
  els.results.querySelector('#rhero-search')?.addEventListener('click', () => showHome(true));
  els.results.querySelector('#rhero-share')?.addEventListener('click', () => openShareSheet(data));

  // Preferito (stella nell'hero).
  const favBtn = els.results.querySelector('.fav-toggle');
  if (favBtn) {
    favBtn.classList.toggle('fav-toggle--on', isFavorite(place));
    favBtn.addEventListener('click', () => {
      const saved = toggleFavorite(place);
      favBtn.innerHTML = icon('star', { size: 17, fill: saved });
      favBtn.classList.toggle('fav-toggle--on', saved);
      favBtn.setAttribute('aria-pressed', String(saved));
      renderFavorites();
    });
  }

  // Toggle alba/tramonto (variante compatta nei risultati).
  bindModes(els.results);

  // Banner → salta al miglior giorno.
  els.results.querySelector('#topbanner')?.addEventListener('click', () => {
    state.dayIndex = best.d.dayIndex;
    render();
  });

  // Nastro settimana → cambia giorno.
  els.results.querySelectorAll('.wk__col').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.dayIndex = Number(btn.dataset.day);
      render();
    });
  });

  // "Mostra tutti" i fattori.
  const whyMore = els.results.querySelector('#why-more');
  const drivers = els.results.querySelector('#drivers');
  if (whyMore && drivers) {
    whyMore.addEventListener('click', () => {
      const collapsed = drivers.classList.toggle('is-collapsed');
      whyMore.textContent = collapsed ? whyMore.dataset.more : whyMore.dataset.less;
    });
  }

  // "Cerca anche punti non mappati".
  const scanBtn = els.results.querySelector('.scan-btn');
  if (scanBtn) scanBtn.addEventListener('click', scanCoordinates);

  // "Vedi tutti i punti".
  const spotsMore = els.results.querySelector('#spots-more');
  const spotsList = els.results.querySelector('#spots-list');
  if (spotsMore && spotsList) {
    spotsMore.addEventListener('click', () => {
      const collapsed = spotsList.classList.toggle('is-collapsed');
      spotsMore.textContent = collapsed ? spotsMore.dataset.more : spotsMore.dataset.less;
    });
  }

  // Contesto per la mappa grande (aggiornato ad ogni render).
  const mapCtx = {
    lat: place.latitude,
    lon: place.longitude,
    azimuth: sun.azimuth,
    score,
    event,
    visibility: data.cond.visibility,
    spots: Array.isArray(state.spots) ? state.spots : [],
  };
  lastMapContext = mapCtx;
  els.results.querySelector('#open-bigmap')?.addEventListener('click', openBigMap);

  mountMiniMap(els.results.querySelector('#detail-map'), {
    ...mapCtx,
    onExpand: openBigMap,
  }).catch((err) => console.warn('Mini-mappa non disponibile:', err));

  els.results.scrollTop = 0;
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

/** Font per il canvas della condivisione: stesse famiglie dell'app (con
 *  fallback di sistema), così il PNG rispecchia l'identità del brand. */
const IMG_DISPLAY = "'Bricolage Grotesque', system-ui, sans-serif";
const IMG_UI = "'Space Grotesk', system-ui, -apple-system, sans-serif";
const IMG_MONO = "'JetBrains Mono', ui-monospace, monospace";

/** Disegna un'icona di `icons.js` sul canvas (stroke, come nell'app): niente
 *  emoji di sistema, resa identica ovunque. */
function drawCanvasIcon(ctx, name, x, y, size, color) {
  const body = ICONS[name] || ICONS.help;
  const ds = [...body.matchAll(/d="([^"]+)"/g)].map((m) => m[1]);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.9;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const d of ds) ctx.stroke(new Path2D(d));
  ctx.restore();
}

/**
 * Genera un'immagine (canvas) con il Sunset Score, località, orario e direzione
 * del sole, sul gradiente atteso del cielo, e la condivide (Web Share API con
 * file) o la scarica come fallback. Nessuna dipendenza esterna.
 */
async function shareImage({ place, score, factors, eventDate, event, sun, download = false }) {
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

  // Assicura i webfont prima di disegnare, così il PNG usa Bricolage/Space
  // Grotesk come l'app (fallback ai font di sistema se il caricamento fallisce).
  try {
    if (document.fonts) {
      await Promise.all([
        document.fonts.load('800 330px "Bricolage Grotesque"'),
        document.fonts.load('700 66px "Bricolage Grotesque"'),
        document.fonts.load('600 46px "Bricolage Grotesque"'),
        document.fonts.load('600 54px "Space Grotesk"'),
        document.fonts.load('400 40px "Space Grotesk"'),
        document.fonts.load('400 34px "JetBrains Mono"'),
      ]);
    }
  } catch {
    /* si prosegue con i font di sistema */
  }

  // Brand: icona "sunset" + wordmark SkyHue (nessuna emoji di sistema),
  // centrati come nell'anteprima.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = `600 46px ${IMG_DISPLAY}`;
  const brand = 'SkyHue';
  const brandIco = 42;
  const brandGap = 16;
  const brandW = brandIco + brandGap + ctx.measureText(brand).width;
  const brandX = (W - brandW) / 2;
  drawCanvasIcon(ctx, 'sunset', brandX, 62, brandIco, 'rgba(255,255,255,0.92)');
  ctx.fillText(brand, brandX + brandIco + brandGap, 96);
  ctx.textAlign = 'center';

  ctx.fillStyle = '#fff';
  ctx.font = `800 330px ${IMG_DISPLAY}`;
  ctx.fillText(String(score), W / 2, H / 2 + 30);

  ctx.font = `700 66px ${IMG_DISPLAY}`;
  ctx.fillText(t('label.' + scoreLabel(score)), W / 2, H / 2 + 150);

  // Località (riduci il font se troppo larga).
  let labelSize = 54;
  ctx.font = `600 ${labelSize}px ${IMG_UI}`;
  while (ctx.measureText(place.label).width > W - 120 && labelSize > 28) {
    labelSize -= 3;
    ctx.font = `600 ${labelSize}px ${IMG_UI}`;
  }
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.fillText(place.label, W / 2, H - 250);

  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = `400 40px ${IMG_UI}`;
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
  ctx.font = `400 34px ${IMG_MONO}`;
  ctx.fillText('nocfer.github.io/skyhue', W / 2, H - 64);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) {
    setStatus(t('status.imgError'), 'error');
    return;
  }
  const file = new File([blob], 'skyhue.png', { type: 'image/png' });
  const text = t('share.text', { noun, score, label: place.label });
  try {
    if (!download && navigator.canShare && navigator.canShare({ files: [file] })) {
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

/** Foglio "Condividi" (2d): anteprima 4:5 del cielo + azioni condividi/salva/link. */
function openShareSheet(data) {
  const { place, score, factors, eventDate, event, sun } = data;
  const noun = eventNoun(event);
  const skyCss = skyGradientCss(skyGradient(factors, score));
  const label = t('label.' + scoreLabel(score));
  const dir = cardinal(azimuthToCardinal(sun.azimuth));
  const overlay = document.createElement('div');
  overlay.className = 'sheet-scrim';
  overlay.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true">
      <span class="sheet__handle" aria-hidden="true"></span>
      <h2 class="sheet__title display">${t('share.title.' + event)}</h2>
      <div class="sharecard" style="background:${skyCss}">
        <span class="sharecard__brand">${icon('sunset', { size: 15 })} SkyHue</span>
        ${scoreNumeral(score, { size: 'xl', color: '#fff', cls: 'sharecard__score' })}
        <span class="sharecard__label display">${label}</span>
        <div class="sharecard__foot">
          <strong>${escapeHtml(place.label)}</strong>
          <span>${noun} ${fmtTime(eventDate)} · ${dir} ${Math.round(sun.azimuth)}°</span>
        </div>
      </div>
      ${button(t('share.image'), { variant: 'primary', icon: 'share', iconSize: 18, id: 'sh-share', cls: 'sheet__primary' })}
      <div class="sheet__row">
        ${button(t('share.save'), { variant: 'ghost', id: 'sh-save', cls: 'sheet__ghost' })}
        ${button(t('share.copy'), { variant: 'ghost', id: 'sh-copy', cls: 'sheet__ghost' })}
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay
    .querySelector('#sh-share')
    .addEventListener('click', () => shareImage({ place, score, factors, eventDate, event, sun }));
  overlay
    .querySelector('#sh-save')
    .addEventListener('click', () =>
      shareImage({ place, score, factors, eventDate, event, sun, download: true })
    );
  const copyBtn = overlay.querySelector('#sh-copy');
  copyBtn.addEventListener('click', async () => {
    await shareCurrent(score);
    copyBtn.textContent = t('status.linkCopied');
    setTimeout(() => {
      copyBtn.textContent = t('share.copy');
    }, 1600);
  });
}

/** Disegna le card dei luoghi preferiti (home): swatch + nome + orario + punteggio.
 *  I punteggi/orari vengono riempiti in modo asincrono per non bloccare il render. */
function renderFavorites() {
  const favs = getFavorites();
  const places = document.getElementById('places');
  if (places) places.hidden = favs.length === 0;

  els.favorites.innerHTML =
    favs
      .map(
        (f) => `
      <div class="place" role="button" tabindex="0" data-id="${f.id}">
        ${skySwatch({ size: 'md' })}
        <span class="place__body">
          <span class="place__name">${escapeHtml(f.label)}</span>
          <span class="place__when" data-when>${t('cmp.calc')}</span>
        </span>
        <span class="score score--m place__score" data-score>—</span>
        <button class="place__del" data-del="${f.id}" title="${t('fav.remove')}" aria-label="${t(
          'fav.remove'
        )}">×</button>
      </div>`
      )
      .join('') +
    (favs.length >= 2
      ? `<button type="button" class="place-compare" id="fav-compare">${icon('compass', {
          size: 15,
        })} ${t('fav.compare')}</button>`
      : '');

  const load = (id) => {
    const f = getFavorites().find((x) => x.id === id);
    if (f) analyze({ latitude: f.latitude, longitude: f.longitude, label: f.label });
  };
  els.favorites.querySelectorAll('.place').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-del]')) return;
      load(card.dataset.id);
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        load(card.dataset.id);
      }
    });
  });
  els.favorites.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFavorite(btn.dataset.del);
      renderFavorites();
    });
  });
  const cmp = els.favorites.querySelector('#fav-compare');
  if (cmp) cmp.addEventListener('click', compareFavorites);

  enrichFavoriteCards(favs);
}

/** Riempie le card dei preferiti con punteggio + orario dell'evento corrente. */
async function enrichFavoriteCards(favs) {
  await Promise.all(
    favs.map(async (f) => {
      try {
        const fc = await fetchForecast(f.latitude, f.longitude);
        const ne = nextSunset(fc, new Date());
        const iso = state.event === 'sunset' ? ne.sunset : ne.sunrise;
        const cond = conditionsAtTime(fc, iso);
        const score = computeSunsetScore(cond).score;
        const el = els.favorites.querySelector(`.place[data-id="${CSS.escape(f.id)}"]`);
        if (!el) return;
        const sc = el.querySelector('[data-score]');
        const wh = el.querySelector('[data-when]');
        if (sc) {
          sc.textContent = score;
          sc.style.setProperty('--hue', scoreHue(score));
          sc.classList.add('is-set');
          sc.title = t('label.' + scoreLabel(score));
        }
        if (wh) {
          const d = new Date(iso);
          const when = state.event === 'sunset' ? t('time.tonight') : fmtWeekdayShort(d);
          wh.textContent = `${when} · ${eventNoun(state.event)} ${fmtTime(d)}`;
        }
      } catch {
        /* lascia il placeholder */
      }
    })
  );
}

/**
 * Confronta i preferiti per l'evento corrente (prossimo tramonto/alba): scarica
 * il meteo di ciascuno, calcola il Sunset Score e li mostra ordinati in un
 * modale. Nessun aerosol per punto (meno chiamate): confronto puramente meteo.
 */
async function compareFavorites() {
  const favs = getFavorites();
  if (favs.length < 2) return;
  const noun = eventNoun(state.event);
  const overlay = document.createElement('div');
  overlay.className = 'cmp';
  overlay.innerHTML = `
    <div class="cmp__box">
      <header class="cmp__header">
        <div>
          <h2 class="cmp__title display">${t('cmp.heading')}</h2>
          <p class="cmp__sub">${t('cmp.sub.' + state.event)}</p>
        </div>
        <button class="cmp__close gcircle" aria-label="${t('cmp.close')}">×</button>
      </header>
      <div class="cmp__list"><p class="cmp__calc">${t('cmp.calc')}</p></div>
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

  const when = (r) => (r.time ? `${noun} ${fmtTime(r.time)}` : t('cmp.na'));

  const list = overlay.querySelector('.cmp__list');
  if (!list) return;

  const [winner, ...rest] = rows;
  const winnerHtml =
    winner && winner.score != null
      ? `<div class="cmp__winner" style="--hue:${scoreHue(winner.score)}">
          <span class="cmp__best">★ ${t('cmp.best')}</span>
          <div class="cmp__winrow">
            ${skySwatch({ size: 'lg' })}
            <div class="cmp__wininfo">
              <strong>${escapeHtml(winner.label)}</strong>
              <span class="cmp__time">${when(winner)}</span>
            </div>
            <div class="cmp__winscore">
              ${scoreNumeral(winner.score, { size: 'l', score: winner.score, cls: 'cmp__bignum' })}
              <span class="cmp__label">${t('label.' + scoreLabel(winner.score))}</span>
            </div>
          </div>
        </div>`
      : '';

  const rowsHtml = rest
    .map(
      (r, i) => `
      <div class="cmp__row">
        <span class="cmp__rank mono">${i + 2}</span>
        ${skySwatch({ size: 'sm' })}
        <div class="cmp__rowinfo">
          <strong>${escapeHtml(r.label)}</strong>
          <span class="cmp__time">${when(r)}</span>
        </div>
        ${scoreNumeral(r.score ?? '—', { size: 'm', score: r.score ?? undefined, cls: 'cmp__score' })}
      </div>`
    )
    .join('');

  list.innerHTML = `${winnerHtml}${rowsHtml}<p class="cmp__foot">${t('cmp.foot.' + state.event)}</p>`;
}

// --- Eventi UI -------------------------------------------------------------

/** Etichetta leggibile ("Città, Regione, Paese") da un match del geocoder. */
function matchLabel(m) {
  return [m.name, m.admin1, m.country].filter(Boolean).join(', ');
}

function matchToPlace(m) {
  return { latitude: m.latitude, longitude: m.longitude, label: matchLabel(m) };
}

// Località scelta da un suggerimento: l'etichetta mostrata nell'input
// ("Città, Regione, Paese") non è ri-geocodificabile, quindi al submit
// riusiamo direttamente le sue coordinate finché l'utente non modifica il testo.
let chosenPlace = null;

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = els.input.value.trim();
  if (!query) return;
  closeSuggest();
  // Se il testo corrisponde ancora al suggerimento scelto, usalo così com'è.
  if (chosenPlace && chosenPlace.label === query) {
    await analyze(chosenPlace);
    return;
  }
  setStatus(t('status.searching'), 'info');
  try {
    const matches = await geocode(query, 5, getLang());
    if (matches.length === 0) {
      setStatus(t('status.noResults'), 'error');
      return;
    }
    await analyze(matchToPlace(matches[0]));
  } catch (err) {
    setStatus(t('status.error', { msg: err.message }), 'error');
  }
});

// --- Autocompletamento della barra di ricerca -----------------------------
// Man mano che si digita, interroghiamo il geocoder (con debounce) e mostriamo
// i risultati in un elenco navigabile con mouse e tastiera. Il submit continua
// a funzionare (primo risultato) anche senza toccare i suggerimenti.

const suggest = { matches: [], active: -1, seq: 0, open: false };
let suggestTimer = null;

/** Escape minimale: i nomi arrivano da un'API esterna e finiscono in innerHTML. */
function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function updateSuggestAria() {
  els.suggest.setAttribute('aria-label', t('search.suggestAria'));
}

function closeSuggest() {
  suggest.open = false;
  suggest.matches = [];
  suggest.active = -1;
  els.suggest.hidden = true;
  els.suggest.innerHTML = '';
  els.input.setAttribute('aria-expanded', 'false');
  els.input.removeAttribute('aria-activedescendant');
}

function showSuggest(matches) {
  if (!matches.length) {
    closeSuggest();
    return;
  }
  suggest.matches = matches;
  suggest.active = -1;
  els.suggest.innerHTML = matches
    .map((m, i) => {
      const meta = [m.admin1, m.country].filter(Boolean).join(', ');
      return `<li class="suggest__item" role="option" id="suggest-opt-${i}" data-i="${i}" aria-selected="false">
        <span class="suggest__name">${escapeHtml(m.name)}</span>
        ${meta ? `<span class="suggest__meta">${escapeHtml(meta)}</span>` : ''}
      </li>`;
    })
    .join('');
  els.suggest.hidden = false;
  suggest.open = true;
  els.input.setAttribute('aria-expanded', 'true');
  els.input.removeAttribute('aria-activedescendant');
}

function moveActive(delta) {
  const n = suggest.matches.length;
  if (!n) return;
  suggest.active = (suggest.active + delta + n) % n;
  const items = els.suggest.querySelectorAll('.suggest__item');
  items.forEach((li, i) => {
    const on = i === suggest.active;
    li.classList.toggle('suggest__item--active', on);
    li.setAttribute('aria-selected', String(on));
  });
  els.input.setAttribute('aria-activedescendant', `suggest-opt-${suggest.active}`);
  items[suggest.active]?.scrollIntoView({ block: 'nearest' });
}

function chooseSuggest(i) {
  const m = suggest.matches[i];
  if (!m) return;
  const place = matchToPlace(m);
  els.input.value = place.label;
  chosenPlace = place; // così il submit successivo non ri-geocodifica l'etichetta
  closeSuggest();
  analyze(place);
}

async function querySuggest(query) {
  const seq = ++suggest.seq;
  try {
    const matches = await geocode(query, 6, getLang());
    if (seq !== suggest.seq) return; // è arrivata una richiesta più recente
    showSuggest(matches);
  } catch {
    if (seq === suggest.seq) closeSuggest();
  }
}

els.input.addEventListener('input', () => {
  const q = els.input.value.trim();
  chosenPlace = null; // l'utente sta modificando: la selezione precedente non vale più
  clearTimeout(suggestTimer);
  if (q.length < 2) {
    suggest.seq++; // invalida eventuali richieste in volo
    closeSuggest();
    return;
  }
  suggestTimer = setTimeout(() => querySuggest(q), 220);
});

els.input.addEventListener('keydown', (e) => {
  if (!suggest.open) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    moveActive(1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    moveActive(-1);
  } else if (e.key === 'Enter' && suggest.active >= 0) {
    e.preventDefault(); // scegli il suggerimento invece di inviare il form
    chooseSuggest(suggest.active);
  } else if (e.key === 'Escape') {
    closeSuggest();
  }
});

// mousedown (non click) così la scelta parte prima che l'input perda il focus.
els.suggest.addEventListener('mousedown', (e) => {
  const li = e.target.closest('.suggest__item');
  if (!li) return;
  e.preventDefault();
  chooseSuggest(Number(li.dataset.i));
});

els.input.addEventListener('blur', () => {
  setTimeout(closeSuggest, 120);
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
      analyze({
        latitude,
        longitude,
        label: `${t('geo.here')} (${coordsLabel(latitude, longitude)})`,
        isGeo: true,
      });
    },
    (err) => setStatus(t('status.geoUnavailable', { msg: err.message }), 'error')
  );
});

// Selettore alba / tramonto della home. I toggle compatti nei risultati sono
// collegati in renderResults() ad ogni render.
const homeEl = document.getElementById('home');
if (homeEl) bindModes(homeEl);

// Menu "tre puntini" (tema + lingua) in home.
const moreBtn = document.getElementById('more-btn');
const moreMenu = document.getElementById('more-menu');
if (moreBtn && moreMenu) {
  const closeMenu = () => {
    moreMenu.hidden = true;
    moreBtn.setAttribute('aria-expanded', 'false');
  };
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = moreMenu.hidden;
    moreMenu.hidden = !willOpen;
    moreBtn.setAttribute('aria-expanded', String(willOpen));
  });
  document.addEventListener('click', (e) => {
    if (!moreMenu.hidden && !moreMenu.contains(e.target) && e.target !== moreBtn) closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });
}

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
  if (!b) return;
  const glyph = document.documentElement.dataset.theme === 'light' ? '☾' : '☀';
  b.textContent = `${glyph}  ${t('menu.theme')}`;
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
  if (b) b.textContent = `${getLang() === 'en' ? 'IT' : 'EN'}  ${t('menu.lang')}`;
}
const langBtn = document.getElementById('lang-toggle');
if (langBtn) {
  langBtn.addEventListener('click', () => {
    setLang(getLang() === 'en' ? 'it' : 'en');
    document.documentElement.lang = getLang();
    applyStaticI18n();
    updateLangToggle();
    // L'etichetta del tema è composta a mano (glifo + testo tradotto): va
    // riallineata alla nuova lingua, altrimenti resta nell'idioma precedente.
    updateThemeToggle();
    updateSuggestAria();
    renderFavorites();
    // Il testo "La tua posizione" era stato tradotto una volta sola al momento
    // della geolocalizzazione: va rigenerato nella lingua nuova prima di ri-renderizzare.
    if (state.place?.isGeo) {
      state.place.label = `${t('geo.here')} (${coordsLabel(state.place.latitude, state.place.longitude)})`;
    }
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
// initLang() può aver cambiato lingua dopo il primo updateThemeToggle() (fatto
// al montaggio del bottone): riallineiamo l'etichetta del tema alla lingua reale.
updateThemeToggle();
updateSuggestAria();
renderFavorites();
initFromUrl();
