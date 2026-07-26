importScripts('./version.js');
const CACHE_NAME = 'staff-attendance-v' + (typeof APP_VERSION !== 'undefined' ? APP_VERSION : '20');
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './common.js',
  './manifest.json',
  './version.js',
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
 * Fetch handler:
 * BYPASS service worker for any /admin/ requests so admin console is NEVER cached.
 */
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Bypass service worker completely for admin endpoints
  if (event.request.url.includes('/admin/')) return;

  const url = new URL(event.request.url);
  const isCodeAsset = url.pathname.endsWith('.css') || url.pathname.endsWith('.js') || url.pathname.endsWith('.html');

  if (isCodeAsset) {
    // Network-First for CSS/JS/HTML: fetch fresh code first, update cache, fallback to cache if offline
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-First for static images/media
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

        return cached || networkFetch.then((networkResponse) => networkResponse || caches.match('./index.html'));
      })
    )
  );
});
