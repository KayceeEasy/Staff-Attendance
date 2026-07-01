const CACHE_NAME = 'staff-attendance-v8';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './common.js',
  './manifest.json',
  './image/png/icon-192.png',
  './image/png/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

/**
 * Stale-while-revalidate: serve the cached response immediately if
 * present (fast, works offline), but always fire a background fetch
 * to update the cache with the latest version for next time. This
 * means a fix can ship without anyone needing to manually hit
 * Refresh - it just takes one extra reload for the new version to
 * "catch up" in cache, instead of being stuck on whatever version
 * was first installed.
 */
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(event.request).then((cached) => {
        const networkFetch = fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.ok) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch(() => null);

        if (cached) {
          // Don't block on the network update; let it happen in the background.
          networkFetch;
          return cached;
        }

        return networkFetch.then((networkResponse) => networkResponse || caches.match('./index.html'));
      })
    )
  );
});
