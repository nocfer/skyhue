// Terminology glossary (keep copy consistent with these):
//   spot     = a suggested viewpoint to go watch from   (IT: punto panoramico)
//   place    = a saved favourite                        (IT: luogo)
//   location = the searched/analysed position           (IT: località)
//   point    = arbitrary coordinates — map-tap, grid    (IT: punto)
const DICT = {
  it: {
    "app.tagline.sunset":
      "Quanto si accenderà il prossimo tramonto? Un punteggio da meteo reale e dati astronomici.",
    "app.tagline.sunrise":
      "Quanto si accenderà la prossima alba? Un punteggio da meteo reale e dati astronomici.",
    "search.placeholder": "Cerca una città…",
    "search.aria": "Cerca una città",
    "search.suggestAria": "Suggerimenti di ricerca",
    "search.submit": "Calcola",
    "search.geo": "Posizione",
    "search.geoTitle": "Usa la mia posizione",
    "mode.groupAria": "Momento della giornata",
    "fav.groupAria": "Località preferite",
    "theme.aria": "Cambia tema",
    "lang.aria": "Cambia lingua",
    "event.sunset": "Tramonto",
    "event.sunrise": "Alba",
    "verb.sets": "tramonta",
    "verb.rises": "sorge",

    "detail.favSave": "Salva tra i preferiti",
    "detail.shareAria": "Condividi",
    "detail.expand": "Espandi",
    "detail.openMap": "Apri la mappa grande · tutti i punti",
    "stat.direction": "Direzione sole",
    "stat.temp": "Temperatura",
    "stat.visibility": "Visibilità",
    "stat.humidity": "Umidità",
    "stat.aerosol": "Aerosol · PM2.5",
    "stat.moon": "Luna",
    "stat.lightPath": "Percorso luce",

    "section.point": "Punto analizzato",
    "grid.note":
      "Il tuo punto {reqLat}, {reqLon} · cella di previsione più vicina {gLat}, {gLon}",
    "section.lookAt": "Dove guardare",
    "lookAt.text": "Il sole {verb} a {dir} ({deg}°).",
    "light.golden": "Golden hour",
    "light.blue": "Blue hour",
    "section.trend": "Andamento del cielo attorno {when}",
    "trend.hint":
      "Punteggio ora per ora — la colonna evidenziata è l’ora {when}.",
    // when.* vs when.*2: IT preposition variants (a/di); EN values identical by design.
    "when.sunset": "al tramonto",
    "when.sunrise": "all’alba",
    "when.sunset2": "del tramonto",
    "when.sunrise2": "dell’alba",
    "section.why": "Perché questo punteggio",

    "section.spots": "Dove andare a guardarlo",
    "spots.dirNote":
      "Il sole {verb} verso <strong>{dir}</strong> ({deg}°) — scegli un punto con vista libera in quella direzione.",
    "spots.loading":
      "Cerco i punti nei dintorni e ne valuto l’affaccio verso il sole…",
    "spots.error": "Punti panoramici non disponibili al momento.",
    "spots.none": "Nessun punto panoramico mappato entro ~25 km.",
    "spots.scan": "Cerca anche punti non mappati (stima)",
    "spots.scanning": "Analizzo il territorio…",
    "spots.estimateHint":
      "Punti stimati dalla morfologia del terreno: anonimi e non garantiti accessibili (verifica strade/accesso sulla mappa).",
    "spots.estimateError": "Stima non riuscita, riprova.",
    "spots.estimateNone": "Nessun punto promettente trovato dalla stima.",
    "spot.sky": "cielo {n}",
    "spot.openOsm": "Apri in OSM ↗",
    "spot.viewQuality": "Qualità dell’affaccio",
    "spot.skyTitle": "Punteggio del cielo in quel punto",

    "fav.compare": "Confronta",
    "fav.remove": "Rimuovi",
    "cmp.calc": "Calcolo i punteggi…",
    "fav.calc": "Controllo il cielo…",
    "cmp.na": "dati non disponibili",
    "cmp.close": "Chiudi",

    "banner.top":
      "{noun} top in arrivo: {day} {score}/100 — il migliore dei prossimi giorni",

    "status.fetching": "Recupero dati per {label}…",
    "status.searching": "Ricerca località…",
    "status.noResults": "Nessuna località trovata. Prova con un altro nome.",
    "status.error": "Errore: {msg}",
    "status.geolocating": "Rilevamento posizione…",
    "status.geoUnsupported": "Geolocalizzazione non supportata dal browser.",
    "status.geoUnavailable": "Posizione non disponibile: {msg}",
    "status.linkCopied": "Link copiato negli appunti ✓",
    "status.imgSaved": "Immagine salvata ✓",
    "status.imgError": "Impossibile generare l’immagine.",
    "geo.here": "La tua posizione",
    "map.pointLabel": "Punto sulla mappa ({lat}, {lon})",
    "share.text": "{noun} {score}/100 a {label} — SkyHue",
    "share.imgTime": "{noun} ore {time} · {day}",

    "map.hint": "Tocca un punto della mappa per valutarlo",
    "map.back": "Indietro",
    "map.attribution": "Informazioni e crediti della mappa",
    "map.legend": "Legenda",
    "map.legend.point": "Punto analizzato",
    "map.legend.sun": "Sole all’orizzonte",
    "map.legend.ray": "Direzione del sole",
    "map.legend.good": "Affaccio libero",
    "map.legend.neutral": "Affaccio incerto",
    "map.legend.bad": "Orizzonte ostruito",
    "map.legend.visibility": "Visibilità",
    "mp.calc": "Valuto questo punto — affaccio e punti vicini…",
    "mp.na": "Dati non disponibili per questo punto — riprova.",
    "map.loadError": "Mappa non disponibile (serve connessione).",
    "map.markerPopup": "Punteggio {score} · {event} verso {dir} ({deg}°)",
    "mappop.view": "affaccio",
    "mappop.sky": "cielo",
    "mappop.towards": "verso {dir}",

    "label.exceptional": "Infuocato",
    "label.great": "Intenso",
    "label.good": "Colorato",
    "label.fair": "Pastello",
    "label.mediocre": "Tenue",
    "label.poor": "Neutro",

    "kind.viewpoint": "Punto panoramico",
    "kind.lighthouse": "Faro",
    "kind.cape": "Promontorio",
    "kind.cliff": "Scogliera",
    "kind.peak": "Cima",
    "kind.beach": "Spiaggia",
    "kind.estimate": "Punto stimato",

    "verdict.notEvaluated": "Affaccio non valutato",
    "verdict.obstructed": "Orizzonte ostruito verso il sole",
    "verdict.openSea": "Affaccio libero sul mare",
    "verdict.openNoSea": "Orizzonte libero ma senza mare aperto",
    "verdict.openLand": "Orizzonte libero verso il sole",

    "explain.highGood.title": "Nuvole alte favorevoli",
    "explain.highGood.detail":
      "Cirri (nuvole alte e sottili) al {high}%: catturano e diffondono la luce radente.",
    "explain.highMuch.title": "Molte nuvole alte",
    "explain.highMuch.detail":
      "Copertura alta al {high}%: cielo forse troppo velato.",
    "explain.highFew.title": "Poche nuvole alte",
    "explain.highFew.detail":
      "Mancano i cirri che accendono il cielo: colori più sobri.",
    "explain.midGood.title": "Nuvole medie ben distribuite",
    "explain.midGood.detail":
      "Strato medio al {mid}%: aggiunge profondità e sfumature.",
    "explain.lowBad.title": "Nuvole basse all’orizzonte",
    "explain.lowBad.detail":
      "Copertura bassa al {low}%: rischia di bloccare il sole sull’orizzonte.",
    "explain.lowSome.title": "Qualche nuvola bassa",
    "explain.lowSome.detail":
      "Nuvole basse al {low}%: orizzonte parzialmente disturbato.",
    "explain.lowClear.title": "Orizzonte libero qui",
    "explain.lowClear.detail":
      "Poche nuvole basse sopra di te: niente blocca il sole al tuo orizzonte.",
    "explain.overcast.title": "Cielo coperto",
    "explain.overcast.detail":
      "Copertura totale al {total}%: poca luce diretta.",
    "explain.visGood.title": "Visibilità eccellente",
    "explain.visGood.detail":
      "Atmosfera limpida ({visKm} km): colori nitidi e saturi.",
    "explain.visBad.title": "Visibilità ridotta",
    "explain.visBad.detail":
      "Solo {visKm} km di visibilità: foschia o particolato nell’aria.",
    "explain.hazeBad.title": "Foschia da particolato",
    "explain.hazeBad.detail":
      "Aerosol elevato{pm25note}: la luce si disperde e i colori si attenuano.",
    "explain.hazeBad.pm25": " (PM2.5 {pm25} µg/m³)",
    "explain.aerosolGood.title": "Aerosol favorevoli",
    "explain.aerosolGood.detail":
      "Un pulviscolo moderato nell’atmosfera tende ad accendere i rossi e gli arancioni.",
    "explain.humidHigh.title": "Umidità elevata",
    "explain.humidHigh.detail": "Umidità al {humidity}%: colori più smorzati.",
    "explain.humidDry.title": "Aria secca",
    "explain.humidDry.detail":
      "Umidità al {humidity}%: favorisce colori intensi.",
    "explain.pathBlocked.title": "Luce bloccata a distanza",
    "explain.pathBlocked.detail":
      "Oltre il tuo orizzonte un fronte spegne la luce radente prima che arrivi (solo il {clear}% passa).",
    "explain.pathPartial.title": "Nubi lontane, oltre l’orizzonte",
    "explain.pathPartial.detail":
      "Oltre il tuo orizzonte, nuvole a 40–250 km verso il sole filtrano la luce in arrivo (il {clear}% passa).",
    "explain.pathClear.title": "Luce in arrivo libera",
    "explain.pathClear.detail":
      "Verso il sole la via è libera al {clear}%: la luce radente può accendere le nuvole sopra di te da sotto.",

    "moon.new": "Luna nuova",
    "moon.waxingCrescent": "Luna crescente",
    "moon.firstQuarter": "Primo quarto",
    "moon.waxingGibbous": "Gibbosa crescente",
    "moon.full": "Luna piena",
    "moon.waningGibbous": "Gibbosa calante",
    "moon.lastQuarter": "Ultimo quarto",
    "moon.waningCrescent": "Luna calante",

    "foot.credits":
      'Dati meteo &amp; astronomici da <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a>. Posizione solare con algoritmo NOAA.',

    // --- Redesign "Atmosphere" ---
    "menu.aria": "Altre opzioni",
    // Menu rows read "Label: current value" (not the switch target).
    "menu.themeLabel": "Tema",
    "menu.themeLight": "Chiaro",
    "menu.themeDark": "Scuro",
    "menu.langLabel": "Lingua",
    "home.headline": "Come sarà<br />la luce?",
    "fav.title": "I tuoi luoghi",
    "map.pickSpot": "Scegli un punto sulla mappa",
    "map.pickTitle": "Scegli un punto",
    "map.pointName": "Punto sulla mappa",
    "mp.openDetail": "Apri il dettaglio →",
    "results.scoreOutOf": "/ 100",
    "time.tonight": "Stasera",
    "rhero.change": "Cambia località",
    "rhero.searchAria": "Nuova ricerca",

    // Event-neutral: the noun (sunset/sunrise) is already in the eyebrow. The
    // score measures likely COLOUR, not beauty, so the copy describes the light
    // and never judges the event as good/bad (a clear-sky sunset scores low but
    // can still be lovely). sunset/sunrise keys share the same text.
    "headline.exceptional.sunset": "Il cielo\ns'infiamma",
    "headline.exceptional.sunrise": "Il cielo\ns'infiamma",
    "headline.great.sunset": "Colori\nintensi\nin arrivo",
    "headline.great.sunrise": "Colori\nintensi\nin arrivo",
    "headline.good.sunset": "Bel colore\nin arrivo",
    "headline.good.sunrise": "Bel colore\nin arrivo",
    "headline.fair.sunset": "Luce calda,\ntoni\npastello",
    "headline.fair.sunrise": "Luce calda,\ntoni\npastello",
    "headline.mediocre.sunset": "Colore\nin tono\nminore",
    "headline.mediocre.sunrise": "Colore\nin tono\nminore",
    "headline.poor.sunset": "Poco\ncolore\nstavolta",
    "headline.poor.sunrise": "Poco\ncolore\nstavolta",

    "intro.exceptional":
      "Tutto si allinea: cirri alti, aria tersa, orizzonte aperto. Il sole {verb} verso {dir}.",
    "intro.great":
      "Cielo limpido e acceso: cirri alti e aria tersa si allineano per colori vivi. Il sole {verb} verso {dir}.",
    "intro.good":
      "Buone condizioni per il colore, con qualche velatura utile. Il sole {verb} verso {dir}.",
    "intro.fair":
      "Nella media, ma la luce sarà calda: spesso vale l'uscita. Il sole {verb} verso {dir}.",
    "intro.mediocre":
      "Colori in tono minore e cielo poco favorevole, ma il cielo può sorprendere. Il sole {verb} verso {dir}.",
    "intro.poor":
      "Cielo chiuso: colori improbabili stavolta. Il sole {verb} verso {dir}.",

    "section.week": "Questa settimana",
    "week.caption": "Migliore {day} · {score}/100",
    "section.conditions": "Condizioni",
    "cond.highCloud": "Nuvole alte",
    "cond.lowCloud": "Nuvole basse",
    "cond.midNote": "Più {mid}% di nuvole medie.",
    "desc.litCirrus": "cirri illuminati",
    "desc.heavyHigh": "velatura fitta",
    "desc.fewHigh": "poche nubi alte",
    "desc.clearHorizon": "orizzonte libero",
    "desc.someLow": "qualche nube bassa",
    "desc.blockedLow": "orizzonte coperto",
    "desc.crispAir": "aria tersa",
    "desc.okVis": "discreta",
    "desc.hazyVis": "foschia",
    "desc.dryAir": "aria secca",
    "desc.okHum": "nella media",
    "desc.humidAir": "aria umida",
    "desc.pathClear": "via libera al sole",
    "desc.pathPartial": "nubi lontane sparse",
    "desc.pathBlocked": "nubi lontane a muro",
    "desc.pathLoading": "calcolo in corso…",
    "desc.pathUnknown": "non disponibile",

    "why.sub": "{n} cose giocano a tuo favore.",
    "why.subOne": "Una cosa gioca a tuo favore.",
    "why.addsUp": "Come si compone",
    "why.baseline": "Base",
    "why.drama": "Intensità",
    "why.clarity": "Nitidezza",
    "why.showAll": "Mostra tutti ({n})",
    "why.showLess": "Mostra meno",
    "why.legendGood": "Aiuta",
    "why.legendNeutral": "Neutro",
    "why.legendBad": "Penalizza",
    "why.missing": "Cosa manca per salire",
    "why.missingFoot":
      "I guadagni non si sommano: tutti insieme arriverebbero attorno a {ceiling}.",
    "upside.cirrus.title": "Cirri alti · {gain}",
    "upside.cirrus.detail":
      "Con un velo di nuvole alte attorno al 50% saliresti a ~{target}.",
    "upside.horizon.title": "Orizzonte libero · {gain}",
    "upside.horizon.detail":
      "Senza nuvole basse a chiudere l’orizzonte saliresti a ~{target}.",
    "upside.clearAir.title": "Aria tersa · {gain}",
    "upside.clearAir.detail":
      "Con aria più limpida e secca saliresti a ~{target}.",
    "upside.haze.title": "Meno foschia · {gain}",
    "upside.haze.detail":
      "Con meno pulviscolo in sospensione saliresti a ~{target}.",
    "upside.path.title": "Via libera al sole · {gain}",
    "upside.path.detail":
      "Con il percorso della luce sgombro a 40–250 km saliresti a ~{target}.",

    "trend.arc": "L’andamento {when}",
    "trend.predicted": "Colore previsto",

    "section.atmosphere": "Atmosfera",
    "atmo.aerosolCap.good": "esalta i rossi",
    "atmo.aerosolCap.bad": "foschia, colori smorzati",
    "atmo.aerosolCap.neutral": "effetto trascurabile",
    "atmo.horizon": "Orizzonte",
    "atmo.horizonCap": "da {m} m di quota",
    "atmo.tempCap.sunset": "al tramonto",
    "atmo.tempCap.sunrise": "all’alba",

    "spot.dualLegend":
      "numero grande = qualità dell’affaccio · “cielo” = colore previsto lì",
    "spot.estTag": "STIM",
    "unit.m": "m",
    "unit.km": "km",
    "unit.min": "min",
    "spots.seeAll": "Vedi tutti i punti ({n})",
    "cmp.heading": "Confronto",
    "cmp.sub.sunset": "Prossimo tramonto · i tuoi luoghi",
    "cmp.sub.sunrise": "Prossima alba · i tuoi luoghi",
    "cmp.best": "IL MIGLIORE",
    "cmp.foot.sunset": "Calcolato dal meteo reale di ogni luogo al tramonto.",
    "cmp.foot.sunrise": "Calcolato dal meteo reale di ogni luogo all’alba.",
    "share.title.sunset": "Condividi questo tramonto",
    "share.title.sunrise": "Condividi quest’alba",
    "share.image": "Condividi immagine",
    "share.save": "Salva immagine",
    "share.copy": "Copia link",
  },

  en: {
    "app.tagline.sunset":
      "How much colour will the next sunset bring? A score from live weather and astronomical data.",
    "app.tagline.sunrise":
      "How much colour will the next sunrise bring? A score from live weather and astronomical data.",
    "search.placeholder": "Search a city…",
    "search.aria": "Search a city",
    "search.suggestAria": "Search suggestions",
    "search.submit": "Calculate",
    "search.geo": "Location",
    "search.geoTitle": "Use my location",
    "mode.groupAria": "Time of day",
    "fav.groupAria": "Favourite locations",
    "theme.aria": "Toggle theme",
    "lang.aria": "Change language",
    "event.sunset": "Sunset",
    "event.sunrise": "Sunrise",
    "verb.sets": "sets",
    "verb.rises": "rises",

    "detail.favSave": "Save to favourites",
    "detail.shareAria": "Share",
    "detail.expand": "Expand",
    "detail.openMap": "Open full map · all spots",
    "stat.direction": "Sun direction",
    "stat.temp": "Temperature",
    "stat.visibility": "Visibility",
    "stat.humidity": "Humidity",
    "stat.aerosol": "Aerosol · PM2.5",
    "stat.moon": "Moon",
    "stat.lightPath": "Light path",

    "section.point": "Analysed point",
    "grid.note":
      "Your point {reqLat}, {reqLon} · nearest forecast cell {gLat}, {gLon}",
    "section.lookAt": "Where to look",
    "lookAt.text": "The sun {verb} to the {dir} ({deg}°).",
    "light.golden": "Golden hour",
    "light.blue": "Blue hour",
    "section.trend": "Sky trend around {when}",
    "trend.hint": "Score hour by hour — the highlighted column is {when}.",
    // when.* vs when.*2: IT preposition variants (a/di); EN values identical by design.
    "when.sunset": "sunset",
    "when.sunrise": "sunrise",
    "when.sunset2": "sunset",
    "when.sunrise2": "sunrise",
    "section.why": "Why this score",

    "section.spots": "Where to watch it",
    "spots.dirNote":
      "The sun {verb} towards <strong>{dir}</strong> ({deg}°) — pick a spot with a clear view that way.",
    "spots.loading":
      "Finding nearby spots and checking their view towards the sun…",
    "spots.error": "Viewpoints unavailable right now.",
    "spots.none": "No mapped viewpoints within ~25 km.",
    "spots.scan": "Also search unmapped spots (estimate)",
    "spots.scanning": "Scanning the terrain…",
    "spots.estimateHint":
      "Spots estimated from terrain shape: unnamed and not guaranteed accessible (check roads/access on the map).",
    "spots.estimateError": "Estimate failed, try again.",
    "spots.estimateNone": "No promising spot found from the estimate.",
    "spot.sky": "sky {n}",
    "spot.openOsm": "Open in OSM ↗",
    "spot.viewQuality": "View quality",
    "spot.skyTitle": "Sky score at this spot",

    "fav.compare": "Compare",
    "fav.remove": "Remove",
    "cmp.calc": "Computing scores…",
    "fav.calc": "Checking the sky…",
    "cmp.na": "data unavailable",
    "cmp.close": "Close",

    "banner.top":
      "{noun} alert: {day} {score}/100 — the best of the coming days",

    "status.fetching": "Fetching data for {label}…",
    "status.searching": "Searching location…",
    "status.noResults": "No location found. Try another name.",
    "status.error": "Error: {msg}",
    "status.geolocating": "Detecting location…",
    "status.geoUnsupported": "Geolocation not supported by the browser.",
    "status.geoUnavailable": "Location unavailable: {msg}",
    "status.linkCopied": "Link copied to clipboard ✓",
    "status.imgSaved": "Image saved ✓",
    "status.imgError": "Could not generate the image.",
    "geo.here": "Your location",
    "map.pointLabel": "Point on the map ({lat}, {lon})",
    "share.text": "{noun} {score}/100 at {label} — SkyHue",
    "share.imgTime": "{noun} at {time} · {day}",

    "map.hint": "Tap a point on the map to evaluate it",
    "map.back": "Back",
    "map.attribution": "Map information and credits",
    "map.legend": "Legend",
    "map.legend.point": "Analysed point",
    "map.legend.sun": "Sun on the horizon",
    "map.legend.ray": "Sun direction",
    "map.legend.good": "Clear view",
    "map.legend.neutral": "Uncertain view",
    "map.legend.bad": "Obstructed horizon",
    "map.legend.visibility": "Visibility",
    "mp.calc": "Scoring this point — view and nearby spots…",
    "mp.na": "Data unavailable for this point — try again.",
    "map.loadError": "Map unavailable (connection required).",
    "map.markerPopup": "Score {score} · {event} towards {dir} ({deg}°)",
    "mappop.view": "view",
    "mappop.sky": "sky",
    "mappop.towards": "towards {dir}",

    "label.exceptional": "Fiery",
    "label.great": "Vivid",
    "label.good": "Colourful",
    "label.fair": "Pastel",
    "label.mediocre": "Faint",
    "label.poor": "Neutral",

    "kind.viewpoint": "Viewpoint",
    "kind.lighthouse": "Lighthouse",
    "kind.cape": "Headland",
    "kind.cliff": "Cliff",
    "kind.peak": "Peak",
    "kind.beach": "Beach",
    "kind.estimate": "Estimated point",

    "verdict.notEvaluated": "View not evaluated",
    "verdict.obstructed": "Horizon obstructed towards the sun",
    "verdict.openSea": "Open view over the sea",
    "verdict.openNoSea": "Open horizon but no open sea",
    "verdict.openLand": "Open horizon towards the sun",

    "explain.highGood.title": "Favourable high cloud",
    "explain.highGood.detail":
      "Cirrus — thin high cloud — at {high}%: it catches and spreads the low grazing light.",
    "explain.highMuch.title": "Lots of high cloud",
    "explain.highMuch.detail":
      "High cover at {high}%: the sky may be too veiled.",
    "explain.highFew.title": "Few high clouds",
    "explain.highFew.detail": "No cirrus to light up the sky: plainer colour.",
    "explain.midGood.title": "Well-spread mid clouds",
    "explain.midGood.detail": "Mid layer at {mid}%: adds depth and nuance.",
    "explain.lowBad.title": "Low clouds on the horizon",
    "explain.lowBad.detail":
      "Low cover at {low}%: may block the sun on the horizon.",
    "explain.lowSome.title": "Some low cloud",
    "explain.lowSome.detail": "Low clouds at {low}%: horizon partly disturbed.",
    "explain.lowClear.title": "Clear horizon here",
    "explain.lowClear.detail":
      "Few low clouds overhead: nothing blocks the sun at your horizon.",
    "explain.overcast.title": "Overcast sky",
    "explain.overcast.detail": "Total cover at {total}%: little direct light.",
    "explain.visGood.title": "Excellent visibility",
    "explain.visGood.detail":
      "Clear air ({visKm} km): crisp, saturated colours.",
    "explain.visBad.title": "Reduced visibility",
    "explain.visBad.detail":
      "Only {visKm} km of visibility: haze or particulate in the air.",
    "explain.hazeBad.title": "Particulate haze",
    "explain.hazeBad.detail":
      "High aerosol{pm25note}: light scatters and colours fade.",
    "explain.hazeBad.pm25": " (PM2.5 {pm25} µg/m³)",
    "explain.aerosolGood.title": "Favourable aerosol",
    "explain.aerosolGood.detail":
      "A moderate haze in the air tends to light up reds and oranges.",
    "explain.humidHigh.title": "High humidity",
    "explain.humidHigh.detail": "Humidity at {humidity}%: more muted colours.",
    "explain.humidDry.title": "Dry air",
    "explain.humidDry.detail":
      "Humidity at {humidity}%: favours intense colours.",
    "explain.pathBlocked.title": "Light blocked far away",
    "explain.pathBlocked.detail":
      "Beyond your horizon, a cloud front kills the grazing light before it arrives (only {clear}% gets through).",
    "explain.pathPartial.title": "Distant clouds, beyond the horizon",
    "explain.pathPartial.detail":
      "Beyond your horizon, clouds 40–250 km toward the sun filter the incoming light ({clear}% gets through).",
    "explain.pathClear.title": "Incoming light unblocked",
    "explain.pathClear.detail":
      "The path toward the sun is {clear}% clear: grazing light can catch the clouds above you from underneath.",

    "moon.new": "New moon",
    "moon.waxingCrescent": "Waxing crescent",
    "moon.firstQuarter": "First quarter",
    "moon.waxingGibbous": "Waxing gibbous",
    "moon.full": "Full moon",
    "moon.waningGibbous": "Waning gibbous",
    "moon.lastQuarter": "Last quarter",
    "moon.waningCrescent": "Waning crescent",

    "foot.credits":
      'Weather &amp; astronomical data from <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a>. Solar position via the NOAA algorithm.',

    // --- Redesign "Atmosphere" ---
    "menu.aria": "More options",
    // Menu rows read "Label: current value" (not the switch target).
    "menu.themeLabel": "Theme",
    "menu.themeLight": "Light",
    "menu.themeDark": "Dark",
    "menu.langLabel": "Language",
    "home.headline": "Chase<br />the light.",
    "fav.title": "Your places",
    "map.pickSpot": "Pick a point on the map",
    "map.pickTitle": "Pick a point",
    "map.pointName": "Point on the map",
    "mp.openDetail": "Open full detail →",
    "results.scoreOutOf": "/ 100",
    "time.tonight": "Tonight",
    "rhero.change": "Change location",
    "rhero.searchAria": "New search",

    // Event-neutral (see the IT block): describes likely COLOUR, not beauty.
    "headline.exceptional.sunset": "The sky\ncatches\nfire",
    "headline.exceptional.sunrise": "The sky\ncatches\nfire",
    "headline.great.sunset": "Vivid\ncolour\nahead",
    "headline.great.sunrise": "Vivid\ncolour\nahead",
    "headline.good.sunset": "Good\ncolour\nahead",
    "headline.good.sunrise": "Good\ncolour\nahead",
    "headline.fair.sunset": "Warm light,\npastel\ntones",
    "headline.fair.sunrise": "Warm light,\npastel\ntones",
    "headline.mediocre.sunset": "Colour in\na minor\nkey",
    "headline.mediocre.sunrise": "Colour in\na minor\nkey",
    "headline.poor.sunset": "Little\ncolour\nthis time",
    "headline.poor.sunrise": "Little\ncolour\nthis time",

    "intro.exceptional":
      "Everything lines up — high cirrus, crisp air, an open horizon. The sun {verb} to the {dir}.",
    "intro.great":
      "A clear, lit-up sky — high cirrus and crisp air line up for vivid colour. The sun {verb} to the {dir}.",
    "intro.good":
      "Good conditions for colour, with some helpful high cloud. The sun {verb} to the {dir}.",
    "intro.fair":
      "Average, but the light will be warm — often worth the trip. The sun {verb} to the {dir}.",
    "intro.mediocre":
      "Colours in a minor key and an unfavourable sky, but the sky can still surprise. The sun {verb} to the {dir}.",
    "intro.poor":
      "A closed sky — colour is unlikely this time. The sun {verb} to the {dir}.",

    "section.week": "This week",
    "week.caption": "Best {day} · {score}/100",
    "section.conditions": "Conditions",
    "cond.highCloud": "High cloud",
    "cond.lowCloud": "Low cloud",
    "cond.midNote": "Plus {mid}% mid cloud.",
    "desc.litCirrus": "lit cirrus",
    "desc.heavyHigh": "heavy veil",
    "desc.fewHigh": "few high clouds",
    "desc.clearHorizon": "clear horizon",
    "desc.someLow": "some low cloud",
    "desc.blockedLow": "blocked horizon",
    "desc.crispAir": "crisp air",
    "desc.okVis": "decent",
    "desc.hazyVis": "hazy",
    "desc.dryAir": "dry air",
    "desc.okHum": "average",
    "desc.humidAir": "humid air",
    "desc.pathClear": "clear run to the sun",
    "desc.pathPartial": "some distant clouds",
    "desc.pathBlocked": "distant cloud wall",
    "desc.pathLoading": "checking…",
    "desc.pathUnknown": "unavailable",

    "why.sub": "{n} things are working in your favour.",
    "why.subOne": "One thing is working in your favour.",
    "why.addsUp": "How it adds up",
    "why.baseline": "Baseline",
    "why.drama": "Sky drama",
    "why.clarity": "Clarity",
    "why.showAll": "Show all ({n})",
    "why.showLess": "Show less",
    "why.legendGood": "Helps",
    "why.legendNeutral": "Neutral",
    "why.legendBad": "Hurts",
    "why.missing": "What's missing to climb",
    "why.missingFoot":
      "Gains don't stack — all together they'd top out around {ceiling}.",
    "upside.cirrus.title": "High cirrus · {gain}",
    "upside.cirrus.detail":
      "With a ~50% veil of high cloud you'd climb to ~{target}.",
    "upside.horizon.title": "Clear horizon · {gain}",
    "upside.horizon.detail":
      "Without low cloud sealing the horizon you'd climb to ~{target}.",
    "upside.clearAir.title": "Crisp air · {gain}",
    "upside.clearAir.detail":
      "With clearer, drier air you'd climb to ~{target}.",
    "upside.haze.title": "Less haze · {gain}",
    "upside.haze.detail": "With less suspended haze you'd climb to ~{target}.",
    "upside.path.title": "Clear light path · {gain}",
    "upside.path.detail":
      "With a clear light path 40–250 km out you'd climb to ~{target}.",

    "trend.arc": "The {when} arc",
    "trend.predicted": "Predicted colour",

    "section.atmosphere": "Atmosphere",
    "atmo.aerosolCap.good": "warms the reds",
    "atmo.aerosolCap.bad": "hazes the colours",
    "atmo.aerosolCap.neutral": "little effect",
    "atmo.horizon": "Horizon",
    "atmo.horizonCap": "seen from {m} m elevation",
    "atmo.tempCap.sunset": "at sunset",
    "atmo.tempCap.sunrise": "at sunrise",

    "spot.dualLegend":
      "big number = view quality · “sky” = expected colour there",
    "spot.estTag": "EST",
    "unit.m": "m",
    "unit.km": "km",
    "unit.min": "min",
    "spots.seeAll": "See all spots ({n})",
    "cmp.heading": "Compare",
    "cmp.sub.sunset": "Next sunset · your places",
    "cmp.sub.sunrise": "Next sunrise · your places",
    "cmp.best": "TOP PICK",
    "cmp.foot.sunset": "Scored from each place's live weather at sunset.",
    "cmp.foot.sunrise": "Scored from each place's live weather at sunrise.",
    "share.title.sunset": "Share this sunset",
    "share.title.sunrise": "Share this sunrise",
    "share.image": "Share image",
    "share.save": "Save image",
    "share.copy": "Copy link",
  },
};

export const DICTIONARIES = DICT;

let lang = "it";

export function initLang() {
  try {
    const s = localStorage.getItem("skyhue.lang");
    if (s === "en" || s === "it") lang = s;
    else
      lang = (navigator.language || "it").toLowerCase().startsWith("en")
        ? "en"
        : "it";
  } catch {
    lang = "it";
  }
  return lang;
}

export function getLang() {
  return lang;
}

export function setLang(l) {
  lang = l === "en" ? "en" : "it";
  try {
    localStorage.setItem("skyhue.lang", lang);
  } catch {}
  return lang;
}

export function t(key, params) {
  const table = DICT[lang] || DICT.it;
  let s = key in table ? table[key] : key in DICT.it ? DICT.it[key] : key;
  if (params) {
    for (const k in params) {
      s = s.split("{" + k + "}").join(params[k]);
    }
  }
  return s;
}

export const cardinalMap = {
  N: "N",
  NE: "NE",
  E: "E",
  SE: "SE",
  S: "S",
  SO: "SW",
  O: "W",
  NO: "NW",
};

export function cardinal(card) {
  return lang === "en" ? cardinalMap[card] || card : card;
}

export function applyStaticI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  root.querySelectorAll("[data-i18n-html]").forEach((el) => {
    el.innerHTML = t(el.getAttribute("data-i18n-html"));
  });
  root.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph")));
  });
  root.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    const s = t(el.getAttribute("data-i18n-aria"));
    el.setAttribute("aria-label", s);
    el.setAttribute("title", s);
  });
}
