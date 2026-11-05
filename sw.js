/* ClaudioPunts app: network first, so the board is always the latest when online; the last copy opens offline. */
const CACHE = 'claudiopunts-v6';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192-v6.png', './icons/apple-touch-icon-v6.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const ours = url.origin === self.location.origin && !url.pathname.includes('/social/');
  const lib = url.hostname === 'cdn.jsdelivr.net';
  if (!ours && !lib) return;
  const key = url.origin + url.pathname;            // data/*.csv?v=<time> -> one cached copy per file
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
    return res;
  }).catch(() => caches.match(key).then(hit => hit || caches.match('./index.html'))));
});
