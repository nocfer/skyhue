// map.js — schermata mappa dedicata: tocca un punto e valuta tramonto + affaccio.
// Leaflet viene caricato in modo lazy (solo alla prima apertura della mappa),
// così l'app principale resta leggera e senza dipendenze esterne.
import { fetchForecast, fetchAirQuality, nextSunset, conditionsAtTime, airAtTime } from './api.js';
import { computeSunsetScore, scoreLabel } from './score.js';
import { sunPosition, azimuthToCardinal } from './astronomy.js';
import {
  destinationPoint,
  SAMPLE_DISTANCES,
  evaluateHorizon,
  spotVerdict,
  fetchElevations,
} from './spots.js';

const LEAFLET_CSS = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';

const els = {
  appView: document.getElementById('app-view'),
  mapView: document.getElementById('map-view'),
  canvas: document.getElementById('leaflet'),
  panel: document.getElementById('map-panel'),
  back: document.getElementById('map-back'),
};

let map = null;
let marker = null;
let leafletLoading = null;
let evalToken = 0; // per ignorare valutazioni superate da un nuovo tap

/** Carica Leaflet (CSS+JS) una sola volta, restituendo il global L. */
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletLoading) return leafletLoading;
  leafletLoading = new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = LEAFLET_CSS;
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = LEAFLET_JS;
    script.onload = () => resolve(window.L);
    script.onerror = () => reject(new Error('Impossibile caricare la mappa'));
    document.head.appendChild(script);
  });
  return leafletLoading;
}

function fmtTime(date) {
  return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

/** Centro iniziale: ultima località analizzata, altrimenti centro Italia. */
function initialCenter() {
  const p = window.skyhueLastPlace;
  if (p && Number.isFinite(p.latitude)) return { lat: p.latitude, lon: p.longitude, zoom: 12 };
  return { lat: 41.9, lon: 12.5, zoom: 6 };
}

async function ensureMap() {
  const L = await loadLeaflet();
  if (map) {
    map.invalidateSize();
    return;
  }
  const c = initialCenter();
  map = L.map(els.canvas).setView([c.lat, c.lon], c.zoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap',
  }).addTo(map);
  map.on('click', (e) => selectPoint(e.latlng.lat, e.latlng.lng));
}

/** Gestisce il tap su un punto: posiziona il marker e avvia la valutazione. */
async function selectPoint(lat, lon) {
  const L = window.L;
  if (marker) marker.setLatLng([lat, lon]);
  else marker = L.circleMarker([lat, lon], { radius: 9, color: '#ff8a5c', weight: 3, fillOpacity: 0.5 }).addTo(map);
  await evaluatePoint(lat, lon);
}

/** Valuta un punto: Sunset Score, direzione del sole e affaccio verso il sole. */
async function evaluatePoint(lat, lon) {
  const token = ++evalToken;
  els.panel.hidden = false;
  els.panel.innerHTML = `<p class="muted">Calcolo il tramonto e l’affaccio in questo punto…</p>`;
  try {
    const [forecast, air] = await Promise.all([
      fetchForecast(lat, lon),
      fetchAirQuality(lat, lon).catch(() => null),
    ]);
    const { sunset } = nextSunset(forecast, new Date());
    const cond = { ...conditionsAtTime(forecast, sunset), ...airAtTime(air, sunset) };
    const { score } = computeSunsetScore(cond);
    const sunsetDate = new Date(sunset);
    const sun = sunPosition(sunsetDate, lat, lon);

    // Affaccio: campiona il terreno lungo il raggio verso il sole.
    let horizon = null;
    try {
      const pts = SAMPLE_DISTANCES.map((d) =>
        d === 0 ? { lat, lon } : destinationPoint(lat, lon, sun.azimuth, d)
      );
      const el = await fetchElevations(pts);
      const ahead = SAMPLE_DISTANCES.slice(1).map((distKm, k) => ({ distKm, elev: el[k + 1] }));
      horizon = evaluateHorizon(el[0], ahead);
    } catch (err) {
      console.warn('Quote non disponibili per l’affaccio:', err);
    }
    const verdict = spotVerdict('viewpoint', horizon);

    if (token !== evalToken) return; // superato da un tap più recente
    renderPanel({ lat, lon, sunsetDate, score, sun, verdict });
  } catch (err) {
    if (token !== evalToken) return;
    els.panel.innerHTML = `<p class="muted">Dati non disponibili per questo punto. Riprova.</p>`;
  }
}

function renderPanel({ lat, lon, sunsetDate, score, sun, verdict }) {
  const hue = Math.round((score / 100) * 120);
  els.panel.innerHTML = `
    <div class="mp__head">
      <div class="mp__score" style="--hue:${hue}">${score}</div>
      <div>
        <strong>${scoreLabel(score)}</strong>
        <p class="muted">Tramonto ore ${fmtTime(sunsetDate)} · sole verso ${azimuthToCardinal(
    sun.azimuth
  )} (${Math.round(sun.azimuth)}°)</p>
      </div>
    </div>
    <p class="mp__verdict spot--${verdict.sentiment}">${verdict.icon} ${verdict.label}</p>
    <button id="mp-open" class="mp__open">Apri dettaglio completo →</button>
  `;
  const open = document.getElementById('mp-open');
  open.addEventListener('click', () => {
    window.dispatchEvent(
      new CustomEvent('skyhue:analyze', {
        detail: {
          latitude: lat,
          longitude: lon,
          label: `Punto sulla mappa (${lat.toFixed(3)}, ${lon.toFixed(3)})`,
        },
      })
    );
    goToApp();
  });
}

// --- Routing tra le due schermate --------------------------------------------

function showMap() {
  els.appView.hidden = true;
  els.mapView.hidden = false;
  ensureMap().catch(() => {
    els.panel.hidden = false;
    els.panel.innerHTML = `<p class="muted">Impossibile caricare la mappa (serve connessione).</p>`;
  });
}

function goToApp() {
  if (location.hash === '#map') location.hash = '';
  else applyRoute();
}

function applyRoute() {
  if (location.hash === '#map') {
    showMap();
  } else {
    els.mapView.hidden = true;
    els.appView.hidden = false;
  }
}

if (els.mapView) {
  window.addEventListener('hashchange', applyRoute);
  if (els.back) els.back.addEventListener('click', () => history.back());
  applyRoute();
}
