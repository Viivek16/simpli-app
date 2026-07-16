const CACHE = 'simpli-v4';
// The notification art is precached: a push should render it the instant it lands,
// and a fetch at display time is a race the notification can lose.
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/badge-96.png', '/notif-192.png'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (req.headers.get('upgrade') === 'websocket') return;

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/index.html')));
    return;
  }

  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'SIMPLI', body: 'New activity in your galaxies', url: '/', tag: 'simpli' };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch {}
  event.waitUntil(
    // The title is the galaxy name, not 'SIMPLI' — the shade already prints the app
    // name above it, so a 'SIMPLI' title just says it twice.
    self.registration.showNotification(data.title || 'SIMPLI', {
      body: data.body || '',
      // MUST stay monochrome-on-transparent. Android throws the colour away and uses
      // the alpha as a stencil, tinting it to suit the user's light/dark theme — which
      // is what makes it adapt for free. Pointing this at an opaque image (as it was)
      // stencils a solid block.
      badge: '/badge-96.png',
      // Circular tile: Android 12+ circle-crops the large icon, and the shades that
      // don't crop exposed the square app icon's raw edges.
      icon: '/notif-192.png',
      // Per-galaxy, so two groups stack as separate threads instead of silently
      // overwriting each other, while repeat activity in one galaxy collapses.
      tag: data.tag || 'simpli',
      renotify: true,
      timestamp: Date.now(),
      data: { url: data.url || '/' },
      actions: [{ action: 'open', title: 'View' }],
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          if ('navigate' in client && target !== '/') { try { client.navigate(target); } catch {} }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
