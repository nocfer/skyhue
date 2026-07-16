// sw.js — service worker: offline shell + cache of the last API response.
// The CACHE version is a content hash of the SHELL files, stamped by
// `npm run stamp` (tools/stamp-sw.mjs). Do NOT edit it by hand — CI's
// `npm run stamp:check` fails the build if it is stale.
const CACHE = "skyhue-93684bfe";

// App-shell files to pre-cache (paths relative to the scope).
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon.svg",
  "./src/styles.css",
  "./src/main.js",
  "./src/api.js",
  "./src/score.js",
  "./src/astronomy.js",
  "./src/store.js",
  "./src/sky.js",
  "./src/spots.js",
  "./src/map.js",
  "./src/icons.js",
  "./src/i18n.js",
  "./src/cache.js",
  "./src/ui.js",
  "./src/lightpath.js",
  "./src/render.js",
  "./src/state.js",
  "./src/format.js",
  "./src/views.js",
  "./src/share.js",
  "./src/favorites.js",
  "./src/suggest.js",
  "./src/animate.js",
  "./src/fonts/bricolage-grotesque.woff2",
  "./src/fonts/space-grotesk.woff2",
  "./src/fonts/jetbrains-mono.woff2",
];

// CDN hosts whose modules the app loads at runtime (lit-html via esm.sh,
// Leaflet via jsdelivr). We runtime-cache these cache-first so the app and the
// map work offline after the first successful load. Transitive dependencies are
// covered automatically because each fetched sub-module is cached on the way in.
// Map tiles (basemaps.cartocdn.com) are deliberately NOT cached — too many, too
// large — so the map still degrades to "connection required" offline.
const CDN_HOSTS = ["esm.sh", "cdn.jsdelivr.net"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Cache-first: serve the cached copy if present, otherwise fetch and cache it.
// Used for immutable, versioned CDN modules (pinned lit-html / Leaflet URLs).
function cacheFirst(request) {
  return caches.match(request).then(
    (cached) =>
      cached ||
      fetch(request).then((res) => {
        if (res.ok || res.type === "opaque") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      }),
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const isApi = url.hostname.endsWith("open-meteo.com");
  const isCdn = CDN_HOSTS.includes(url.hostname);
  const sameOrigin = url.origin === self.location.origin;

  if (isApi) {
    // API: network-first, falling back to the last saved response (offline).
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request)),
    );
    return;
  }

  // Pinned CDN modules (lit-html, Leaflet): cache-first so they work offline.
  if (isCdn) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Other third-party resources (e.g. map tiles): leave them to the network,
  // without intercepting or caching them.
  if (!sameOrigin) return;

  // Shell: stale-while-revalidate. Serve the cached copy immediately and, in the
  // background, refresh the cache from the network so the *next* load is fresh
  // even if the CACHE version was not bumped. On a cache miss, await the network.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => cached);
      // Keep the SW alive until the background refresh settles (best-effort).
      if (cached) event.waitUntil(network.catch(() => {}));
      return cached || network;
    }),
  );
});
