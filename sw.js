/* Service worker do Portal do Bar | Bento.
 *
 * ARQUIVO GERADO por bento/portal_gen.py — não editar à mão.
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
 *   - Arquivos de dado (*.json): rede primeiro, cache só como reserva offline.
 *   - versao.json: SEMPRE rede, NUNCA guardado (ver comentário lá embaixo).
 *   - Assets estáticos (ícones, logo, manifesto, fila-offline.js): cache-first
 *     com atualização em segundo plano — abrem rápido e se atualizam sozinhos.
 *
 * O conteúdo protegido não vive no HTML: a página é casca e o dado sai do
 * Worker sob token (ver CLAUDE.md), então guardar a casca em cache é seguro.
 *
 * Caminhos relativos (sem barra inicial) resolvem contra a pasta do próprio
 * sw.js, então funciona tanto em localhost quanto em /bento-dashboard/ (Pages).
 */
/* O nome do cache carrega o id do build (trocado em main(), mesma marca das
 * páginas). Assim toda publicação nova nasce com um cache NOVO e o `activate`
 * abaixo apaga o anterior — a casca (ícones, logo, fila-offline.js) fica
 * fresca sozinha, sem custar uma ida à rede a cada carregamento. */
const CACHE = "bento-portal-e400df8d3658";
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
  "fila-offline.js",
];

/* Busca da REDE de verdade, furando o cache HTTP do navegador (o Pages manda
 * max-age=600 e não dá pra desligar lá). Resposta que veio de redirecionamento
 * é reembalada — o navegador recusa atender uma navegação com uma Response
 * `redirected`. */
function daRede(req) {
  return fetch(req.url, { cache: "no-store", credentials: "same-origin" }).then((res) =>
    res.redirected
      ? new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers })
      : res
  );
}

function guarda(req, res) {
  if (res && res.ok) {
    const copia = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
  }
  return res;
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  // um a um (não addAll): addAll é tudo-ou-nada, então um único 404 abortava
  // o precache inteiro. E cada um vai de no-store, senão o precache nasce com
  // a cópia velha do cache HTTP.
  event.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.all(
        CORE.map((u) =>
          fetch(u, { cache: "no-store" })
            .then((r) => (r.ok ? c.put(u, r) : null))
            .catch(() => {})
        )
      )
    )
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

  // versao.json é consultado a cada poucos minutos com um ?t= diferente pra
  // furar proxy — cada consulta viraria uma entrada nova e eterna no cache.
  // Vai direto pra rede e não é guardado; offline a consulta simplesmente
  // falha, que é o certo (não há como saber de versão nova sem rede).
  if (url.pathname.endsWith("versao.json")) {
    event.respondWith(daRede(req));
    return;
  }

  // *.json é dado buscado por fetch (changelog, receitas_idx) — nunca casca.
  // `.webmanifest` não casa aqui de propósito: esse é casca.
  const isDado = url.pathname.endsWith(".json");

  if (isHTML) {
    event.respondWith(
      (async () => {
        // dispara a rede sempre — mesmo se a corrida abaixo perder pro
        // cache, esse fetch segue rodando e atualiza o cache no final.
        const rede = daRede(req)
          .then((res) => guarda(req, res))
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
  } else if (isDado) {
    // dado: rede primeiro, cache só como reserva offline (sem corrida — não
    // há "piscada branca" a evitar aqui, é fetch de segundo plano).
    event.respondWith(
      daRede(req)
        .then((res) => guarda(req, res))
        .catch(() => caches.match(req))
    );
  } else {
    // assets: cache-first, revalida em segundo plano
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = daRede(req)
          .then((res) => guarda(req, res))
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
