// Service worker: rende la dashboard installabile e consultabile offline.
// Strategia: rete prima (così gli aggiornamenti arrivano subito), cache come riserva offline.
// Le chiamate all'API di GitHub (dati privati) NON vengono mai messe in cache qui.
const CACHE = 'ortigia-shell-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.hostname === 'api.github.com') return;
  const sameOrigin = url.origin === self.location.origin;
  const cdn = url.hostname === 'cdnjs.cloudflare.com';
  if (!sameOrigin && !cdn) return;
  if (cdn) { // librerie con versione fissa: cache prima
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res;
    })));
    return;
  }
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: e.request.mode === 'navigate' }).then((hit) => hit || caches.match('./index.html'))));
});
