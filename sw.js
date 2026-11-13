'use strict';

const CACHE_NAME = 'ipon-shell-v10';
const STATIC_ASSETS = [
  'manifest.webmanifest',
  'assets/favicon.svg',
  'assets/icon-192.png',
  'assets/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    const text = event.data ? event.data.text() : '';
    payload = text ? { body: text } : {};
  }
  const title = payload.title || 'myIPON';
  const options = {
    body: payload.body || payload.message || 'You have a new notification.',
    icon: '/assets/icon-192.png',
    badge: '/assets/icon-192.png',
    tag: payload.tag || `myipon-${Date.now()}`,
    data: { url: payload.url || payload.link || '/dashboard.html' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const rawTarget = event.notification.data?.url || '/dashboard.html';
  const targetUrl = new URL(rawTarget, self.location.origin).href;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      if (client.url.startsWith(self.location.origin)) {
        await client.focus();
        if ('navigate' in client && client.url !== targetUrl) {
          await client.navigate(targetUrl).catch(() => {});
        }
        return;
      }
    }
    await self.clients.openWindow(targetUrl);
  })());
});

