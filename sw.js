'use strict';

const CACHE_NAME = 'ipon-shell-v9';
const STATIC_ASSETS = [
  'manifest.webmanifest',
  'assets/favicon.svg',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'css/app.css',
  'js/config.js',
  'js/core.js'
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
    fetch(request)
      .then((response) => {
        if (response && response.ok && (response.type === 'basic' || response.type === 'cors')) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match(request, { ignoreSearch: true })))
  );
});

function normalizeNotificationPath(rawTarget) {
  const value = String(rawTarget || '').trim();
  if (!value) return '/dashboard.html';
  if (/^https?:\/\//i.test(value) || value.startsWith('/')) return value;
  return `/${value}`;
}

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    const text = event.data ? event.data.text() : '';
    payload = text ? { body: text } : {};
  }
  const title = payload.title || 'myIPON';
  const body = payload.body || payload.message || 'You have a new notification.';
  const tag = payload.tag || (payload.dedupe_key ? `myipon-${payload.dedupe_key}` : (payload.id != null ? `myipon-${payload.id}` : `myipon-${Date.now()}`));
  const targetUrl = normalizeNotificationPath(payload.url || payload.link || '/dashboard.html');

  const options = {
    body,
    icon: '/assets/icon-192.png',
    badge: '/assets/icon-192.png',
    tag,
    renotify: Boolean(payload.renotify ?? (payload.tag || payload.dedupe_key)),
    vibrate: [180, 70, 180],
    timestamp: Number(payload.timestamp) || Date.now(),
    data: { url: targetUrl, id: payload.id ?? null, group_id: payload.group_id ?? null }
  };

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      try {
        client.postMessage({
          type: 'MYIPON_PUSH_SHOWN',
          id: payload.id ?? null,
          dedupe_key: payload.dedupe_key ?? null,
          timestamp: options.timestamp,
          message: body
        });
      } catch { /* ignore */ }
    }
    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const rawTarget = normalizeNotificationPath(event.notification.data?.url || '/dashboard.html');
  const parsedTarget = new URL(rawTarget, self.location.origin);
  const targetUrl = parsedTarget.href;
  event.waitUntil((async () => {
    if (parsedTarget.origin !== self.location.origin) {
      await self.clients.openWindow(targetUrl);
      return;
    }
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      if (client.url.startsWith(self.location.origin)) {
        await client.focus().catch(() => {});
        const samePage = new URL(client.url).pathname === parsedTarget.pathname;
        if (samePage && 'postMessage' in client) {
          client.postMessage({
            type: 'MYIPON_NOTIFICATION_CLICK',
            url: `${parsedTarget.pathname.replace(/^\//, '')}${parsedTarget.search}${parsedTarget.hash}`,
            id: event.notification.data?.id ?? null,
            group_id: event.notification.data?.group_id ?? null
          });
          return;
        }
        if ('navigate' in client && client.url !== targetUrl) {
          await client.navigate(targetUrl).catch(() => {});
        }
        return;
      }
    }
    await self.clients.openWindow(targetUrl);
  })());
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      const options = event.oldSubscription?.options;
      if (!options?.applicationServerKey) return;
      const renewed = await self.registration.pushManager.subscribe(options);
      const subJson = renewed?.toJSON?.() || null;
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        client.postMessage({ type: 'MYIPON_PUSH_SUBSCRIPTION_CHANGED', subscription: subJson });
      }
    } catch { /* ignore */ }
  })());
});
