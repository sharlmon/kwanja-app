'use strict';

// The Pages build fills in the exact URLs shipped with this release.
const cachePrefix = `kwanja-shell:${self.registration.scope}:`;
const cacheName = cachePrefix + '98a1a39a3c90d3b5';
const shellUrls = new Set(["apple-touch-icon.png", "brands/mpesa.svg", "config.js?v=e29e0d7d06cd", "fonts/dm-sans-latin.woff2", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "index.html", "ledger.css?v=fc0f98fb9250", "ledger.js?v=82db512e1537", "logo/kwanja-lockup-mono-black.svg", "logo/kwanja-lockup-mono-white.svg", "logo/kwanja-lockup-reverse.svg", "logo/kwanja-lockup.svg", "logo/kwanja-mark.svg", "logo/kwanja-symbol.svg", "logo/kwanja-wordmark-mono.svg", "logo/kwanja-wordmark.svg", "manifest.webmanifest", "public.css?v=4dbd3f811d15"].map((path) => new URL(path, self.registration.scope).href));
const indexUrl = new URL('index.html', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll([...shellUrls].map((url) => new Request(url, { cache: 'reload' })));
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
    event.respondWith(fetch(request).catch(async () => (await (await caches.open(cacheName)).match(indexUrl)) || Response.error()));
  } else if (shellUrls.has(request.url)) {
    event.respondWith((async () => (await (await caches.open(cacheName)).match(request)) || fetch(request))());
  }
});
