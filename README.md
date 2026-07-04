# 🌅 SkyHue — Sunset Score

Un'app web che stima **quanto sarà bello il prossimo tramonto** combinando
**dati meteo in tempo reale**, **dati astronomici** e un **algoritmo di
punteggio** con relativa **spiegazione in linguaggio naturale**.

Nessuna API key, nessun build step: solo HTML + CSS + JavaScript a moduli ES.
I dati arrivano da [Open-Meteo](https://open-meteo.com) (gratuito, CORS abilitato).

## Cosa fa

1. **Località** — cerca una città (geocoding Open-Meteo) o usa la geolocalizzazione del browser.
2. **Meteo in tempo reale** — copertura nuvolosa bassa/media/alta, visibilità, umidità, temperatura all'ora del prossimo tramonto.
3. **Dati astronomici** — orario del tramonto, azimut/direzione del sole (algoritmo solare NOAA), fase lunare.
4. **Sunset Score (0–100)** — un punteggio con etichetta qualitativa.
5. **Spiegazione** — perché quel punteggio: _"nuvole basse all'orizzonte"_, _"nuvole alte favorevoli"_, _"visibilità eccellente"_, ecc.

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
index.html          markup dell'app
src/styles.css      tema "tramonto"
src/api.js          Open-Meteo: geocoding + previsioni
src/astronomy.js    posizione solare (NOAA), fase lunare
src/score.js        algoritmo Sunset Score + spiegazione  ← cuore testabile
src/main.js         orchestrazione e rendering
test/score.test.js  test dell'algoritmo
```

## Licenza

MIT
