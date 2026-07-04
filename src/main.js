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
import { sunPosition, azimuthToCardinal, moonPhase, moonPhaseName } from './astronomy.js';
import { getFavorites, isFavorite, toggleFavorite, removeFavorite } from './store.js';
import { skyGradient, skyGradientCss } from './sky.js';
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

const EVENT_LABELS = {
  sunset: { noun: 'Tramonto', prep: 'Tramonto di' },
  sunrise: { noun: 'Alba', prep: 'Alba di' },
};

function setStatus(msg, kind = 'info') {
  els.status.textContent = msg || '';
  els.status.dataset.kind = kind;
}

/** Scarica i dati per una località e mostra il risultato. */
async function analyze(place) {
  setStatus(`Recupero dati per ${place.label}…`, 'info');
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
    setStatus(`Errore: ${err.message}`, 'error');
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
      .map((p) => ({ lat: p.lat, lon: p.lon, kind: 'estimate', name: 'Punto stimato' }));
    const evaluated = await refineCandidates(candidates, azimuth, place);
    if (state.place !== place) return;
    evaluated.sort((a, b) => b.finalScore - a.finalScore || a.dist - b.dist);
    state.estimatedSpots = evaluated.slice(0, SPOTS_SHOW);
    state.estimating = false;
    render();
    loadSky(state.estimatedSpots, place);
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

function fmtTime(date) {
  return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function fmtDay(date) {
  return date.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
}

function fmtWeekdayShort(date) {
  return date.toLocaleDateString('it-IT', { weekday: 'short' });
}

/** Colore del punteggio per le sfumature dell'indicatore. */
function scoreHue(score) {
  // da rosso (0) a verde-oro (100)
  return Math.round((score / 100) * 120);
}

/** Mini-mappa OpenStreetMap (iframe) con un segnalino sul punto analizzato. */
function mapEmbedHtml(lat, lon) {
  const d = 0.03; // ampiezza del riquadro attorno al punto (~3 km)
  const bbox = [lon - d, lat - d, lon + d, lat + d].map((n) => n.toFixed(4)).join(',');
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat.toFixed(
    5
  )},${lon.toFixed(5)}`;
  const full = `https://www.openstreetmap.org/?mlat=${lat.toFixed(5)}&mlon=${lon.toFixed(
    5
  )}#map=13/${lat.toFixed(4)}/${lon.toFixed(4)}`;
  return `
    <iframe class="map" title="Punto analizzato sulla mappa" loading="lazy" src="${src}"></iframe>
    <a class="map__link" href="${full}" target="_blank" rel="noopener">Apri mappa più grande ↗</a>`;
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
        )}" title="Sunset Score previsto nel punto">🌇 cielo ${s.skyScore}</span>`
      : '';
  const quota = s.kind === 'estimate' && s.elev != null ? ` · ${Math.round(s.elev)} m` : '';
  return `<li class="spot spot--${v.sentiment}">
    <span class="spot__icon">${info.icon}</span>
    <div class="spot__body">
      <a href="${url}" target="_blank" rel="noopener">${s.name}</a>
      <span class="spot__verdict">${v.icon} ${v.label} ${sky}</span>
      <span class="spot__meta">${info.label} · ${dist} km · ~${s.driveMin} min · verso ${s.dir}${quota}</span>
    </div>
    <span class="spot__score" title="Qualità dell’affaccio">${v.score}</span>
  </li>`;
}

/** Blocco della stima "da coordinate" (pulsante + eventuale lista). */
function estimateBlockHtml() {
  let list = '';
  if (state.estimateError) {
    list = `<p class="muted">Stima non riuscita, riprova.</p>`;
  } else if (state.estimatedSpots && state.estimatedSpots.length) {
    list = `<ul class="spots">${state.estimatedSpots.map(spotRowHtml).join('')}</ul>
      <p class="muted spots__hint">Punti stimati dalla morfologia del terreno: anonimi e non garantiti accessibili (verifica strade/accesso sulla mappa).</p>`;
  } else if (state.estimatedSpots && state.estimatedSpots.length === 0) {
    list = `<p class="muted">Nessun punto promettente trovato dalla stima.</p>`;
  }
  return `
    <button class="scan-btn" ${state.estimating ? 'disabled' : ''}>
      ${state.estimating ? 'Analizzo il territorio…' : '🧭 Cerca anche punti non mappati (stima)'}
    </button>
    ${list}`;
}

/** Sezione "Dove andare a guardarlo": punti panoramici vicini. */
function spotsSectionHtml(place, sun) {
  const dirNote = `Il sole ${
    state.event === 'sunset' ? 'tramonta' : 'sorge'
  } verso <strong>${azimuthToCardinal(sun.azimuth)}</strong> (${Math.round(
    sun.azimuth
  )}°) — scegli un punto con vista libera in quella direzione.`;

  let body;
  if (state.spotsError) {
    body = `<p class="muted">Punti panoramici non disponibili al momento.</p>`;
  } else if (state.spots === null) {
    body = `<p class="muted">Cerco i punti nei dintorni e ne valuto l’affaccio verso il tramonto…</p>`;
  } else if (state.spots.length === 0) {
    body = `<p class="muted">Nessun punto panoramico mappato entro ~25 km.</p>`;
  } else {
    body = `<ul class="spots">${state.spots.slice(0, SPOTS_SHOW).map(spotRowHtml).join('')}</ul>`;
  }

  return `
    <section>
      <h3>Dove andare a guardarlo</h3>
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
    <svg viewBox="0 0 140 140" class="compass" role="img" aria-label="Direzione del sole">
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

  // --- Striscia multi-giorno ---
  const days = dailyList(forecast);
  const strip = document.createElement('div');
  strip.className = 'daystrip';
  strip.innerHTML = days
    .map((d) => {
      const cond = { ...conditionsAtTime(forecast, d[state.event]), ...airAtTime(state.air, d[state.event]) };
      const { score } = computeSunsetScore(cond);
      const date = new Date(d[state.event]);
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
  const label = EVENT_LABELS[event];
  const card = document.createElement('article');
  card.className = 'card';

  const skyCss = skyGradientCss(skyGradient(factors, score));

  // Coordinate richieste e cella di griglia effettivamente usata da Open-Meteo.
  const grid = state.forecast;
  const gridNote =
    grid && Number.isFinite(grid.latitude)
      ? `Punto richiesto ${place.latitude.toFixed(3)}, ${place.longitude.toFixed(
          3
        )} · cella meteo ${grid.latitude.toFixed(3)}, ${grid.longitude.toFixed(3)}`
      : '';

  const timelineHtml = timeline
    .map(
      (t) => `
      <div class="tl__col${t.isCenter ? ' tl__col--center' : ''}">
        <span class="tl__val">${t.score}</span>
        <div class="tl__bar" style="height:${Math.max(4, t.score)}%;--hue:${scoreHue(
        t.score
      )}"></div>
        <span class="tl__time">${fmtTime(t.time)}</span>
      </div>`
    )
    .join('');

  const notesHtml = notes
    .map(
      (n) => `
      <li class="note note--${n.sentiment}">
        <span class="note__icon">${n.icon}</span>
        <div>
          <strong>${n.title}</strong>
          <p>${n.detail}</p>
        </div>
      </li>`
    )
    .join('');

  card.innerHTML = `
    <header class="card__head">
      <div>
        <h2>
          ${place.label}
          <button class="fav-toggle" title="Salva tra i preferiti" aria-pressed="${isFavorite(
            place
          )}">${isFavorite(place) ? '★' : '☆'}</button>
          <button class="share-btn" title="Condividi questa località" aria-label="Condividi">🔗</button>
        </h2>
        <p class="muted">${label.prep} ${fmtDay(eventDate)} · ore ${fmtTime(eventDate)}</p>
      </div>
      <div class="gauge" style="--score:${score}">
        <div class="gauge__value">${score}</div>
        <div class="gauge__label">${scoreLabel(score)}</div>
      </div>
    </header>

    <div class="skypreview" style="background:${skyCss}">
      <span class="skypreview__label">Anteprima del cielo previsto</span>
    </div>

    <section class="stats">
      <div class="stat"><span>🧭 Direzione sole</span><strong>${azimuthToCardinal(
        sun.azimuth
      )} (${Math.round(sun.azimuth)}°)</strong></div>
      <div class="stat"><span>🌡️ Temperatura</span><strong>${Math.round(
        cond.temperature
      )}°C</strong></div>
      <div class="stat"><span>🔭 Visibilità</span><strong>${(cond.visibility / 1000).toFixed(
        0
      )} km</strong></div>
      <div class="stat"><span>💧 Umidità</span><strong>${Math.round(cond.humidity)}%</strong></div>
      <div class="stat"><span>☁️ Nuvole basse/medie/alte</span><strong>${Math.round(
        cond.cloudCoverLow
      )}/${Math.round(cond.cloudCoverMid)}/${Math.round(cond.cloudCoverHigh)}%</strong></div>
      ${
        cond.aerosol != null
          ? `<div class="stat"><span>🌫️ Aerosol · PM2.5</span><strong>${cond.aerosol.toFixed(
              2
            )} · ${cond.pm25 != null ? Math.round(cond.pm25) + ' µg/m³' : 'n/d'}</strong></div>`
          : ''
      }
      <div class="stat"><span>🌙 Luna</span><strong>${moonPhaseName(phase)}</strong></div>
    </section>

    <section>
      <h3>Punto analizzato</h3>
      <div class="map-wrap">${mapEmbedHtml(place.latitude, place.longitude)}</div>
      ${gridNote ? `<p class="muted map__note">${gridNote}</p>` : ''}
    </section>

    <section class="lookat">
      <div>
        <h3>Dove guardare</h3>
        <p class="muted">
          Il sole ${event === 'sunset' ? 'tramonterà' : 'sorgerà'} a
          <strong>${azimuthToCardinal(sun.azimuth)}</strong> (${Math.round(sun.azimuth)}°).
        </p>
      </div>
      ${compassSvg(sun.azimuth)}
    </section>

    ${spotsSectionHtml(place, sun)}

    <section>
      <h3>Andamento del cielo attorno all’${event === 'sunset' ? 'tramonto' : 'alba'}</h3>
      <div class="timeline">${timelineHtml}</div>
      <p class="muted tl__hint">Punteggio ora per ora — la colonna evidenziata è l’ora ${
        event === 'sunset' ? 'del tramonto' : 'dell’alba'
      }.</p>
    </section>

    <section>
      <h3>Perché questo punteggio</h3>
      <ul class="notes">${notesHtml}</ul>
    </section>
  `;

  const favBtn = card.querySelector('.fav-toggle');
  favBtn.addEventListener('click', () => {
    const saved = toggleFavorite(place);
    favBtn.textContent = saved ? '★' : '☆';
    favBtn.setAttribute('aria-pressed', String(saved));
    renderFavorites();
  });

  card.querySelector('.share-btn').addEventListener('click', () => shareCurrent(score));

  const scanBtn = card.querySelector('.scan-btn');
  if (scanBtn) scanBtn.addEventListener('click', scanCoordinates);

  els.results.appendChild(card);
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
  const eventNoun = EVENT_LABELS[state.event].noun.toLowerCase();
  const text = `SkyHue: ${eventNoun} a ${state.place.label} — punteggio ${score}/100`;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'SkyHue', text, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    setStatus('Link copiato negli appunti ✓', 'info');
  } catch {
    // Ultima spiaggia: mostra l'URL nella barra di stato.
    setStatus(url, 'info');
  }
}

/** Disegna la barra dei preferiti (chip cliccabili con rimozione). */
function renderFavorites() {
  const favs = getFavorites();
  els.favorites.innerHTML = favs
    .map(
      (f) => `
      <span class="fav-chip" data-id="${f.id}">
        <button class="fav-chip__load" data-load="${f.id}">${f.label}</button>
        <button class="fav-chip__del" data-del="${f.id}" title="Rimuovi" aria-label="Rimuovi">×</button>
      </span>`
    )
    .join('');

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
}

// --- Eventi UI -------------------------------------------------------------

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = els.input.value.trim();
  if (!query) return;
  setStatus('Ricerca località…', 'info');
  try {
    const matches = await geocode(query);
    if (matches.length === 0) {
      setStatus('Nessuna località trovata. Prova con un altro nome.', 'error');
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
    setStatus(`Errore: ${err.message}`, 'error');
  }
});

els.geoBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    setStatus('Geolocalizzazione non supportata dal browser.', 'error');
    return;
  }
  setStatus('Rilevamento posizione…', 'info');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      analyze({ latitude, longitude, label: `La tua posizione (${coordsLabel(latitude, longitude)})` });
    },
    (err) => setStatus(`Posizione non disponibile: ${err.message}`, 'error')
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

// Avvio: mostra i preferiti salvati e apre l'eventuale link condiviso.
renderFavorites();
initFromUrl();
