const CACHE_NAME = 'ultimo-legado-offline-15';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './game.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png'
];

// External resources required by the current client. They are cached after the
// first successful online load so the shell can reopen without a connection.
const EXTERNAL_HOSTS = new Set([
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'opengameart.org'
]);

self.addEventListener('message', event => {
  if (event.data === 'CLEAR_OLD_GAME_CACHES') {
    event.waitUntil(caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    )));
  }
});

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key.startsWith('ultimo-legado-') && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, cache, fallbackToAppShell = false) {
  try {
    const response = await fetch(request);
    if (response && (response.ok || response.type === 'opaque')) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (fallbackToAppShell) {
      const shell = await caches.match('./index.html');
      if (shell) return shell;
    }
    return Response.error();
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  const sameOrigin = url.origin === self.location.origin;
  const approvedExternal = EXTERNAL_HOSTS.has(url.hostname);
  if (!sameOrigin && !approvedExternal) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      networkFirst(request, cache, sameOrigin && request.mode === 'navigate')
    )
  );
});
