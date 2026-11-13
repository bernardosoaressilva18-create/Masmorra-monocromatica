const CACHE_NAME = 'ultimo-legado-offline-37';
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

// Recursos externos necessários para iniciar o renderizador 3D e a interface.
// Eles só ficam disponíveis offline depois de uma primeira visita com internet.
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
      .then(async cache => {
        await cache.addAll(SHELL);
        // Pré-carrega Three.js: sem esse módulo o jogo 3D não consegue iniciar offline.
        try {
          const three = new Request('https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js', { mode: 'cors' });
          const response = await fetch(three);
          if (response.ok) await cache.put(three, response);
        } catch (error) {
          // A instalação do shell continua mesmo se a rede bloquear o pré-carregamento.
        }
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('ultimo-legado-') && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  const allowedExternal = EXTERNAL_HOSTS.has(url.hostname);
  if (!sameOrigin && !allowedExternal) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);

    try {
      const response = await fetch(request);
      if (response && (response.ok || response.type === 'opaque')) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    } catch (error) {
      if (cached) return cached;
      if (sameOrigin && request.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      return new Response('Recurso ainda não disponível offline. Abra o jogo uma vez com internet para armazená-lo.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  })());
});
