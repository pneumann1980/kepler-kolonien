/// <reference lib="webworker" />
// Service Worker: App-Shell-Cache (offline startbar) und Web-Push-Benachrichtigungen
declare const self: ServiceWorkerGlobalScope;
declare const __ASSETS__: string[];
const CACHE = 'kk-shell-v1-' + (typeof __ASSETS__ !== 'undefined' ? __ASSETS__.join('|').length : 0);
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon.svg', ...(typeof __ASSETS__ !== 'undefined' ? __ASSETS__ : [])];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return;
  if (e.request.mode === 'navigate') {
    // Netz zuerst, offline die gecachte Shell
    e.respondWith(fetch(e.request).catch(() => caches.match('/') as Promise<Response>));
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit ?? fetch(e.request)));
});
self.addEventListener('push', (e) => {
  const data = (() => { try { return e.data?.json() ?? {}; } catch { return { title: 'Kepler-Kolonien', body: e.data?.text() }; } })();
  e.waitUntil(self.registration.showNotification(data.title ?? 'Kepler-Kolonien', {
    body: data.body ?? '', tag: data.tag, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: data.url ?? '/' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data?.url as string) ?? '/';
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => {
    for (const c of list) if ('focus' in c) { (c as WindowClient).navigate(url); return (c as WindowClient).focus(); }
    return self.clients.openWindow(url);
  }));
});
export {};
