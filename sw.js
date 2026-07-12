/* Service worker do Portal do Bar | Bento.
 *
 * Estratégia escolhida pra NÃO servir versão velha num site que é republicado
 * com frequência, mas sem travar a troca de página numa viagem de rede
 * inteira (2026-07-11 — o Rodrigo reportou "piscada branca" + delay ao trocar
 * de página no app instalado; era o SW segurando toda navegação até a rede
 * responder, mesmo já tendo a página em cache):
 *   - Páginas (HTML/navegação): CORRIDA rede×cache com timeout curto — se a
 *     rede responde rápido (HTML_RACE_MS), usa ela (fresco); se demora mais
 *     que isso E já existe versão em cache, usa o cache na hora e deixa a
 *     rede terminando em segundo plano só pra atualizar o cache (a PRÓXIMA
 *     navegação já pega o conteúdo novo). Só espera a rede até o fim quando
 *     não há cache nenhum (primeira visita àquela página). Trade-off
 *     consciente: depois de publicar uma mudança, pode aparecer a versão
 *     anterior por UMA navegação em conexão lenta, antes de atualizar sozinho.
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
const CACHE = "bento-portal-v2";
const HTML_RACE_MS = 350;
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
    event.respondWith(
      (async () => {
        // dispara a rede sempre — mesmo se a corrida abaixo perder pro
        // cache, esse fetch segue rodando e atualiza o cache no final.
        const rede = fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            return res;
          })
          .catch(() => null);

        const espera = new Promise((resolve) => setTimeout(() => resolve(null), HTML_RACE_MS));
        const rapida = await Promise.race([rede, espera]);
        if (rapida) return rapida; // rede respondeu dentro do prazo: fresco

        const doCache = await caches.match(req);
        if (doCache) return doCache; // rede lenta, mas já tem versão pra mostrar na hora

        // sem cache (primeira visita a esta página): só resta esperar a rede
        const doNet = await rede;
        return doNet || caches.match("index.html");
      })()
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
