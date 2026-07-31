// Service worker for PWA install + offline (SPEC.md §9 file layout).
//
// Bump CACHE_NAME whenever index.html or the shell files below change, so
// clients pick up the new version instead of serving a stale cache forever.
const CACHE_NAME = 'critteria-shell-v1';
const ASSET_CACHE_NAME = 'critteria-assets-v1';

const SHELL_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'assets/icon-192.png',
  'assets/icon-512.png',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(SHELL_FILES); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) { return key !== CACHE_NAME && key !== ASSET_CACHE_NAME; })
            .map(function (key) { return caches.delete(key); })
        );
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept the API — pet state must always hit the network (or
  // fail loudly so the app's own offline/localStorage fallback kicks in).
  if (url.pathname.startsWith('/api/')) return;

  // Sprites, palettes, etc.: cache-first. They're immutable once drawn (a
  // changed pose gets a new filename per SPEC.md §4 "Adding a pose"), so a
  // stale cache entry isn't a real risk and this is what makes species art
  // available offline after first load.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(ASSET_CACHE_NAME).then(function (cache) {
        return cache.match(request).then(function (cached) {
          if (cached) return cached;
          return fetch(request).then(function (response) {
            if (response.ok) cache.put(request, response.clone());
            return response;
          });
        });
      })
    );
    return;
  }

  // App shell (index.html, manifest, this file's own updates): network-first
  // so a foregrounded device with connectivity always gets the latest build,
  // falling back to cache when offline.
  event.respondWith(
    fetch(request)
      .then(function (response) {
        if (response.ok) {
          caches.open(CACHE_NAME).then(function (cache) { cache.put(request, response.clone()); });
        }
        return response;
      })
      .catch(function () { return caches.match(request).then(function (cached) { return cached || caches.match('index.html'); }); })
  );
});
