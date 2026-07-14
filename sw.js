/* Slate — service worker: precached app shell, offline-first.
   VERSION is stamped by build_standalone.py from a hash of the sources;
   any source change produces a new cache and an immediate takeover. */
'use strict';

const VERSION = 'slate-9ad3a2563c';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/base.css',
  './css/components.css',
  './css/brain.css',
  './js/core.js',
  './js/render.js',
  './js/interact.js',
  './js/ui.js',
  './js/markdown.js',
  './js/brain.js',
  './js/palette.js',
  './js/backup-db.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png',
  // C4: Library shell — precached so the wing works offline
  './library.html',
  './css/library.css',
  './js/library-data.js',
  './js/library-views.js',
  './js/library-reader.js',
  './js/library-user.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  // C4: Library DATA (/library/manifest.json, /library/articles/*, /library/assets/*,
  // /library/search/*) stays NETWORK-ONLY — never precached (1 GB store not in git/cache).
  // The shell (library.html + js/css) is in ASSETS and serves offline via cache-first.
  // Use pathname.includes('/library/') so this works whether the app is deployed at root
  // or under a subpath; the explicit check for .html prevents matching library.html itself.
  if (url.pathname.includes('/library/') && !url.pathname.endsWith('.html')) {
    e.respondWith(fetch(e.request));
    return;
  }
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request))
  );
});
