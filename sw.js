// Hors ligne + mises à jour.
// Fichiers de l'appli : réseau d'abord (toujours la dernière version quand on a du réseau), sinon la copie en cache.
// Polices Google : cache d'abord.
const CACHE = "frais-v1";
const SHELL = ["./", "index.html", "style.css", "app.js", "store.js", "readers.js", "config.js", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "lib/jspdf-2.5.1.umd.min.js", "lib/jszip-3.10.1.min.js", "lib/pdf-3.11.174.min.js", "lib/pdf.worker-3.11.174.min.js"];
const CDN = /^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//;

self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("message", e => { if (e.data === "skipWaiting") self.skipWaiting(); });

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.searchParams.has("code")) return; // retour de Dropbox : laisser passer
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match("index.html"))));
    return;
  }
  if (CDN.test(req.url)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
  }
});
