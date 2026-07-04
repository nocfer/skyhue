// sw.js — service worker: shell offline + cache dell'ultima risposta API.
const CACHE = 'skyhue-v3';

// File del guscio applicativo da pre-cachare (percorsi relativi allo scope).
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './src/styles.css',
  './src/main.js',
  './src/api.js',
  './src/score.js',
  './src/astronomy.js',
  './src/store.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isApi = url.hostname.endsWith('open-meteo.com');
  const sameOrigin = url.origin === self.location.origin;

  // Risorse di terze parti (es. mattonelle della mappa): lasciale alla rete,
  // senza intercettarle né metterle in cache.
  if (!isApi && !sameOrigin) return;

  if (isApi) {
    // API: network-first, con fallback all'ultima risposta salvata (offline).
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Guscio: cache-first, con aggiornamento in rete quando disponibile.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
