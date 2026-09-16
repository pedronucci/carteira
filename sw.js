/* ══════════════════════════════════════════════════════════════════════════
   Service worker da Carteira no Bolso.

   Guarda o app inteiro no aparelho na primeira visita. Depois disso ele abre
   sem internet — e continua abrindo mesmo se o site sair do ar. As chamadas de
   cotação vão sempre direto para a rede: são de outros domínios e nunca ficam
   em cache, para não devolver preço velho.

   Para publicar uma versão nova do app, troque o número em CACHE.
   ══════════════════════════════════════════════════════════════════════════ */
const CACHE = "carteira-v1";

const ARQUIVOS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-512-maskable.png",
  "./favicon.png"
];

self.addEventListener("install", evento => {
  evento.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ARQUIVOS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())   // um arquivo faltando não pode travar a instalação
  );
});

self.addEventListener("activate", evento => {
  evento.waitUntil(
    caches.keys()
      .then(chaves => Promise.all(chaves.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", evento => {
  const req = evento.request;
  if(req.method !== "GET") return;

  const url = new URL(req.url);
  // brapi, CoinGecko, AwesomeAPI: sempre rede, nunca cache.
  if(url.origin !== self.location.origin) return;

  evento.respondWith(
    caches.match(req).then(guardado => {
      if(guardado){
        // devolve o que está guardado e, em segundo plano, busca uma versão nova
        fetch(req).then(resp => {
          if(resp && resp.ok) caches.open(CACHE).then(c => c.put(req, resp.clone()));
        }).catch(() => {});
        return guardado;
      }
      return fetch(req).then(resp => {
        if(resp && resp.ok){
          const copia = resp.clone();
          caches.open(CACHE).then(c => c.put(req, copia));
        }
        return resp;
      }).catch(() => caches.match("./index.html"));
    })
  );
});
