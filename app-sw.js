/* Service worker só do app piloto (app.html), separado do sw.js do site.
 *
 * Registrado pela casca com scope "app.html": o navegador escolhe o escopo
 * mais específico, então este cuida do app e o sw.js do site continua
 * cuidando das outras páginas. Publicar o app não exige republicar o site.
 *
 * Estratégia (26/11/2026, mesma ideia do portal de Medellín; v2 em 27/11):
 *   - app.html: cópia primeiro. Abre na hora, com ou sem internet. A rede
 *     atualiza a cópia por trás, e a casca confere app-versao.json: versão
 *     nova é baixada e entra num momento seguro (ver confereVersao na casca).
 *   - app-versao.json: sempre rede, nunca guardado.
 *   - *.json do site: rede primeiro, cópia só sem internet.
 *   - O resto do mesmo endereço (scripts, ícones, manifesto): cópia primeiro,
 *     revalidando por trás.
 *   - Vídeo e outros domínios (o Worker, fontes): direto, sem passar aqui.
 * Nenhuma chamada a mais ao Worker: dado do Worker não passa por este arquivo.
 */
const CACHE = "bento-app-v2";
const PREFIXO = "bento-app-";
const CASCA = self.registration.scope; // .../app.html
const ATIVOS = ["app.webmanifest", "app-icon-192.png", "app-icon-512.png", "app-icon-512-maskable.png",
  "rotinas-comum.js", "bartender-painel.js", "reconcilia-vidraria.js"];

function daRede(url) {
  return fetch(url, { cache: "no-store", credentials: "same-origin" }).then((res) =>
    res.redirected ? new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers }) : res
  );
}
// Só o cache DESTA versão. caches.match() sem nome procura em todos, e uma
// casca velha ainda aberta pode recriar o cache v1 antes de recarregar.
function doCache(chave) {
  return caches.open(CACHE).then((c) => c.match(chave));
}
function guarda(chave, res) {
  if (res && res.ok) {
    const copia = res.clone();
    caches.open(CACHE).then((c) => c.put(chave, copia)).catch(() => {});
  }
  return res;
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.all([CASCA].concat(ATIVOS.map((u) => new URL(u, CASCA).href)).map((u) =>
        daRede(u).then((r) => (r.ok ? c.put(u, r) : null)).catch(() => {})
      ))
    )
  );
});

// v3 (27/11/2026, tarde): celulares ficaram presos na cópia de 26/11. A casca
// daquela época conferia a versão pedindo o app.html, recebia a cópia velha do
// próprio service worker e nunca enxergava a nova. Por isso o nome do cache
// mudou (v1 -> v2): ao ativar, este arquivo apaga a cópia velha e recarrega as
// telas abertas, que voltam já com a versão nova (guardada no install acima).
// Só recarrega quando havia cópia antiga: a primeira instalação não pisca.
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const velhas = (await caches.keys()).filter((k) => k.indexOf(PREFIXO) === 0 && k !== CACHE);
    await Promise.all(velhas.map((k) => caches.delete(k)));
    await self.clients.claim();
    if (!velhas.length) return;
    const telas = await self.clients.matchAll({ type: "window" });
    await Promise.all(telas.map((c) => {
      // Mesmo endereço com #hash seria só rolagem, sem recarregar: o "?sw="
      // muda o endereço e força a carga. A casca nova tira o parâmetro.
      const u = new URL(c.url);
      if (u.href.split("?")[0].split("#")[0] !== CASCA) return null; // só telas do app
      u.searchParams.set("sw", CACHE);
      try { return c.navigate(u.href).catch(() => {}); } catch (e) { return null; }
    }));
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const ext = url.pathname.split(".").pop().toLowerCase();
  if (["mp4", "webm", "m4v", "mov"].includes(ext)) return;

  if (url.pathname.endsWith("app-versao.json")) {
    event.respondWith(daRede(req.url));
    return;
  }
  // Conferência de versão nova (27/11/2026): a casca pede "app.html?nv=<build>"
  // e precisa do arquivo da REDE. Sem esta linha, a regra da casca abaixo
  // devolvia a cópia velha e o app não trocava de versão com ele aberto.
  if (url.searchParams.has("nv")) return;
  const ehCasca = req.mode === "navigate" || url.href.split("?")[0].split("#")[0] === CASCA;
  if (ehCasca) {
    event.respondWith((async () => {
      const rede = daRede(CASCA).then((r) => guarda(CASCA, r)).catch(() => null);
      const copia = await doCache(CASCA);
      if (copia) { event.waitUntil(rede); return copia; }
      return (await rede) || new Response("<p style=\"font:16px sans-serif;padding:24px\">Sem internet e sem cópia do app neste aparelho. Abra de novo quando a internet voltar.</p>",
        { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
    })());
    return;
  }
  if (ext === "json") {
    event.respondWith(daRede(req.url).then((r) => guarda(req, r)).catch(() => doCache(req)));
    return;
  }
  event.respondWith(
    doCache(req).then((copia) => {
      const rede = daRede(req.url).then((r) => guarda(req, r)).catch(() => copia || Response.error());
      if (copia) { event.waitUntil(rede); return copia; }
      return rede;
    })
  );
});
