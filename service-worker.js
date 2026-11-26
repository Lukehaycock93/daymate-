/* ==========================================================================
   DAYMATE — service-worker.js (Part 2: offline shell + Web Push)
   Offline-capable app shell. All paths are relative so it works on GitHub
   Pages project sites (https://user.github.io/repo/).

   IMPORTANT: bump VERSION every time you deploy changed files. That creates
   a fresh cache and tells installed copies of the app that an update exists.
   ========================================================================== */
const VERSION = 'v0.6.0';
const CACHE = `daymate-${VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './assistant.css',
  './app.js',
  './js/main.js',
  './js/assistant.js',
  './js/auth.js',
  './js/billing.js',
  './js/ads.js',
  './terms.html',
  './js/config.js',
  './js/consent.js',
  './privacy.html',
  './js/mapping.js',
  './js/memory.js',
  './js/migration.js',
  './js/notifications.js',
  './js/planner.js',
  './js/push.js',
  './js/recur.js',
  './js/schedule.js',
  './js/session.js',
  './js/theme.js',
  './js/dashboard.js',
  './js/supabase.js',
  './js/sync.js',
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
  // cache:'reload' skips the browser's HTTP cache so a new version never installs stale files.
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.all(APP_SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' }))))));
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


/* ---------------------------------------------------------------------------
   Web Push. The server (Supabase Edge Function) sends the payload; this only
   displays it. Browsers require that every push shows a notification, so a
   malformed payload still produces a generic one.
   --------------------------------------------------------------------------- */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = { body: event.data ? event.data.text() : '' }; }
  const title = String(data.title || 'DAYMATE').slice(0, 120);
  const options = {
    body: String(data.body || '').slice(0, 240),
    tag: data.tag || undefined,
    icon: './icons/icon-192.png',
    badge: './icons/favicon-32.png',
    data: { url: typeof data.url === 'string' ? data.url : './#/notifications' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || './#/notifications', self.registration.scope);
  if (target.origin !== self.location.origin) return;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if (client.url.startsWith(self.registration.scope)) {
        await client.focus();
        if ('navigate' in client) { try { await client.navigate(target.href); } catch (_) { /* ignore */ } }
        return;
      }
    }
    await self.clients.openWindow(target.href);
  })());
});
