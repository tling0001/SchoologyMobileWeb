'use strict';

const CACHE_NAME = 'schoology-shell-v7';
const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/renderer.js',
  '/browser-bridge.js',
  '/appboot.js',
  '/manifest.json',
  '/assets/pwa-icon.svg',
  '/assets/apple-splash.svg',
  '/assets/android_loading_logo.png',
  '/assets/android_loading_spinner_72.gif'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) { payload = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(String(payload.title || 'Schoology'), {
    body: String(payload.body || 'You have new Schoology activity.'),
    icon: '/assets/pwa-icon.svg', badge: '/assets/pwa-icon.svg',
    tag: String(payload.tag || 'schoology-activity'),
    data: payload.data || { url: '/' }, renotify: false
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const client of list) if (new URL(client.url).origin === self.location.origin) { client.navigate(target); return client.focus(); }
    return self.clients.openWindow(target);
  }));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put('/index.html', response.clone()));
      return response;
    }).catch(async () => (await caches.match(request)) || (await caches.match('/index.html'))));
    return;
  }

  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok && (url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname.startsWith('/assets/'))) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
    }
    return response;
  })));
});
