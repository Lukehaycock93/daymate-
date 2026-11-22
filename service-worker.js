/* ==========================================================================
   DAYMATE — service-worker.js (Stage 1 foundation)
   Offline-capable app shell. All paths are relative so it works on GitHub
   Pages project sites (https://user.github.io/repo/).

   IMPORTANT: bump VERSION every time you deploy changed files. That creates
   a fresh cache and tells installed copies of the app that an update exists.
   ========================================================================== */
const VERSION = 'v0.1.0';
const CACHE = `daymate-${VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './assets/logo-mark.svg',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)));
  // No automatic skipWaiting: the page offers an "Update" button instead.
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('daymate-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch third-party requests (future Supabase/Stripe calls)

  // Page loads: network first, fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // Everything else: stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
