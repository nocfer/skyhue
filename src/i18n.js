// i18n.js — internazionalizzazione IT/EN. Dizionario a chiavi puntate + t() con
// interpolazione {nome}. La lingua è persistita in localStorage (skyhue.lang) e
// di default segue quella del sistema. Le stringhe dinamiche dei moduli puri
// (score/spots/astronomy) arrivano qui come codici e vengono risolte con t().

const DICT = {
  it: {
    'app.tagline':
      'Quanto sarà bello il prossimo tramonto? Un punteggio da meteo reale e dati astronomici.',
    'search.placeholder': 'Cerca una città…',
    'search.aria': 'Cerca una città',
    'search.suggestAria': 'Suggerimenti di ricerca',
    'search.submit': 'Calcola',
    'search.geo': 'Posizione',
    'search.geoTitle': 'Usa la mia posizione',
    'mode.groupAria': 'Momento della giornata',
    'fav.groupAria': 'Località preferite',
    'theme.aria': 'Cambia tema',
    'lang.aria': 'Cambia lingua',
    'mode.sunset': 'Tramonto',
    'mode.sunrise': 'Alba',

    'event.sunset': 'Tramonto',
    'event.sunrise': 'Alba',
    'verb.willSet': 'tramonterà',
    'verb.willRise': 'sorgerà',
    'verb.sets': 'tramonta',
    'verb.rises': 'sorge',

    'detail.favSave': 'Salva tra i preferiti',
    'detail.shareAria': 'Condividi',
    'detail.expand': 'Espandi',
    'detail.openMap': 'Apri la mappa grande · tutti i punti',
    'stat.direction': 'Direzione sole',
    'stat.temp': 'Temperatura',
    'stat.visibility': 'Visibilità',
    'stat.humidity': 'Umidità',
    'stat.aerosol': 'Aerosol · PM2.5',
    'stat.moon': 'Luna',
    'stat.lightPath': 'Percorso luce',

    'section.point': 'Punto analizzato',
    'grid.note': 'Punto richiesto {reqLat}, {reqLon} · cella meteo {gLat}, {gLon}',
    'section.lookAt': 'Dove guardare',
    'lookAt.text': 'Il sole {verb} a {dir} ({deg}°).',
    'light.golden': 'Golden hour',
    'light.blue': 'Blue hour',
    'section.trend': 'Andamento del cielo attorno {when}',
    'trend.hint': 'Punteggio ora per ora — la colonna evidenziata è l’ora {when}.',
    'when.sunset': 'al tramonto',
    'when.sunrise': 'all’alba',
    'when.sunset2': 'del tramonto',
    'when.sunrise2': 'dell’alba',
    'section.why': 'Perché questo punteggio',

    'section.spots': 'Dove andare a guardarlo',
    'spots.dirNote':
      'Il sole {verb} verso <strong>{dir}</strong> ({deg}°) — scegli un punto con vista libera in quella direzione.',
    'spots.loading': 'Cerco i punti nei dintorni e ne valuto l’affaccio verso il tramonto…',
    'spots.error': 'Punti panoramici non disponibili al momento.',
    'spots.none': 'Nessun punto panoramico mappato entro ~25 km.',
    'spots.scan': 'Cerca anche punti non mappati (stima)',
    'spots.scanning': 'Analizzo il territorio…',
    'spots.estimateHint':
      'Punti stimati dalla morfologia del terreno: anonimi e non garantiti accessibili (verifica strade/accesso sulla mappa).',
    'spots.estimateError': 'Stima non riuscita, riprova.',
    'spots.estimateNone': 'Nessun punto promettente trovato dalla stima.',
    'spot.sky': 'cielo {n}',
    'spot.openOsm': 'Apri in OSM ↗',
    'spot.viewQuality': 'Qualità dell’affaccio',
    'spot.skyTitle': 'Sunset Score del cielo',

    'fav.compare': 'Confronta',
    'fav.remove': 'Rimuovi',
    'cmp.calc': 'Calcolo i punteggi…',
    'cmp.na': 'dati non disponibili',
    'cmp.close': 'Chiudi',

    'banner.top': '{noun} top in arrivo: {day} {score}/100 — il migliore dei prossimi giorni',

    'status.fetching': 'Recupero dati per {label}…',
    'status.searching': 'Ricerca località…',
    'status.noResults': 'Nessuna località trovata. Prova con un altro nome.',
    'status.error': 'Errore: {msg}',
    'status.geolocating': 'Rilevamento posizione…',
    'status.geoUnsupported': 'Geolocalizzazione non supportata dal browser.',
    'status.geoUnavailable': 'Posizione non disponibile: {msg}',
    'status.linkCopied': 'Link copiato negli appunti ✓',
    'status.imgSaved': 'Immagine salvata ✓',
    'status.imgError': 'Impossibile generare l’immagine.',
    'geo.here': 'La tua posizione',
    'map.pointLabel': 'Punto sulla mappa ({lat}, {lon})',
    'share.text': '{noun} {score}/100 a {label} — SkyHue',
    'share.imgTime': '{noun} ore {time} · {day}',

    'map.hint': 'Tocca un punto della mappa per valutarlo',
    'map.back': 'Indietro',
    'map.attribution': 'Informazioni e crediti della mappa',
    'map.legend': 'Legenda',
    'map.legend.point': 'Punto analizzato',
    'map.legend.sun': 'Sole all’orizzonte',
    'map.legend.ray': 'Direzione del sole',
    'map.legend.good': 'Affaccio libero',
    'map.legend.neutral': 'Affaccio incerto',
    'map.legend.bad': 'Orizzonte ostruito',
    'map.legend.visibility': 'Visibilità',
    'mp.calc': 'Calcolo tramonto, affaccio e punti vicini…',
    'mp.na': 'Dati non disponibili per questo punto. Riprova.',
    'map.loadError': 'Impossibile caricare la mappa (serve connessione).',
    'map.markerPopup': 'Sunset Score {score} · {event} verso {dir} ({deg}°)',
    'mappop.view': 'affaccio',
    'mappop.sky': 'cielo',
    'mappop.towards': 'verso {dir}',

    'label.exceptional': 'Eccezionale',
    'label.great': 'Ottimo',
    'label.good': 'Buono',
    'label.fair': 'Discreto',
    'label.mediocre': 'Mediocre',
    'label.poor': 'Scarso',

    'kind.viewpoint': 'Punto panoramico',
    'kind.lighthouse': 'Faro',
    'kind.cape': 'Promontorio',
    'kind.cliff': 'Scogliera',
    'kind.peak': 'Cima',
    'kind.beach': 'Spiaggia',
    'kind.estimate': 'Punto stimato',

    'verdict.notEvaluated': 'Affaccio non valutato',
    'verdict.obstructed': 'Orizzonte ostruito verso il tramonto',
    'verdict.openSea': 'Affaccio libero sul mare',
    'verdict.openNoSea': 'Orizzonte libero ma senza mare aperto',
    'verdict.openLand': 'Orizzonte libero verso il tramonto',

    'explain.highGood.title': 'Nuvole alte favorevoli',
    'explain.highGood.detail':
      'Cirri al {high}%: catturano e diffondono la luce radente all’orizzonte.',
    'explain.highMuch.title': 'Molte nuvole alte',
    'explain.highMuch.detail': 'Copertura alta al {high}%: cielo forse troppo velato.',
    'explain.highFew.title': 'Poche nuvole alte',
    'explain.highFew.detail': 'Mancano i cirri che accendono il cielo: tramonto più sobrio.',
    'explain.midGood.title': 'Nuvole medie ben distribuite',
    'explain.midGood.detail': 'Strato medio al {mid}%: aggiunge profondità e sfumature.',
    'explain.lowBad.title': 'Nuvole basse all’orizzonte',
    'explain.lowBad.detail':
      'Copertura bassa al {low}%: rischia di bloccare il sole sull’orizzonte.',
    'explain.lowSome.title': 'Qualche nuvola bassa',
    'explain.lowSome.detail': 'Nuvole basse al {low}%: orizzonte parzialmente disturbato.',
    'explain.lowClear.title': 'Orizzonte libero',
    'explain.lowClear.detail': 'Poche nuvole basse: il sole raggiungerà l’orizzonte senza ostacoli.',
    'explain.overcast.title': 'Cielo coperto',
    'explain.overcast.detail': 'Copertura totale al {total}%: poca luce diretta.',
    'explain.visGood.title': 'Visibilità eccellente',
    'explain.visGood.detail': 'Atmosfera limpida ({visKm} km): colori nitidi e saturi.',
    'explain.visBad.title': 'Visibilità ridotta',
    'explain.visBad.detail': 'Solo {visKm} km di visibilità: foschia o particolato nell’aria.',
    'explain.hazeBad.title': 'Foschia da particolato',
    'explain.hazeBad.detail': 'Aerosol elevato{pm25note}: la luce si disperde e i colori si attenuano.',
    'explain.hazeBad.pm25': ' (PM2.5 {pm25} µg/m³)',
    'explain.aerosolGood.title': 'Aerosol favorevoli',
    'explain.aerosolGood.detail':
      'Un pulviscolo moderato nell’atmosfera tende ad accendere i rossi e gli arancioni.',
    'explain.humidHigh.title': 'Umidità elevata',
    'explain.humidHigh.detail': 'Umidità al {humidity}%: colori più smorzati.',
    'explain.humidDry.title': 'Aria secca',
    'explain.humidDry.detail': 'Umidità al {humidity}%: favorisce colori intensi.',
    'explain.pathBlocked.title': 'Luce bloccata a distanza',
    'explain.pathBlocked.detail':
      'Un fronte lontano verso il sole spegne la luce radente prima che arrivi (solo il {clear}% passa).',
    'explain.pathPartial.title': 'Nubi lontane sulla traiettoria',
    'explain.pathPartial.detail':
      'Nuvole a 40–250 km verso il sole filtrano parte della luce (il {clear}% passa).',
    'explain.pathClear.title': 'Luce in arrivo libera',
    'explain.pathClear.detail':
      'Verso il sole la via è libera al {clear}%: la luce radente può accendere le nuvole sopra di te da sotto.',

    'moon.new': 'Luna nuova',
    'moon.waxingCrescent': 'Luna crescente',
    'moon.firstQuarter': 'Primo quarto',
    'moon.waxingGibbous': 'Gibbosa crescente',
    'moon.full': 'Luna piena',
    'moon.waningGibbous': 'Gibbosa calante',
    'moon.lastQuarter': 'Ultimo quarto',
    'moon.waningCrescent': 'Luna calante',

    'foot.credits':
      'Dati meteo &amp; astronomici da <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a>. Posizione solare con algoritmo NOAA.',

    // --- Redesign "Atmosphere" ---
    'menu.aria': 'Altre opzioni',
    'menu.theme': 'Tema',
    'menu.lang': 'Lingua',
    'home.headline': 'Insegui<br />la luce.',
    'fav.title': 'I tuoi luoghi',
    'map.pickSpot': 'Scegli un punto sulla mappa',
    'map.pickTitle': 'Scegli un punto',
    'map.pointName': 'Punto sulla mappa',
    'mp.openDetail': 'Apri il dettaglio →',
    'results.scoreOutOf': '/ 100 punteggio',
    'time.tonight': 'Stasera',
    'rhero.change': 'Cambia località',
    'rhero.searchAria': 'Nuova ricerca',

    'headline.exceptional.sunset': 'Un tramonto\nda non\nperdere.',
    'headline.exceptional.sunrise': 'Un\'alba\nda non\nperdere.',
    'headline.great.sunset': 'Gran bel\ntramonto in\narrivo.',
    'headline.great.sunrise': 'Una gran\nbell\'alba in\narrivo.',
    'headline.good.sunset': 'Un buon\ntramonto\nstasera.',
    'headline.good.sunrise': 'Una buona\nalba\nstamattina.',
    'headline.fair.sunset': 'Un tramonto\ndiscreto\nin arrivo.',
    'headline.fair.sunrise': 'Un\'alba\ndiscreta\nin arrivo.',
    'headline.mediocre.sunset': 'Un tramonto\nsmorzato\nstasera.',
    'headline.mediocre.sunrise': 'Un\'alba\nsmorzata\nstamattina.',
    'headline.poor.sunset': 'Un tramonto\nspento\nin arrivo.',
    'headline.poor.sunrise': 'Un\'alba\nspenta\nin arrivo.',

    'intro.exceptional':
      'Cielo limpido e acceso: cirri alti e aria tersa promettono colori vividi. Il sole {verb} verso {dir}.',
    'intro.great':
      'Cielo limpido e acceso: cirri alti e aria tersa si allineano per colori vivi. Il sole {verb} verso {dir}.',
    'intro.good':
      'Buone condizioni per il colore, con qualche velatura utile. Il sole {verb} verso {dir}.',
    'intro.fair':
      'Condizioni nella media: il colore potrebbe esserci a tratti. Il sole {verb} verso {dir}.',
    'intro.mediocre':
      'Cielo poco favorevole: nubi o foschia smorzano le tinte. Il sole {verb} verso {dir}.',
    'intro.poor': 'Cielo chiuso: colori improbabili stavolta. Il sole {verb} verso {dir}.',

    'section.week': 'Questa settimana',
    'week.caption': 'Migliore {day} · {score}/100',
    'section.conditions': 'Condizioni',
    'cond.highCloud': 'Nuvole alte',
    'cond.lowCloud': 'Nuvole basse',
    'cond.midNote': 'Più {mid}% di nuvole medie.',
    'desc.litCirrus': 'cirri illuminati',
    'desc.heavyHigh': 'velatura fitta',
    'desc.fewHigh': 'poche nubi alte',
    'desc.clearHorizon': 'orizzonte libero',
    'desc.someLow': 'qualche nube bassa',
    'desc.blockedLow': 'orizzonte coperto',
    'desc.crispAir': 'aria tersa',
    'desc.okVis': 'discreta',
    'desc.hazyVis': 'foschia',
    'desc.dryAir': 'aria secca',
    'desc.okHum': 'nella media',
    'desc.humidAir': 'aria umida',
    'desc.pathClear': 'via libera al sole',
    'desc.pathPartial': 'nubi lontane sparse',
    'desc.pathBlocked': 'nubi lontane a muro',
    'desc.pathLoading': 'calcolo in corso…',
    'desc.pathUnknown': 'dato non disponibile',

    'why.addsUp': 'Come si compone',
    'why.baseline': 'Base',
    'why.drama': 'Intensità',
    'why.clarity': 'Nitidezza',
    'why.footnote': 'Nubi basse e cielo coperto possono ridurre il punteggio finale.',
    'why.showAll': 'Mostra tutti ({n})',
    'why.showLess': 'Mostra meno',
    'why.legendGood': 'Aiuta',
    'why.legendNeutral': 'Neutro',
    'why.legendBad': 'Penalizza',
    'why.missing': 'Cosa manca per salire',
    'why.missingFoot': 'Quanto varrebbe, da solo, ciascun ingrediente mancante.',
    'upside.cirrus.title': 'Cirri alti · +{gain}',
    'upside.cirrus.detail': 'Con un velo di nuvole alte attorno al 50% saliresti a ~{target}.',
    'upside.horizon.title': 'Orizzonte libero · +{gain}',
    'upside.horizon.detail': 'Senza nuvole basse a chiudere l’orizzonte saliresti a ~{target}.',
    'upside.clearAir.title': 'Aria tersa · +{gain}',
    'upside.clearAir.detail': 'Con aria più limpida e secca saliresti a ~{target}.',
    'upside.haze.title': 'Meno foschia · +{gain}',
    'upside.haze.detail': 'Con meno pulviscolo in sospensione saliresti a ~{target}.',
    'upside.path.title': 'Via libera al sole · +{gain}',
    'upside.path.detail': 'Con il percorso della luce sgombro a 40–250 km saliresti a ~{target}.',

    'trend.arc': 'L’arco di stasera',
    'trend.predicted': 'Colore previsto',

    'section.atmosphere': 'Atmosfera',
    'atmo.aerosolCap': 'esalta i rossi',
    'atmo.horizon': 'Orizzonte',
    'atmo.horizonCap': 'da {m} m di quota',
    'atmo.tempCap.sunset': 'al tramonto',
    'atmo.tempCap.sunrise': 'all’alba',

    'spot.dualLegend': 'numero grande = affaccio · cielo NN = il colore lì',
    'spot.estTag': 'STIM',
    'unit.m': 'm',
    'unit.km': 'km',
    'unit.min': 'min',
    'spots.seeAll': 'Vedi tutti i punti ({n})',
    'spots.seeLess': 'Mostra meno',
    'cmp.heading': 'Confronto',
    'cmp.sub.sunset': 'Prossimo tramonto · i tuoi luoghi',
    'cmp.sub.sunrise': 'Prossima alba · i tuoi luoghi',
    'cmp.best': 'MIGLIORE STASERA',
    'cmp.foot.sunset': 'Calcolato dal meteo reale di ogni luogo al tramonto.',
    'cmp.foot.sunrise': 'Calcolato dal meteo reale di ogni luogo all’alba.',
    'share.title.sunset': 'Condividi il tramonto di stasera',
    'share.title.sunrise': 'Condividi l’alba di stamattina',
    'share.image': 'Condividi immagine',
    'share.save': 'Salva immagine',
    'share.copy': 'Copia link',
  },

  en: {
    'app.tagline':
      'How good will the next sunset be? A score from live weather and astronomical data.',
    'search.placeholder': 'Search a city…',
    'search.aria': 'Search a city',
    'search.suggestAria': 'Search suggestions',
    'search.submit': 'Calculate',
    'search.geo': 'Location',
    'search.geoTitle': 'Use my location',
    'mode.groupAria': 'Time of day',
    'fav.groupAria': 'Favourite locations',
    'theme.aria': 'Toggle theme',
    'lang.aria': 'Change language',
    'mode.sunset': 'Sunset',
    'mode.sunrise': 'Sunrise',

    'event.sunset': 'Sunset',
    'event.sunrise': 'Sunrise',
    'verb.willSet': 'will set',
    'verb.willRise': 'will rise',
    'verb.sets': 'sets',
    'verb.rises': 'rises',

    'detail.favSave': 'Save to favourites',
    'detail.shareAria': 'Share',
    'detail.expand': 'Expand',
    'detail.openMap': 'Open full map · all spots',
    'stat.direction': 'Sun direction',
    'stat.temp': 'Temperature',
    'stat.visibility': 'Visibility',
    'stat.humidity': 'Humidity',
    'stat.aerosol': 'Aerosol · PM2.5',
    'stat.moon': 'Moon',
    'stat.lightPath': 'Light path',

    'section.point': 'Analysed point',
    'grid.note': 'Requested point {reqLat}, {reqLon} · weather cell {gLat}, {gLon}',
    'section.lookAt': 'Where to look',
    'lookAt.text': 'The sun {verb} to the {dir} ({deg}°).',
    'light.golden': 'Golden hour',
    'light.blue': 'Blue hour',
    'section.trend': 'Sky trend around {when}',
    'trend.hint': 'Score hour by hour — the highlighted column is {when}.',
    'when.sunset': 'sunset',
    'when.sunrise': 'sunrise',
    'when.sunset2': 'sunset',
    'when.sunrise2': 'sunrise',
    'section.why': 'Why this score',

    'section.spots': 'Where to watch it',
    'spots.dirNote':
      'The sun {verb} towards <strong>{dir}</strong> ({deg}°) — pick a spot with a clear view that way.',
    'spots.loading': 'Finding nearby spots and checking their view towards the sunset…',
    'spots.error': 'Viewpoints unavailable right now.',
    'spots.none': 'No mapped viewpoints within ~25 km.',
    'spots.scan': 'Also search unmapped spots (estimate)',
    'spots.scanning': 'Scanning the terrain…',
    'spots.estimateHint':
      'Spots estimated from terrain shape: unnamed and not guaranteed accessible (check roads/access on the map).',
    'spots.estimateError': 'Estimate failed, try again.',
    'spots.estimateNone': 'No promising spot found from the estimate.',
    'spot.sky': 'sky {n}',
    'spot.openOsm': 'Open in OSM ↗',
    'spot.viewQuality': 'View quality',
    'spot.skyTitle': 'Sky Sunset Score',

    'fav.compare': 'Compare',
    'fav.remove': 'Remove',
    'cmp.calc': 'Computing scores…',
    'cmp.na': 'data unavailable',
    'cmp.close': 'Close',

    'banner.top': 'Great {noun} coming: {day} {score}/100 — the best of the next days',

    'status.fetching': 'Fetching data for {label}…',
    'status.searching': 'Searching location…',
    'status.noResults': 'No location found. Try another name.',
    'status.error': 'Error: {msg}',
    'status.geolocating': 'Detecting location…',
    'status.geoUnsupported': 'Geolocation not supported by the browser.',
    'status.geoUnavailable': 'Location unavailable: {msg}',
    'status.linkCopied': 'Link copied to clipboard ✓',
    'status.imgSaved': 'Image saved ✓',
    'status.imgError': 'Could not generate the image.',
    'geo.here': 'Your location',
    'map.pointLabel': 'Point on the map ({lat}, {lon})',
    'share.text': '{noun} {score}/100 at {label} — SkyHue',
    'share.imgTime': '{noun} at {time} · {day}',

    'map.hint': 'Tap a point on the map to evaluate it',
    'map.back': 'Back',
    'map.attribution': 'Map information and credits',
    'map.legend': 'Legend',
    'map.legend.point': 'Analysed point',
    'map.legend.sun': 'Sun on the horizon',
    'map.legend.ray': 'Sun direction',
    'map.legend.good': 'Clear view',
    'map.legend.neutral': 'Uncertain view',
    'map.legend.bad': 'Obstructed horizon',
    'map.legend.visibility': 'Visibility',
    'mp.calc': 'Computing sunset, view and nearby spots…',
    'mp.na': 'Data unavailable for this point. Try again.',
    'map.loadError': 'Unable to load the map (connection required).',
    'map.markerPopup': 'Sunset Score {score} · {event} towards {dir} ({deg}°)',
    'mappop.view': 'view',
    'mappop.sky': 'sky',
    'mappop.towards': 'towards {dir}',

    'label.exceptional': 'Exceptional',
    'label.great': 'Great',
    'label.good': 'Good',
    'label.fair': 'Fair',
    'label.mediocre': 'Mediocre',
    'label.poor': 'Poor',

    'kind.viewpoint': 'Viewpoint',
    'kind.lighthouse': 'Lighthouse',
    'kind.cape': 'Headland',
    'kind.cliff': 'Cliff',
    'kind.peak': 'Peak',
    'kind.beach': 'Beach',
    'kind.estimate': 'Estimated point',

    'verdict.notEvaluated': 'View not evaluated',
    'verdict.obstructed': 'Horizon obstructed towards the sunset',
    'verdict.openSea': 'Open view over the sea',
    'verdict.openNoSea': 'Open horizon but no open sea',
    'verdict.openLand': 'Open horizon towards the sunset',

    'explain.highGood.title': 'Favourable high clouds',
    'explain.highGood.detail': 'Cirrus at {high}%: they catch and spread the low grazing light.',
    'explain.highMuch.title': 'Lots of high cloud',
    'explain.highMuch.detail': 'High cover at {high}%: the sky may be too veiled.',
    'explain.highFew.title': 'Few high clouds',
    'explain.highFew.detail': 'No cirrus to light up the sky: a plainer sunset.',
    'explain.midGood.title': 'Well-spread mid clouds',
    'explain.midGood.detail': 'Mid layer at {mid}%: adds depth and nuance.',
    'explain.lowBad.title': 'Low clouds on the horizon',
    'explain.lowBad.detail': 'Low cover at {low}%: may block the sun on the horizon.',
    'explain.lowSome.title': 'Some low cloud',
    'explain.lowSome.detail': 'Low clouds at {low}%: horizon partly disturbed.',
    'explain.lowClear.title': 'Clear horizon',
    'explain.lowClear.detail': 'Few low clouds: the sun will reach the horizon unobstructed.',
    'explain.overcast.title': 'Overcast sky',
    'explain.overcast.detail': 'Total cover at {total}%: little direct light.',
    'explain.visGood.title': 'Excellent visibility',
    'explain.visGood.detail': 'Clear air ({visKm} km): crisp, saturated colours.',
    'explain.visBad.title': 'Reduced visibility',
    'explain.visBad.detail': 'Only {visKm} km of visibility: haze or particulate in the air.',
    'explain.hazeBad.title': 'Particulate haze',
    'explain.hazeBad.detail': 'High aerosol{pm25note}: light scatters and colours fade.',
    'explain.hazeBad.pm25': ' (PM2.5 {pm25} µg/m³)',
    'explain.aerosolGood.title': 'Favourable aerosol',
    'explain.aerosolGood.detail': 'A moderate haze in the air tends to light up reds and oranges.',
    'explain.humidHigh.title': 'High humidity',
    'explain.humidHigh.detail': 'Humidity at {humidity}%: more muted colours.',
    'explain.humidDry.title': 'Dry air',
    'explain.humidDry.detail': 'Humidity at {humidity}%: favours intense colours.',
    'explain.pathBlocked.title': 'Light blocked far away',
    'explain.pathBlocked.detail':
      'A distant front toward the sun kills the grazing light before it arrives (only {clear}% gets through).',
    'explain.pathPartial.title': 'Distant clouds on the path',
    'explain.pathPartial.detail':
      'Clouds 40–250 km toward the sun filter part of the light ({clear}% gets through).',
    'explain.pathClear.title': 'Incoming light unblocked',
    'explain.pathClear.detail':
      'The path toward the sun is {clear}% clear: grazing light can ignite your clouds from below.',

    'moon.new': 'New moon',
    'moon.waxingCrescent': 'Waxing crescent',
    'moon.firstQuarter': 'First quarter',
    'moon.waxingGibbous': 'Waxing gibbous',
    'moon.full': 'Full moon',
    'moon.waningGibbous': 'Waning gibbous',
    'moon.lastQuarter': 'Last quarter',
    'moon.waningCrescent': 'Waning crescent',

    'foot.credits':
      'Weather &amp; astronomical data from <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a>. Solar position via the NOAA algorithm.',

    // --- Redesign "Atmosphere" ---
    'menu.aria': 'More options',
    'menu.theme': 'Theme',
    'menu.lang': 'Language',
    'home.headline': 'Chase<br />the light.',
    'fav.title': 'Your places',
    'map.pickSpot': 'Pick a spot on the map',
    'map.pickTitle': 'Pick a spot',
    'map.pointName': 'Point on the map',
    'mp.openDetail': 'Open full detail →',
    'results.scoreOutOf': '/ 100 score',
    'time.tonight': 'Tonight',
    'rhero.change': 'Change location',
    'rhero.searchAria': 'New search',

    'headline.exceptional.sunset': 'An\nunmissable\nsunset.',
    'headline.exceptional.sunrise': 'An\nunmissable\nsunrise.',
    'headline.great.sunset': 'Great\nsunset\nahead.',
    'headline.great.sunrise': 'Great\nsunrise\nahead.',
    'headline.good.sunset': 'A good\nsunset\ntonight.',
    'headline.good.sunrise': 'A good\nsunrise\nthis morning.',
    'headline.fair.sunset': 'A fair\nsunset\nahead.',
    'headline.fair.sunrise': 'A fair\nsunrise\nahead.',
    'headline.mediocre.sunset': 'A muted\nsunset\ntonight.',
    'headline.mediocre.sunrise': 'A muted\nsunrise\nthis morning.',
    'headline.poor.sunset': 'A dull\nsunset\nahead.',
    'headline.poor.sunrise': 'A dull\nsunrise\nahead.',

    'intro.exceptional':
      'A clear, lit-up sky — high cirrus and crisp air promise vivid colour. The sun {verb} to the {dir}.',
    'intro.great':
      'A clear, lit-up sky — high cirrus and crisp air line up for vivid colour. The sun {verb} to the {dir}.',
    'intro.good':
      'Good conditions for colour, with some helpful high cloud. The sun {verb} to the {dir}.',
    'intro.fair': 'Average conditions — colour may come and go. The sun {verb} to the {dir}.',
    'intro.mediocre':
      'Unfavourable sky — cloud or haze mutes the tones. The sun {verb} to the {dir}.',
    'intro.poor': 'A closed sky — colour is unlikely this time. The sun {verb} to the {dir}.',

    'section.week': 'This week',
    'week.caption': 'Best {day} · {score}/100',
    'section.conditions': 'Conditions',
    'cond.highCloud': 'High cloud',
    'cond.lowCloud': 'Low cloud',
    'cond.midNote': 'Plus {mid}% mid cloud.',
    'desc.litCirrus': 'lit cirrus',
    'desc.heavyHigh': 'heavy veil',
    'desc.fewHigh': 'few high clouds',
    'desc.clearHorizon': 'clear horizon',
    'desc.someLow': 'some low cloud',
    'desc.blockedLow': 'blocked horizon',
    'desc.crispAir': 'crisp air',
    'desc.okVis': 'decent',
    'desc.hazyVis': 'hazy',
    'desc.dryAir': 'dry air',
    'desc.okHum': 'average',
    'desc.humidAir': 'humid air',
    'desc.pathClear': 'clear run to the sun',
    'desc.pathPartial': 'some distant clouds',
    'desc.pathBlocked': 'distant cloud wall',
    'desc.pathLoading': 'checking…',
    'desc.pathUnknown': 'not available',

    'why.addsUp': 'How it adds up',
    'why.baseline': 'Baseline',
    'why.drama': 'Sky drama',
    'why.clarity': 'Clarity',
    'why.footnote': 'Low cloud and overcast can pull the final score down.',
    'why.showAll': 'Show all ({n})',
    'why.showLess': 'Show less',
    'why.legendGood': 'Helps',
    'why.legendNeutral': 'Neutral',
    'why.legendBad': 'Hurts',
    'why.missing': "What's missing to climb",
    'why.missingFoot': 'What each missing ingredient would be worth on its own.',
    'upside.cirrus.title': 'High cirrus · +{gain}',
    'upside.cirrus.detail': "With a ~50% veil of high cloud you'd climb to ~{target}.",
    'upside.horizon.title': 'Clear horizon · +{gain}',
    'upside.horizon.detail': "Without low cloud sealing the horizon you'd climb to ~{target}.",
    'upside.clearAir.title': 'Crisp air · +{gain}',
    'upside.clearAir.detail': "With clearer, drier air you'd climb to ~{target}.",
    'upside.haze.title': 'Less haze · +{gain}',
    'upside.haze.detail': "With less suspended haze you'd climb to ~{target}.",
    'upside.path.title': 'Clear light path · +{gain}',
    'upside.path.detail': "With a clear light path 40–250 km out you'd climb to ~{target}.",

    'trend.arc': "Tonight's arc",
    'trend.predicted': 'Predicted colour',

    'section.atmosphere': 'Atmosphere',
    'atmo.aerosolCap': 'warms the reds',
    'atmo.horizon': 'Horizon',
    'atmo.horizonCap': 'from {m} m elev.',
    'atmo.tempCap.sunset': 'at sunset',
    'atmo.tempCap.sunrise': 'at sunrise',

    'spot.dualLegend': 'big number = the view · sky NN = the colour there',
    'spot.estTag': 'EST',
    'unit.m': 'm',
    'unit.km': 'km',
    'unit.min': 'min',
    'spots.seeAll': 'See all spots ({n})',
    'spots.seeLess': 'Show less',
    'cmp.heading': 'Compare',
    'cmp.sub.sunset': 'Next sunset · your places',
    'cmp.sub.sunrise': 'Next sunrise · your places',
    'cmp.best': 'BEST TONIGHT',
    'cmp.foot.sunset': "Scored from each place's live weather at sunset.",
    'cmp.foot.sunrise': "Scored from each place's live weather at sunrise.",
    'share.title.sunset': "Share tonight's sunset",
    'share.title.sunrise': "Share this morning's sunrise",
    'share.image': 'Share image',
    'share.save': 'Save image',
    'share.copy': 'Copy link',
  },
};

// Esposto per i test di completezza (parità delle chiavi tra le lingue).
export const DICTIONARIES = DICT;

let lang = 'it';

/** Inizializza la lingua da localStorage o dalle preferenze di sistema. */
export function initLang() {
  try {
    const s = localStorage.getItem('skyhue.lang');
    if (s === 'en' || s === 'it') lang = s;
    else lang = (navigator.language || 'it').toLowerCase().startsWith('en') ? 'en' : 'it';
  } catch {
    lang = 'it';
  }
  return lang;
}

export function getLang() {
  return lang;
}

export function setLang(l) {
  lang = l === 'en' ? 'en' : 'it';
  try {
    localStorage.setItem('skyhue.lang', lang);
  } catch {
    /* storage non disponibile */
  }
  return lang;
}

/** Traduce una chiave con interpolazione {nome}. Fallback: IT, poi la chiave. */
export function t(key, params) {
  const table = DICT[lang] || DICT.it;
  let s = key in table ? table[key] : key in DICT.it ? DICT.it[key] : key;
  if (params) {
    for (const k in params) {
      s = s.split('{' + k + '}').join(params[k]);
    }
  }
  return s;
}

/** Traduce il codice fase lunare / etichetta / verdetto (helper comodi). */
export const cardinalMap = { N: 'N', NE: 'NE', E: 'E', SE: 'SE', S: 'S', SO: 'SW', O: 'W', NO: 'NW' };

/** Localizza una direzione cardinale (IT usa O/SO/NO; EN W/SW/NW). */
export function cardinal(card) {
  return lang === 'en' ? cardinalMap[card] || card : card;
}

/** Applica le traduzioni agli elementi statici marcati nel markup. */
export function applyStaticI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.getAttribute('data-i18n-html'));
  });
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
  });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    const s = t(el.getAttribute('data-i18n-aria'));
    el.setAttribute('aria-label', s);
    el.setAttribute('title', s);
  });
}
