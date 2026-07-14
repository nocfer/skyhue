**English** · [Italiano](README.it.md)

# 🌅 SkyHue — Sunset Score

A web app that estimates **how beautiful the next sunset will be** by combining
**real-time weather**, **astronomical data** and a **scoring algorithm** with a
matching **natural-language explanation**.

No API key, no build step: just HTML + CSS + ES-module JavaScript. Data comes
from [Open-Meteo](https://open-meteo.com) — weather, astronomy and air quality
(free, CORS-enabled).

## What it does

1. **Location** — search a city (Open-Meteo geocoding) or use the browser's geolocation.
2. **Real-time weather** — low/mid/high cloud cover, visibility, humidity and temperature at the event's hour.
3. **Air quality** — aerosol optical depth and PM2.5: moderate particulate lights up the reds, haze dims them.
4. **Light path** — samples low/mid/high cloud from 40–250 km **along the ray toward the sun**: a distant front blocks the grazing light even under a perfect local sky, while a clear path can light the deck from below. It weighs on the score, appears in the explanations and as a cell in the conditions.
5. **Astronomy** — sunrise/sunset time, sun azimuth/direction (NOAA solar algorithm), moon phase.
6. **Sunset & Sunrise Score (0–100)** — a score with a qualitative label, for both sunset and sunrise.
7. **Multi-day forecast** — a strip of the next 7 days, each with its own score.
8. **Hourly timeline** — how the score trends through the hours around the event.
9. **Explanation** — why that score: _"low cloud on the horizon"_, _"favorable high cloud"_, _"excellent visibility"_, _"particulate haze"_, etc.
10. **Sky preview** — a gradient that simulates the expected colors from score, cloud and aerosol.
11. **Sun compass** — where to look on the horizon (sunrise/sunset azimuth).
12. **Point map** — a Leaflet mini-map of the analyzed point with a **score-colored marker** and a **ray toward the sun** (where it will sit on the horizon), plus the requested coordinates and the actual weather grid cell.
13. **Favorites** — save your locations (localStorage) and reload them with a tap.
14. **Sharing** — a direct link to the location+event (Web Share API or copy link).
15. **Where to go and watch it** — nearby scenic spots from OpenStreetMap (viewpoints, lighthouses, headlands, beaches), **rated qualitatively**: the terrain elevation is sampled along the ray toward the sun (Open-Meteo's Elevation API) to estimate whether the horizon is clear or obstructed and whether there's open sea (~25 km radius, with an estimated drive time). Each destination shows **two distinct scores**: the **view** (the big number — how good the *outlook* is: clear horizon, open sea, kind of place; weather-independent) and the **sky** (🌅 chip — the *Sunset Score* computed with that specific point's weather). For the finalist destinations the two scores are **combined** in the ranking (the view weighs more; the sky, nearly uniform over the area, refines the order). On demand, a **coordinate-based estimate** (grid + elevations) also proposes points *not mapped* on OSM, rating their outlook.
16. **Map screen** (`#map`) — an interactive map (Leaflet, loaded on demand): **tap anywhere** to get a Sunset Score, sun direction and outlook at that point, then open the full detail. Tapping a suggested spot opens a **card** with the cloud split (low/mid/high) and air clarity, plus **directions** (Apple / Google / OSM).

## How the score works

The best sunset needs **partial high/mid cloud** (cirrus catches the color), a
**horizon clear of low cloud** (which would block the sun) and a **clear
atmosphere**. The algorithm (`src/score.js`):

- starts from a **guaranteed base** (0.35): even a clear sky is "worth" something;
- rewards **high cloud (~50%)** and **mid cloud (~45%)** with a bell curve → _drama_;
- rates **transparency** from visibility and humidity → _clarity_;
- applies a **multiplicative penalty** for **low cloud** (it blocks the horizon);
- penalizes **opaque-deck overcast** (low+mid cloud covering the sky):
  **high cirrus**, even dense, stays translucent and does **not** count as overcast;
- modulates with **particulate** (`aerosol`): moderate lights up the reds, excessive dims them;
- evaluates the **light path** (`src/lightpath.js`): samples cloud at
  **40/90/160/250 km along the ray toward the sun** — the grazing light that
  colors the sunset passes through there before reaching the cloud above you. A
  distant front kills it even under a perfect local sky; a clear path can light
  the deck "from below". The factor is optional: with no samples the score stays
  as it always was.

```
raw   = 100 · (0.35 + 0.45·drama + 0.20·clarity)          // 0.35 = guaranteed base
score = raw · (1 − 0.85·low_cloud) · (1 − 0.9·overcast) · aerosol · path
path  = 1 − 0.45·(1 − pathClear)                          // absent → 1 (neutral)
```

A clear sky is worth ~55 (nice but flat); partial cirrus with a clear horizon
climbs to 75–95; dense low cloud or overcast sky drops below 25.

## Getting started

You need a small static server (ES modules won't open from `file://`):

```bash
# option 1 — Python
python3 -m http.server 8000
# option 2 — npm (runs the same command)
npm start
```

Then open <http://localhost:8000>.

## Tests

The algorithm is pure and testable without network or browser:

```bash
npm test        # or: node --test
```

## Structure

```
index.html            app markup + service worker registration
manifest.webmanifest  PWA: installable to the home screen
sw.js                 service worker: offline shell + API cache
icon.svg              app icon
src/styles.css        "sunset" theme
src/api.js            Open-Meteo: geocoding, forecast, air quality
src/astronomy.js      solar position (NOAA), moon phase
src/score.js          Sunset Score algorithm + explanation  ← testable core
src/sky.js            expected-sky palette (gradient)
src/spots.js          nearby scenic spots (OpenStreetMap/Overpass)
src/lightpath.js      cloud along the ray toward the sun (light path)
src/store.js          favorites in localStorage
src/cache.js          two-tier cache (memory + IndexedDB) of network responses
src/main.js           orchestration and rendering
test/score.test.js    algorithm tests
test/lightpath.test.js ray-sampling tests (timezones, degradations)
test/sky.test.js      palette tests
test/spots.test.js    distance/bearing tests
test/cache.test.js    cache tests (TTL, reuse, errors)
```

## Interactive map & performance

On the map screen (`#map`) each tap evaluates the point (weather, air, terrain
elevations and Overpass spots within 25 km). Tapping several points in a row:

- the **previous** evaluation's requests are **aborted** (`AbortController`)
  instead of piling up — including the costly Overpass queries — so the network
  doesn't saturate and the last tap always wins;
- responses are held in a **two-tier cache** (`src/cache.js`) keyed by rounded
  coordinates: **memory** (L1) for the current session and **IndexedDB** (L2) to
  survive reloads and later sessions. Revisiting the same area is instant and
  doesn't re-query Overpass. Terrain elevations (immutable), POIs (near-static),
  geocoding and place names (Nominatim, ~1 req/s) get long TTLs; weather and air
  quality ~30 min. Outside the browser (tests) there's no IndexedDB and it
  degrades to memory only.

## PWA & offline

The app is installable (Add to Home Screen) and works offline: the service
worker caches the shell and the last API response, so the last location stays
viewable without a network.

## License

MIT
