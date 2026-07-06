# 🌅 SkyHue — Sunset Score

Un'app web che stima **quanto sarà bello il prossimo tramonto** combinando
**dati meteo in tempo reale**, **dati astronomici** e un **algoritmo di
punteggio** con relativa **spiegazione in linguaggio naturale**.

Nessuna API key, nessun build step: solo HTML + CSS + JavaScript a moduli ES.
I dati arrivano da [Open-Meteo](https://open-meteo.com) — meteo, dati astronomici
e qualità dell'aria (gratuito, CORS abilitato).

## Cosa fa

1. **Località** — cerca una città (geocoding Open-Meteo) o usa la geolocalizzazione del browser.
2. **Meteo in tempo reale** — copertura nuvolosa bassa/media/alta, visibilità, umidità, temperatura all'ora dell'evento.
3. **Qualità dell'aria** — aerosol optical depth e PM2.5: un pulviscolo moderato accende i rossi, la foschia li spegne.
4. **Dati astronomici** — orario di alba/tramonto, azimut/direzione del sole (algoritmo solare NOAA), fase lunare.
5. **Sunset & Sunrise Score (0–100)** — punteggio con etichetta qualitativa, sia per il tramonto sia per l'alba.
6. **Previsione multi-giorno** — striscia dei prossimi 7 giorni, ognuno col suo punteggio.
7. **Timeline oraria** — andamento del punteggio nelle ore attorno all'evento.
8. **Spiegazione** — perché quel punteggio: _"nuvole basse all'orizzonte"_, _"nuvole alte favorevoli"_, _"visibilità eccellente"_, _"foschia da particolato"_, ecc.
9. **Anteprima del cielo** — un gradiente che simula i colori attesi in base a punteggio, nuvole e aerosol.
10. **Bussola del sole** — dove guardare all'orizzonte (azimut sorgere/tramontare).
11. **Mappa del punto** — mini-mappa Leaflet del punto analizzato con **marker colorato per punteggio** e un **raggio verso il sole** (dove guarderà all'orizzonte), più coordinate richieste e cella di griglia meteo effettiva.
12. **Preferiti** — salva le tue località (localStorage) e ricaricale con un tap.
13. **Condivisione** — link diretto alla località+evento (Web Share API o copia link).
14. **Dove andare a guardarlo** — punti panoramici vicini da OpenStreetMap (viewpoint, fari, promontori, spiagge) **valutati qualitativamente**: si campiona la quota del terreno lungo il raggio verso il sole (Elevation API di Open-Meteo) per stimare se l'orizzonte è libero o ostruito e se c'è mare aperto (raggio ~25 km, con stima dei minuti in auto). Ogni meta mostra **due punteggi distinti**: l'**affaccio** (il numero grande — quanto è buona la *vista*: orizzonte libero, mare aperto, tipo di luogo; indipendente dal meteo) e il **cielo** (chip 🌅 — il *Sunset Score* calcolato col meteo di quel punto specifico). Per le mete finaliste i due punteggi vengono **combinati** nel ranking (l'affaccio pesa di più; il cielo, quasi uniforme sull'area, affina l'ordine). Su richiesta, una **stima da coordinate** (griglia + quote) propone anche punti *non mappati* su OSM, valutandone l'affaccio.
15. **Schermata mappa** (`#map`) — mappa interattiva (Leaflet, caricato on-demand): **tocca un punto qualsiasi** e ottieni Sunset Score, direzione del sole e affaccio in quel punto, poi apri il dettaglio completo.

## Come funziona il punteggio

Il tramonto migliore richiede **nuvole alte/medie parziali** (i cirri catturano
il colore), **orizzonte libero da nuvole basse** (che bloccherebbero il sole) e
**atmosfera limpida**. L'algoritmo (`src/score.js`):

- parte da una **base garantita** (0,35): anche un cielo terso "vale" qualcosa;
- premia con una curva a campana le **nuvole alte (~50%)** e **medie (~45%)** → _drama_;
- valuta la **trasparenza** da visibilità e umidità → _clarity_;
- applica una **penalità moltiplicativa** per le **nuvole basse** (bloccano l'orizzonte);
- penalizza l'**overcast del deck opaco** (nuvole basse+medie che coprono il cielo):
  i **cirri alti**, anche fitti, restano traslucidi e **non** contano come overcast;
- modula col **pulviscolo** (`aerosol`): moderato accende i rossi, eccessivo li spegne.

```
raw   = 100 · (0,35 + 0,45·drama + 0,20·clarity)          // 0,35 = base garantita
score = raw · (1 − 0,85·nuvole_basse) · (1 − 0,9·overcast) · aerosol
```

Un cielo terso vale ~55 (bello ma piatto); cirri parziali con orizzonte libero
salgono a 75–95; nuvole basse fitte o cielo coperto crollano sotto 25.

## Avvio

Serve un piccolo static server (i moduli ES non si aprono da `file://`):

```bash
# opzione 1 — Python
python3 -m http.server 8000
# opzione 2 — npm (usa lo stesso comando)
npm start
```

Poi apri <http://localhost:8000>.

## Test

L'algoritmo è puro e testabile senza rete o browser:

```bash
npm test        # oppure: node --test
```

## Struttura

```
index.html            markup dell'app + registrazione service worker
manifest.webmanifest  PWA: installabile su home screen
sw.js                 service worker: guscio offline + cache API
icon.svg              icona dell'app
src/styles.css        tema "tramonto"
src/api.js            Open-Meteo: geocoding, previsioni, qualità dell'aria
src/astronomy.js      posizione solare (NOAA), fase lunare
src/score.js          algoritmo Sunset Score + spiegazione  ← cuore testabile
src/sky.js            palette del cielo previsto (gradiente)
src/spots.js          punti panoramici vicini (OpenStreetMap/Overpass)
src/store.js          preferiti in localStorage
src/cache.js          cache in memoria (TTL) delle risposte di rete
src/main.js           orchestrazione e rendering
test/score.test.js    test dell'algoritmo
test/sky.test.js      test della palette
test/spots.test.js    test di distanza/rilevamento
test/cache.test.js    test della cache (TTL, riuso, errori)
```

## Mappa interattiva & performance

Sulla schermata mappa (`#map`) ogni tap valuta il punto (meteo, aria, quote del
terreno e punti Overpass nel raggio di 25 km). Toccando più punti in sequenza:

- le richieste della valutazione **precedente vengono annullate** (`AbortController`)
  invece di accumularsi — comprese le costose query Overpass — così la rete non
  si satura e vince sempre l'ultimo tap;
- le risposte sono messe in **cache in memoria** (`src/cache.js`) per coordinate
  arrotondate: ritoccare la stessa zona è immediato e non re-interroga Overpass.
  Le quote del terreno (immutabili) e i POI (quasi statici) hanno TTL lunghi; il
  meteo e la qualità dell'aria ~30 min.

## PWA & offline

L'app è installabile (Aggiungi a schermata Home) e funziona offline: il
service worker mette in cache il guscio e l'ultima risposta delle API, così
l'ultima località resta consultabile senza rete.

## Licenza

MIT
