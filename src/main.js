// main.js — orchestrazione: geolocalizzazione/ricerca → previsioni → punteggio → UI.
import { geocode, fetchForecast, conditionsAtTime, nextSunset, coordsLabel } from './api.js';
import { computeSunsetScore, scoreLabel, explainScore } from './score.js';
import { sunPosition, azimuthToCardinal, moonPhase, moonPhaseName } from './astronomy.js';

const els = {
  form: document.getElementById('search-form'),
  input: document.getElementById('search-input'),
  geoBtn: document.getElementById('geo-btn'),
  results: document.getElementById('results'),
  status: document.getElementById('status'),
};

function setStatus(msg, kind = 'info') {
  els.status.textContent = msg || '';
  els.status.dataset.kind = kind;
}

/** Analizza una località (lat/lon con etichetta) e mostra il risultato. */
async function analyze(place) {
  setStatus(`Recupero dati per ${place.label}…`, 'info');
  els.results.innerHTML = '';
  try {
    const forecast = await fetchForecast(place.latitude, place.longitude);
    const now = new Date();
    const { sunset } = nextSunset(forecast, now);
    const cond = conditionsAtTime(forecast, sunset);
    const { score, factors } = computeSunsetScore(cond);
    const notes = explainScore(factors);

    const sunsetDate = new Date(sunset);
    const sun = sunPosition(sunsetDate, place.latitude, place.longitude);
    const phase = moonPhase(sunsetDate);

    renderResult({ place, sunset: sunsetDate, cond, score, notes, sun, phase });
    setStatus('', 'info');
  } catch (err) {
    console.error(err);
    setStatus(`Errore: ${err.message}`, 'error');
  }
}

function fmtTime(date) {
  return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function fmtDay(date) {
  return date.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
}

function renderResult({ place, sunset, cond, score, notes, sun, phase }) {
  const card = document.createElement('article');
  card.className = 'card';

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
        <h2>${place.label}</h2>
        <p class="muted">Tramonto di ${fmtDay(sunset)} · ore ${fmtTime(sunset)}</p>
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
      <div class="stat"><span>🌙 Luna</span><strong>${moonPhaseName(phase)}</strong></div>
    </section>

    <section>
      <h3>Perché questo punteggio</h3>
      <ul class="notes">${notesHtml}</ul>
    </section>
  `;

  els.results.appendChild(card);
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
