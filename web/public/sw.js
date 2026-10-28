// Pit Wall service worker: only shows notifications (reminders, Safety Car and red flag alerts,
// results) pushed by the GitHub Action, and opens the Pit Wall when one is tapped. No caching.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let m = { title: 'Pit Wall', body: '' };
  try {
    m = e.data ? e.data.json() : m;
  } catch {
    m.body = e.data ? e.data.text() : '';
  }
  e.waitUntil(
    self.registration.showNotification(m.title, {
      body: m.body,
      tag: m.tag,
      renotify: !!m.tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: m.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // Bring an open Pit Wall to the front rather than opening another.
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow(url);
    }),
  );
});
