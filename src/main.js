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
};

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
    state.forecast = forecast;
    state.air = air;
    state.dayIndex = dayIndex;
    render();
    setStatus('', 'info');
  } catch (err) {
    console.error(err);
    setStatus(`Errore: ${err.message}`, 'error');
  }
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

  return { day, eventDate, cond, score, notes, sun, phase, timeline };
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

function renderDetail({ eventDate, cond, score, notes, sun, phase, timeline }) {
  const { place, event } = state;
  const label = EVENT_LABELS[event];
  const card = document.createElement('article');
  card.className = 'card';

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
        </h2>
        <p class="muted">${label.prep} ${fmtDay(eventDate)} · ore ${fmtTime(eventDate)}</p>
      </div>
      <div class="gauge" style="--score:${score}">
        <div class="gauge__value">${score}</div>
        <div class="gauge__label">${scoreLabel(score)}</div>
      </div>
    </header>

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

  els.results.appendChild(card);
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
  });
});

// Avvio: mostra i preferiti salvati.
renderFavorites();
