const CACHE_NAME = 'ultimo-legado-performance-14';
const SHELL = ['./', './index.html', './style.css', './game.js', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];

// Update 13: remove obsolete offline shells and avoid falling back to an old HTML document.
self.addEventListener('message', event => {
  if (event.data === 'CLEAR_OLD_GAME_CACHES') {
    event.waitUntil(caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    )));
  }
});

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request).then(response => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    }).catch(() => caches.match(request).then(cached => cached || caches.match('./index.html')))
  );
});