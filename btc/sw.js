/* Cache somente dos arquivos do aplicativo; funciona na raiz e em subpastas. */
const CACHE = "btc-terminal-00ae1aaba99bb65e";
const FILES = ["./", "./index.html", "./manifest.webmanifest", "./icon-180.png", "./icon-192.png", "./icon-512.png", "./icon-512-maskable.png", "./favicon.png", "./icon.svg"];
const assetUrls = new Set(FILES.map(p => new URL(p, self.registration.scope).href));
const page = new URL("index.html", self.registration.scope).href;
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll([...assetUrls])).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("btc-terminal-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || !assetUrls.has(url.href)) return;
  if (req.mode === "navigate" || url.href === page || url.href === self.registration.scope) {
    e.respondWith((async () => {
      try { const res = await fetch(req); if (!res.ok) throw new Error("HTTP " + res.status); const c = await caches.open(CACHE); await c.put(page, res.clone()); return res; }
      catch { return await caches.match(page) || new Response("Aplicativo indisponível offline. Conecte e tente novamente.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }); }
    })());
  } else e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});
