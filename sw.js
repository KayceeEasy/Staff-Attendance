importScripts('./version.js');
// Force update 2
const CACHE_NAME = 'staff-attendance-v' + (typeof APP_VERSION !== 'undefined' ? APP_VERSION : '26');
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
  const versionedShell = APP_SHELL.map(url => url + (url.includes('?') ? '&' : '?') + 'v=' + (typeof APP_VERSION !== 'undefined' ? APP_VERSION : Date.now()));
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(versionedShell))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Bypass service worker completely for admin, watch-tower, and super-admin portals
  if (event.request.url.includes('/admin/') || event.request.url.includes('/watch-tower/') || event.request.url.includes('/super-admin/')) return;

  // Network-First for HTML navigation so users never get trapped in stale app shells
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse.clone()));
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request, { ignoreSearch: true }))
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cachedResponse = await cache.match(event.request, { ignoreSearch: true });
      
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
