// sw.js — service worker: offline shell + cache of the last API response.
const CACHE = 'skyhue-v40';

// App-shell files to pre-cache (paths relative to the scope).
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
  './src/sky.js',
  './src/spots.js',
  './src/map.js',
  './src/icons.js',
  './src/i18n.js',
  './src/cache.js',
  './src/ui.js',
  './src/lightpath.js',
  './src/fonts/bricolage-grotesque.woff2',
  './src/fonts/space-grotesk.woff2',
  './src/fonts/jetbrains-mono.woff2',
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

  // Third-party resources (e.g. map tiles): leave them to the network,
  // without intercepting or caching them.
  if (!isApi && !sameOrigin) return;

  if (isApi) {
    // API: network-first, falling back to the last saved response (offline).
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

  // Shell: cache-first, updated from the network when available.
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
