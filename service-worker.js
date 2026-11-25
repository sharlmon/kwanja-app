'use strict';

// The Pages build fills in the exact URLs shipped with this release.
const cachePrefix = `kwanja-shell:${self.registration.scope}:`;
const cacheName = cachePrefix + 'd1d1fd2a5657779f';
const shellUrls = new Set(["apple-touch-icon.png", "brands/mpesa.svg", "config.e24d0cc4c4e9f287.js", "fonts/dm-sans-latin.woff2", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "index.8947fb4a10cb0591.html", "language.251dc685ac11e752.js", "ledger.324f731473cedc7e.js", "ledger.84a4a07a93ba0db3.css", "logo/kwanja-lockup-mono-black.svg", "logo/kwanja-lockup-mono-white.svg", "logo/kwanja-lockup-reverse.svg", "logo/kwanja-lockup.svg", "logo/kwanja-mark.svg", "logo/kwanja-symbol.svg", "logo/kwanja-wordmark-mono.svg", "logo/kwanja-wordmark.svg", "manifest.webmanifest", "public.aea5cc70a7d98e0f.css", "ticket.5885f7f5b8c7458c.css"].map((path) => new URL(path, self.registration.scope).href));
const indexUrl = new URL('index.html', self.registration.scope).href;
const offlineIndex = new URL('index.8947fb4a10cb0591.html', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll([...shellUrls].map((url) => new Request(url, { cache: 'reload' })));
    // Every asset in this release is ready before the worker takes over.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(cachePrefix) && name !== cacheName).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (request.mode === 'navigate' && [self.registration.scope, indexUrl].includes(url.origin + url.pathname)) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: 'no-cache' });
        if (response.status < 500) return response;
      } catch { /* Fall back to the complete offline release. */ }
      return (await (await caches.open(cacheName)).match(offlineIndex)) || Response.error();
    })());
  } else if (shellUrls.has(request.url)) {
    event.respondWith((async () => (await (await caches.open(cacheName)).match(request)) || fetch(request))());
  }
});
