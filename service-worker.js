// App-shell offline cache. Firestore's own persistent local cache
// (see firebase-config.js) handles offline data reads/writes/queuing
// -- this service worker only needs to keep the static shell
// (HTML/CSS/JS) available when the rig has no signal.

const CACHE_NAME = 'crew-time-tracker-v1';

const SHELL_FILES = [
  './',
  './index.html',
  './dashboard.html',
  './manifest.json',
  './css/styles.css',
  './css/tablet.css',
  './css/dashboard.css',
  './js/app.js',
  './js/dashboard.js',
  './js/auth.js',
  './js/db.js',
  './js/utils.js',
  './js/firebase-config.js',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for the app shell, falling back to cache only when
// the network is unavailable -- this is a rural/spotty-signal app,
// so offline still needs to work, but a signal-having device (i.e.
// every dev iteration) should never be stuck looking at stale
// HTML/CSS/JS just because it was cached once before. Firebase SDK
// and Firestore/Auth network calls are untouched -- the SDK manages
// its own offline behavior.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Page navigations arrive with redirect: "manual" baked into the
  // request -- re-fetching that same request object means any 3xx
  // response comes back as an unusable opaqueredirect instead of
  // being followed, which renders as a blank page. Re-issuing the
  // fetch from a plain URL (default redirect: "follow") avoids that.
  event.respondWith(
    fetch(url.href)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
