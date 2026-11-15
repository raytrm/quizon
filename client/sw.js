const CACHE_NAME = 'quizon-v1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/tv.html',
  '/player.html',
  '/host.html',
  '/manifest.json',
  '/css/global.css',
  '/css/animations.css',
  '/css/tv.css',
  '/css/player.css',
  '/css/host.css',
  '/js/common/connection.js',
  '/js/common/audio.js',
  '/js/common/utils.js',
  '/js/tv.js',
  '/js/player.js',
  '/js/host.js',
  '/assets/icons/icon.svg',
  '/assets/images/jupiter.svg',
  '/assets/images/orion.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/socket.io') || url.pathname.startsWith('/api') || url.pathname === '/health') {
    return;
  }

  // Assets estáticos: Cache-First
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
    return;
  }

  // HTML/JS/CSS: Network-First con fallback a caché
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});

