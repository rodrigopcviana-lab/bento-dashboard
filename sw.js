/* Service worker do Portal do Bar | Bento.
 *
 * Estratégia escolhida pra NÃO servir versão velha num site que é republicado
 * com frequência:
 *   - Páginas (HTML/navegação): network-first — online sempre pega a versão
 *     fresca do servidor; o cache só responde quando está OFFLINE.
 *   - Assets estáticos (ícones, logo, manifesto): cache-first com atualização
 *     em segundo plano — abrem rápido e se atualizam sozinhos na próxima vez.
 *
 * As páginas de cada papel são cifradas pelo staticrypt; guardar o HTML cifrado
 * no cache é seguro — a decifragem acontece no navegador com a senha lembrada no
 * localStorage, então funciona igual offline.
 *
 * Caminhos relativos (sem barra inicial) resolvem contra a pasta do próprio
 * sw.js, então funciona tanto em localhost quanto em /bento-dashboard/ (Pages).
 */
const CACHE = "bento-portal-v1";
const CORE = [
  "index.html",
  "regras.html",
  "logo-bento.png",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "icon-512-maskable.png",
  "apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isHTML =
    req.mode === "navigate" ||
    (req.headers.get("accept") || "").includes("text/html");

  if (isHTML) {
    // network-first: fresco online, cache como reserva offline
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match(req).then((r) => r || caches.match("index.html"))
        )
    );
  } else {
    // assets: cache-first, revalida em segundo plano
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
