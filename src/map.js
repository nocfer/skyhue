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
  horizonDistanceKm,
  nearbySpots,
  kindInfo,
} from './spots.js';
import { icon } from './icons.js';
import { t, cardinal, getLang } from './i18n.js';

const LEAFLET_CSS = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';

// Basemap CartoDB (niente API key): scuro (Dark Matter) col tema scuro, chiaro
// (Positron) col tema chiaro, così la mappa segue il tema dell'app.
const TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const TILE_OPTS = {
  subdomains: 'abcd',
  maxZoom: 20,
  attribution: '© OpenStreetMap © CARTO',
};

/** URL dei tile in base al tema corrente dell'app. */
function tileUrl() {
  return document.documentElement.dataset.theme === 'light' ? TILE_LIGHT : TILE_DARK;
}

const els = {
  appView: document.getElementById('app-view'),
  mapView: document.getElementById('map-view'),
  canvas: document.getElementById('leaflet'),
  panel: document.getElementById('map-panel'),
  back: document.getElementById('map-back'),
};

let map = null;
let marker = null;
let visCircle = null; // cerchio di visibilità sul punto toccato
let contextLayer = null; // overlay del punto analizzato + punti suggeriti
let tapLayer = null; // overlay completi del punto toccato (sole, raggio, visibilità, punti)
let legendControl = null; // legenda dei simboli (montata una sola volta)
let bigTile = null; // layer dei tile della mappa grande (per scambio tema)
let leafletLoading = null;
let evalToken = 0; // per ignorare valutazioni superate da un nuovo tap
let evalAbort = null; // annulla le richieste di una valutazione superata da un nuovo tap

/** Carica Leaflet (CSS+JS) una sola volta, restituendo il global L. */
export function loadLeaflet() {
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

/** Colore in tinta col punteggio (stessa rampa calda del resto dell'app). */
function scoreColor(score) {
  return `hsl(${Math.round(10 + (score / 100) * 36)}, 80%, 58%)`;
}

// Colori dei punti suggeriti per qualità dell'affaccio (caldo, in tinta col tema).
const SENT = { good: '#6ee7a8', bad: '#ff7a8a', neutral: '#ffd479' };

/** Popup ricco per un punto suggerito: nome, affaccio, cielo, distanza, link OSM. */
function spotPopupHtml(s) {
  const scores = [];
  if (s.verdict?.score != null) scores.push(`${t('mappop.view')} <strong>${s.verdict.score}</strong>`);
  if (s.skyScore != null) scores.push(`${t('mappop.sky')} <strong>${s.skyScore}</strong>`);
  const meta = [];
  if (Number.isFinite(s.dist))
    meta.push(`${s.dist < 10 ? s.dist.toFixed(1) : Math.round(s.dist)} ${t('unit.km')}`);
  if (s.dir) meta.push(t('mappop.towards', { dir: cardinal(s.dir) }));
  if (Number.isFinite(s.driveMin)) meta.push(`~${s.driveMin} ${t('unit.min')}`);
  const url = `https://www.openstreetmap.org/?mlat=${s.lat.toFixed(5)}&mlon=${s.lon.toFixed(
    5
  )}#map=15/${s.lat.toFixed(4)}/${s.lon.toFixed(4)}`;
  const name = s.name || t(kindInfo(s.kind).labelKey);
  return `<div class="mappop">
    <strong class="mappop__name">${name}</strong>
    ${scores.length ? `<div class="mappop__scores">${scores.join(' · ')}</div>` : ''}
    ${s.verdict?.code ? `<div class="mappop__verdict spot--${s.verdict.sentiment}">${t('verdict.' + s.verdict.code)}</div>` : ''}
    ${meta.length ? `<div class="mappop__meta">${meta.join(' · ')}</div>` : ''}
    <a href="${url}" target="_blank" rel="noopener">${t('spot.openOsm')}</a>
  </div>`;
}

/**
 * Disegna tutti gli overlay del "tramonto" in un gruppo Leaflet: raggio verso il
 * sole (alone + tratteggio), sole all'orizzonte, cerchio di visibilità, marker dei
 * punti suggeriti e marker del punto analizzato. Condiviso tra mini-mappa e mappa
 * grande così i due si comportano allo stesso modo.
 * @param {*} L Leaflet
 * @param {*} group featureGroup su cui aggiungere i layer
 * @param {{lat,lon,azimuth,score,event,visibility,spots,onSpotClick?}} o
 */
function buildSunsetOverlays(L, group, { lat, lon, azimuth, score, event, visibility, spots, onSpotClick }) {
  const color = scoreColor(score);
  const end = destinationPoint(lat, lon, azimuth, 12); // ~12 km verso il sole
  const ray = [
    [lat, lon],
    [end.lat, end.lon],
  ];
  // Raggio verso il sole: alone caldo morbido + linea tratteggiata luminosa.
  L.polyline(ray, { color: '#ffce6f', weight: 9, opacity: 0.16, lineCap: 'round' }).addTo(group);
  L.polyline(ray, { color, weight: 2.5, opacity: 0.95, dashArray: '1 8', lineCap: 'round' }).addTo(
    group
  );

  // Cerchio di visibilità: fin dove l'atmosfera lascia vedere nitido.
  if (Number.isFinite(visibility) && visibility > 0) {
    L.circle([lat, lon], {
      radius: visibility,
      color: '#8fd0ff',
      weight: 1,
      opacity: 0.5,
      fillColor: '#8fd0ff',
      fillOpacity: 0.06,
      dashArray: '4 6',
    }).addTo(group);
  }

  // Marker dei punti suggeriti, colorati per qualità dell'affaccio.
  (spots || []).forEach((s) => {
    const c = SENT[s.verdict?.sentiment] || '#ffd479';
    const m = L.marker([s.lat, s.lon], {
      icon: L.divIcon({
        className: 'spotmark',
        html: `<span class="spotmark__dot" style="--c:${c}"></span>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      }),
    })
      .addTo(group)
      .bindPopup(spotPopupHtml(s));
    if (onSpotClick) m.on('click', () => onSpotClick(s));
  });

  // Il sole all'orizzonte, alla fine del raggio (glow via CSS).
  L.marker([end.lat, end.lon], {
    icon: L.divIcon({
      className: 'sunmark',
      html: '<span class="sunmark__glow"></span>',
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    }),
    interactive: false,
    keyboard: false,
  }).addTo(group);

  // Punto analizzato: bolla del punteggio (oro, testo scuro) sopra un pallino in
  // tinta col punteggio, con anello bianco e alone.
  L.marker([lat, lon], {
    icon: L.divIcon({
      className: 'skymark',
      html: `<span class="skymark__score">${score}</span><span class="skymark__dot" style="--c:${color}"></span>`,
      iconSize: [44, 48],
      iconAnchor: [22, 44],
    }),
  })
    .addTo(group)
    .bindPopup(
      t('map.markerPopup', {
        score,
        event: t('event.' + (event === 'sunrise' ? 'sunrise' : 'sunset')),
        dir: cardinal(azimuthToCardinal(azimuth)),
        deg: Math.round(azimuth),
      })
    );
}

// Mini-mappa del dettaglio: una sola istanza Leaflet, riusata finché il punto
// non cambia (render() ricostruisce la card più volte mentre arrivano i dati).
let mini = { map: null, container: null, key: null, tile: null };

/**
 * Monta (o riusa) una mini-mappa Leaflet dentro `mount`: tile OSM, marker
 * colorato per punteggio e un raggio tratteggiato verso l'azimut del sole, così
 * si vede a colpo d'occhio dove guarderà il sole all'orizzonte.
 * @param {HTMLElement} mount contenitore (già dimensionato) in cui montare
 * @param {{lat:number, lon:number, azimuth:number, score:number, event:string}} o
 */
export async function mountMiniMap(mount, { lat, lon, azimuth, score, event, visibility, spots, onExpand }) {
  if (!mount) return;
  const L = await loadLeaflet(); // memoizzato: il primo await è l'unico costo di rete
  const spotSig = (spots || []).length;
  const key = `${lat.toFixed(4)}|${lon.toFixed(4)}|${Math.round(azimuth)}|${score}|${event}|${Math.round(
    visibility || 0
  )}|${spotSig}|${getLang()}`;

  // Stesso stato di un render precedente: sposta il container esistente nel
  // nuovo nodo (le render sono sequenziali → l'ultima, quella viva, vince).
  if (mini.container && mini.key === key) {
    mount.appendChild(mini.container);
    mini.map.invalidateSize();
    return;
  }

  // Stato diverso (o primo montaggio): ricostruisci.
  if (mini.map) mini.map.remove();
  const container = document.createElement('div');
  container.className = 'map';
  mount.appendChild(container);
  const map = L.map(container, {
    zoomControl: false,
    dragging: false, // preview statica: non intrappola lo scroll della pagina
    scrollWheelZoom: false,
    doubleClickZoom: false,
    keyboard: false,
  }).setView([lat, lon], 12);
  compactAttribution(L, map);
  const tile = L.tileLayer(tileUrl(), TILE_OPTS).addTo(map);
  const overlays = L.featureGroup().addTo(map);

  buildSunsetOverlays(L, overlays, { lat, lon, azimuth, score, event, visibility, spots });

  // Un click sull'area della mappa (non su un marker: Leaflet non propaga i click
  // dei marker al 'click' della mappa) espande alla mappa grande in-app.
  if (onExpand) {
    container.classList.add('map-slot--clickable');
    map.on('click', onExpand);
  }

  // Inquadra tutto (punto, raggio, cerchio di visibilità, punti suggeriti).
  map.fitBounds(overlays.getBounds(), { padding: [28, 28], maxZoom: 12 });

  mini = { map, container, key, tile };
}

/** Centro iniziale: ultima località analizzata, altrimenti centro Italia. */
function initialCenter() {
  const p = window.skyhueLastPlace;
  if (p && Number.isFinite(p.latitude)) return { lat: p.latitude, lon: p.longitude, zoom: 12 };
  return { lat: 41.9, lon: 12.5, zoom: 6 };
}

/**
 * Comprime l'attribuzione a un'icona "ⓘ" espandibile al tap (o su hover da
 * desktop). Il credito OSM/CARTO resta presente — è obbligatorio dalle
 * condizioni d'uso — ma non ingombra la mappa. Rimuove anche il prefisso
 * "Leaflet" di default.
 */
function compactAttribution(L, m) {
  m.attributionControl.setPrefix(false);
  const el = m.attributionControl.getContainer();
  if (!el) return;
  el.classList.add('attr-collapsed');
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.setAttribute('aria-label', t('map.attribution'));
  // Non far propagare il tap alla mappa (eviterebbe un falso "punto scelto").
  L.DomEvent.disableClickPropagation(el);
  const toggle = () => el.classList.toggle('attr-open');
  L.DomEvent.on(el, 'click', (e) => {
    if (e.target.closest('a')) return; // lascia aprire i link del credito
    toggle();
  });
  L.DomEvent.on(el, 'keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  });
}

async function ensureMap() {
  const L = await loadLeaflet();
  if (map) return;
  const c = initialCenter();
  map = L.map(els.canvas, { zoomControl: true }).setView([c.lat, c.lon], c.zoom);
  compactAttribution(L, map);
  bigTile = L.tileLayer(tileUrl(), TILE_OPTS).addTo(map);
  map.on('click', (e) => selectPoint(e.latlng.lat, e.latlng.lng));
  addLegend(L);
}

/** Legenda dei simboli, montata una sola volta come control Leaflet. */
function addLegend(L) {
  if (legendControl) return;
  const Legend = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd() {
      const el = L.DomUtil.create('details', 'maplegend');
      el.open = true;
      el.innerHTML = `
        <summary class="maplegend__title">${t('map.legend')}</summary>
        <div class="maplegend__body">
          <div class="maplegend__row"><span class="maplegend__ico maplegend__ico--point"></span> ${t('map.legend.point')}</div>
          <div class="maplegend__row"><span class="maplegend__ico maplegend__ico--sun"></span> ${t('map.legend.sun')}</div>
          <div class="maplegend__row"><span class="maplegend__ico maplegend__ico--ray"></span> ${t('map.legend.ray')}</div>
          <div class="maplegend__row"><span class="maplegend__dot" style="--c:${SENT.good}"></span> ${t('map.legend.good')}</div>
          <div class="maplegend__row"><span class="maplegend__dot" style="--c:${SENT.neutral}"></span> ${t('map.legend.neutral')}</div>
          <div class="maplegend__row"><span class="maplegend__dot" style="--c:${SENT.bad}"></span> ${t('map.legend.bad')}</div>
          <div class="maplegend__row"><span class="maplegend__ico maplegend__ico--vis"></span> ${t('map.legend.visibility')}</div>
        </div>`;
      // Non far passare click/scroll dalla legenda alla mappa sottostante.
      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.disableScrollPropagation(el);
      return el;
    },
  });
  legendControl = new Legend();
  legendControl.addTo(map);
}

/**
 * Disegna sul canvas grande il contesto ricevuto da main.js (`skyhueMapContext`):
 * punto analizzato, raggio verso il sole, cerchio di visibilità e TUTTI i punti
 * suggeriti (cliccabili per essere valutati), poi inquadra il tutto. Ricostruito
 * ad ogni apertura così, cambiando località, non restano marker vecchi.
 */
function renderContext() {
  if (!map || !window.L) return;
  const L = window.L;

  // Ripulisci lo stato del tap precedente e il contesto precedente.
  if (contextLayer) {
    contextLayer.remove();
    contextLayer = null;
  }
  if (tapLayer) {
    tapLayer.remove();
    tapLayer = null;
  }
  if (marker) {
    map.removeLayer(marker);
    marker = null;
  }
  if (visCircle) {
    map.removeLayer(visCircle);
    visCircle = null;
  }

  const ctx = window.skyhueMapContext;
  if (!ctx || !Number.isFinite(ctx.lat)) return;

  contextLayer = L.featureGroup().addTo(map);
  buildSunsetOverlays(L, contextLayer, {
    lat: ctx.lat,
    lon: ctx.lon,
    azimuth: ctx.azimuth,
    score: ctx.score,
    event: ctx.event,
    visibility: ctx.visibility,
    spots: ctx.spots,
    onSpotClick: (s) => selectPoint(s.lat, s.lon),
  });

  const bounds = contextLayer.getBounds();
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [42, 42], maxZoom: 13, animate: false });
}

/** Gestisce il tap su un punto: posiziona il marker, vola sul punto e valuta. */
async function selectPoint(lat, lon) {
  const L = window.L;
  if (marker) marker.setLatLng([lat, lon]);
  else
    marker = L.circleMarker([lat, lon], {
      radius: 9,
      color: '#ff8a5c',
      weight: 3,
      fillColor: '#ff8a5c',
      fillOpacity: 0.5,
      className: 'tapmark',
    }).addTo(map);
  marker.bringToFront();
  // Transizione morbida verso il punto scelto (senza sfilare troppo lo zoom).
  map.flyTo([lat, lon], Math.max(map.getZoom(), 12), { duration: 0.6 });
  await evaluatePoint(lat, lon);
}

/** Valuta un punto: Sunset Score, direzione del sole e affaccio verso il sole. */
async function evaluatePoint(lat, lon) {
  // Annulla la valutazione precedente ancora in corso: toccando più punti in
  // sequenza, le richieste superate (incluse le costose query Overpass) vengono
  // interrotte invece di accumularsi e saturare la rete.
  if (evalAbort) evalAbort.abort();
  evalAbort = new AbortController();
  const { signal } = evalAbort;
  const token = ++evalToken;
  els.panel.hidden = false;
  els.panel.innerHTML = `<p class="muted">${t('mp.calc')}</p>`;
  try {
    const [forecast, air] = await Promise.all([
      fetchForecast(lat, lon, { signal }),
      fetchAirQuality(lat, lon, { signal }).catch(() => null),
    ]);
    const { sunset } = nextSunset(forecast, new Date());
    const cond = { ...conditionsAtTime(forecast, sunset), ...airAtTime(air, sunset) };
    const { score } = computeSunsetScore(cond);
    const sunsetDate = new Date(sunset);
    const sun = sunPosition(sunsetDate, lat, lon);

    // Affaccio del punto toccato + ricerca dei punti suggeriti nei dintorni,
    // così sulla mappa compaiono tutti gli elementi della legenda.
    let horizon = null;
    let spots = [];
    try {
      const pts = SAMPLE_DISTANCES.map((d) =>
        d === 0 ? { lat, lon } : destinationPoint(lat, lon, sun.azimuth, d)
      );
      const [el, near] = await Promise.all([
        fetchElevations(pts, { signal }),
        nearbySpots(lat, lon, sun.azimuth, { signal }).catch((err) => {
          if (err?.name === 'AbortError') throw err; // valutazione superata
          return [];
        }),
      ]);
      const ahead = SAMPLE_DISTANCES.slice(1).map((distKm, k) => ({ distKm, elev: el[k + 1] }));
      horizon = evaluateHorizon(el[0], ahead);
      spots = near;
    } catch (err) {
      if (err?.name === 'AbortError' || signal.aborted) return; // superata da un nuovo tap
      console.warn('Quote/punti non disponibili:', err);
    }
    const verdict = spotVerdict('viewpoint', horizon);

    if (token !== evalToken) return; // superato da un tap più recente

    // Overlay completi del punto toccato: punto + raggio + sole + cerchio di
    // visibilità + marker dei punti suggeriti (coerenti con la legenda).
    if (tapLayer) {
      tapLayer.remove();
      tapLayer = null;
    }
    if (visCircle) {
      map.removeLayer(visCircle);
      visCircle = null;
    }
    if (marker) {
      map.removeLayer(marker); // sostituito dal pallino colorato per punteggio
      marker = null;
    }
    tapLayer = window.L.featureGroup().addTo(map);
    buildSunsetOverlays(window.L, tapLayer, {
      lat,
      lon,
      azimuth: sun.azimuth,
      score,
      event: 'sunset',
      visibility: cond.visibility,
      spots,
      onSpotClick: (s) => selectPoint(s.lat, s.lon),
    });

    renderPanel({
      lat,
      lon,
      sunsetDate,
      score,
      sun,
      verdict,
      visibility: cond.visibility,
      elevation: forecast.elevation,
    });
  } catch (err) {
    if (err?.name === 'AbortError' || signal.aborted || token !== evalToken) return;
    els.panel.innerHTML = `<p class="muted">${t('mp.na')}</p>`;
  }
}

function renderPanel({ lat, lon, sunsetDate, score, sun, verdict, visibility, elevation }) {
  const hue = Math.round(10 + (score / 100) * 36);
  const coords = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} · ${Math.abs(lon).toFixed(
    2
  )}°${lon >= 0 ? 'E' : 'W'}`;
  const dir = cardinal(azimuthToCardinal(sun.azimuth));
  els.panel.innerHTML = `
    <span class="mp__handle" aria-hidden="true"></span>
    <div class="mp__head">
      <span class="mp__thumb" style="background:var(--sky-swatch)"><span class="mp__sundot"></span></span>
      <div class="mp__title">
        <strong>${t('map.pointName')}</strong>
        <span class="mp__coords mono">${coords}</span>
      </div>
      <div class="mp__scorebox">
        <span class="mp__score display" style="--hue:${hue}">${score}</span>
        <span class="mp__label">${t('label.' + scoreLabel(score))}</span>
      </div>
    </div>
    <p class="mp__verdict spot--${verdict.sentiment}">${icon(verdict.icon, { size: 16 })} ${t(
    'verdict.' + verdict.code
  )} — ${t('mappop.towards', { dir })} (${Math.round(sun.azimuth)}°)</p>
    <button id="mp-open" class="mp__open">${t('mp.openDetail')}</button>
  `;
  const open = document.getElementById('mp-open');
  open.addEventListener('click', () => {
    window.dispatchEvent(
      new CustomEvent('skyhue:analyze', {
        detail: {
          latitude: lat,
          longitude: lon,
          label: t('map.pointLabel', { lat: lat.toFixed(3), lon: lon.toFixed(3) }),
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
  // Nasconde il pannello del tap precedente: la mappa si apre "pulita".
  els.panel.hidden = true;
  ensureMap()
    .then(() => {
      // Il canvas è appena diventato visibile: ricalcola le dimensioni prima di
      // disegnare/ inquadrare, altrimenti Leaflet parte con dimensione 0.
      map.invalidateSize();
      renderContext();
    })
    .catch(() => {
      els.panel.hidden = false;
      els.panel.innerHTML = `<p class="muted">${t('map.loadError')}</p>`;
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

// Cambio tema: scambia i tile chiari/scuri sulla mappa grande e sulla mini-mappa
// (gli overlay sono in tinta calda, coerenti con entrambi i temi).
window.addEventListener('skyhue:themechange', () => {
  const url = tileUrl();
  if (bigTile) bigTile.setUrl(url);
  if (mini.tile) mini.tile.setUrl(url);
});

// Cambio lingua: rigenera la legenda e ridisegna il contesto (i popup e il
// pannello si ricreano con le nuove stringhe alla prossima interazione/tap).
window.addEventListener('skyhue:langchange', () => {
  if (!map || !window.L) return;
  if (legendControl) {
    map.removeControl(legendControl);
    legendControl = null;
  }
  addLegend(window.L);
  renderContext();
});
