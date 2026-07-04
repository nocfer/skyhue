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
11. **Mappa del punto** — mini-mappa OpenStreetMap del punto analizzato, con coordinate richieste e cella di griglia meteo effettiva.
12. **Preferiti** — salva le tue località (localStorage) e ricaricale con un tap.
13. **Condivisione** — link diretto alla località+evento (Web Share API o copia link).
14. **Dove andare a guardarlo** — punti panoramici vicini da OpenStreetMap (viewpoint, fari, promontori, spiagge) **valutati qualitativamente**: si campiona la quota del terreno lungo il raggio verso il sole (Elevation API di Open-Meteo) per stimare se l'orizzonte è libero o ostruito e se c'è mare aperto; i punti sono ordinati per qualità dell'affaccio (raggio ~25 km, con stima dei minuti in auto). Per le mete finaliste viene calcolato anche il **Sunset Score direttamente nel punto**.

## Come funziona il punteggio

Il tramonto migliore richiede **nuvole alte/medie parziali** (i cirri catturano
il colore), **orizzonte libero da nuvole basse** (che bloccherebbero il sole) e
**atmosfera limpida**. L'algoritmo (`src/score.js`):

- premia con una curva a campana le **nuvole alte (~50%)** e **medie (~45%)** → _drama_;
- valuta la **trasparenza** da visibilità e umidità → _clarity_;
- applica una **penalità moltiplicativa** per le **nuvole basse** (bloccano l'orizzonte);
- penalizza il **cielo completamente coperto** (poca luce diretta).

```
raw   = 100 · (0,35·base + 0,45·drama + 0,20·clarity)
score = raw · (1 − 0,85·nuvole_basse) · (1 − 0,9·overcast)
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
src/main.js           orchestrazione e rendering
test/score.test.js    test dell'algoritmo
test/sky.test.js      test della palette
test/spots.test.js    test di distanza/rilevamento
```

## PWA & offline

L'app è installabile (Aggiungi a schermata Home) e funziona offline: il
service worker mette in cache il guscio e l'ultima risposta delle API, così
l'ultima località resta consultabile senza rete.

## Licenza

MIT
