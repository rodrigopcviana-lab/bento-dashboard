/* Módulo compartilhado de fila offline do Portal do Bar | Bento.
 *
 * Antes desta extração, a mesma lógica (ler/salvar fila no localStorage,
 * dedupe, uuid, gatilhos online/load/visibilitychange/pageshow/interval,
 * backoff) vivia copiada em 9 lugares: registro.html/maitres-registro.html/
 * admin-registro.html (gerados por bento/portal_gen.py::_registro_corpo())
 * e os 6 turno*.html (mantidos à mão). As duas filas já eram, na prática,
 * compartilhadas por família — todo arquivo de registro lê/escreve
 * 'registro_fila', todo arquivo de turno lê/escreve 'bento_turno_fila' — um
 * item enfileirado numa página já era drenado se a pessoa abrisse outra
 * página da mesma família depois, no mesmo aparelho. Esse comportamento é
 * preservado aqui: filaKey fica em granularidade de FEATURE ("registro" /
 * "turno"), não por arquivo.
 *
 * Cada chamador mantém sua própria lógica de negócio (formato do corpo do
 * POST, quais status HTTP significam sucesso/rejeição/erro de config,
 * efeitos colaterais como salvar a senha individual) via as funções de cfg
 * abaixo — este módulo só centraliza o que era idêntico ou só variava por
 * um número/booleano (intervalo de poll, backoff opcional).
 */
(function () {
  var KEY_MAP = { registro: 'registro_fila', turno: 'bento_turno_fila' };
  var LAST_SYNC_KEY = 'fila_offline_ultimo_sync';
  // filaKeys que TÊM instância criar() ativa nesta página (ex.: 'registro' na
  // registro.html). O selo global IGNORA essas — a própria página já mostra o
  // banner dela; o selo é pra pendência de OUTRAS features não visíveis aqui.
  var filasLocais = {};
  // Render de cada selo ativo, pra atualização INSTANTÂNEA quando a fila muda
  // (sem esperar o poll de 5s nem depender de evento 'storage', que só dispara
  // cross-tab). criar() chama isto a cada mudança de fila.
  var selosRender = [];
  function notificarSelos() { selosRender.forEach(function (fn) { try { fn(); } catch (e) {} }); }

  function lerFila(filaKey) {
    try { return JSON.parse(localStorage.getItem(KEY_MAP[filaKey]) || '[]'); }
    catch (e) { return []; }
  }
  function salvarFila(filaKey, arr) {
    try { localStorage.setItem(KEY_MAP[filaKey], JSON.stringify(arr)); } catch (e) {}
  }
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
  function registrarSync() {
    try { localStorage.setItem(LAST_SYNC_KEY, String(Date.now())); } catch (e) {}
  }
  function ultimoSync() {
    var v = null;
    try { v = localStorage.getItem(LAST_SYNC_KEY); } catch (e) {}
    return v ? Number(v) : null;
  }
  function contarPendentes() {
    var total = 0, porFila = {};
    Object.keys(KEY_MAP).forEach(function (k) {
      var n = lerFila(k).length;
      porFila[k] = n;
      total += n;
    });
    return { total: total, porFila: porFila };
  }

  // cfg: {
  //   filaKey: 'registro'|'turno',
  //   idField: nome do campo único do item (default '_idemp'),
  //   montarBody(item) -> objeto enviado como JSON no POST,
  //   endpoint: path do worker (ex '/api/registro'),
  //   onResultado(status, json, item) -> {
  //     remover: bool (tira da fila local),
  //     sucesso: bool (só relevante quando remover=true — dispara onSucesso),
  //     reagendar: bool (default true quando cfg.backoff existe; ignora
  //       quando backoff é null, já que aí não há timer explícito — a
  //       fila só volta a tentar no próximo gatilho/tick do intervalo),
  //     motivo: string livre, só repassado pro callback de enfileirar,
  //   },
  //   onSucesso(item): efeito colateral extra (ex.: gravar senha lembrada),
  //   onMudou(pendentes): chamado depois de CADA tentativa (removida da fila
  //     ou não) — espelha os vários `bannerPendente(...)` espalhados pelo
  //     código original, centralizados aqui num só ponto de atualização,
  //   intervaloMs: período do poll de reforço (default 15000),
  //   backoff: {inicialMs, maxMs} | null — null = sem retry acelerado,
  //     só o intervalo/gatilhos tentam de novo (comportamento do Turno hoje).
  // }
  function criar(cfg) {
    var filaKey = cfg.filaKey;
    var idField = cfg.idField || '_idemp';
    var intervaloMs = cfg.intervaloMs || 15000;
    var backoffCfg = cfg.backoff || null;
    var backoffMs = backoffCfg ? backoffCfg.inicialMs : null;
    var enviando = false;
    var aguardando = {}; // id -> [callbacks disparados quando aquele item settle]

    filasLocais[filaKey] = true; // esta página é dona desta fila -> selo a ignora

    // avisa a página (onMudou) E o selo global (instantâneo) numa mudança de fila
    function emitirMudanca() {
      if (cfg.onMudou) cfg.onMudou(pendentes());
      notificarSelos();
    }

    function idDe(item) { return item[idField]; }

    function notificar(id, resultado) {
      var cbs = aguardando[id];
      if (!cbs) return;
      delete aguardando[id];
      cbs.forEach(function (cb) { try { cb(resultado); } catch (e) {} });
    }

    function enfileirar(dadosItem, aoConcluir) {
      var fila = lerFila(filaKey);
      var id = idDe(dadosItem);
      var ja = fila.some(function (x) { return idDe(x) === id; });
      if (!ja) { fila.push(dadosItem); salvarFila(filaKey, fila); }
      if (aoConcluir) {
        aguardando[id] = aguardando[id] || [];
        aguardando[id].push(aoConcluir);
      }
      emitirMudanca();
      processar();
    }

    function processar() {
      var fila = lerFila(filaKey);
      if (!fila.length) return;
      if (enviando) return;
      enviando = true;
      var item = fila[0];
      var id = idDe(item);
      var body = cfg.montarBody(item);
      fetch(cfg.endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (json) {
          enviando = false;
          var acao = cfg.onResultado(r.status, json, item) || {};
          if (acao.remover) {
            salvarFila(filaKey, lerFila(filaKey).filter(function (x) { return idDe(x) !== id; }));
            if (backoffCfg) backoffMs = backoffCfg.inicialMs;
            if (acao.sucesso) {
              registrarSync();
              if (cfg.onSucesso) cfg.onSucesso(item);
            }
            notificar(id, { ok: !!acao.sucesso, aindaNaFila: false, motivo: acao.motivo });
            emitirMudanca();
            setTimeout(processar, 350); // drena o próximo item da fila, se houver
          } else {
            notificar(id, { ok: false, aindaNaFila: true, motivo: acao.motivo });
            emitirMudanca();
            var reagendar = acao.reagendar !== false;
            if (backoffCfg && reagendar) {
              setTimeout(processar, backoffMs);
              backoffMs = Math.min(backoffMs * 2, backoffCfg.maxMs);
            }
          }
        });
      }).catch(function () {
        enviando = false;
        notificar(id, { ok: false, aindaNaFila: true, motivo: 'rede' });
        emitirMudanca();
        if (backoffCfg) {
          setTimeout(processar, backoffMs);
          backoffMs = Math.min(backoffMs * 2, backoffCfg.maxMs);
        }
      });
    }

    function pendentes() { return lerFila(filaKey).length; }

    // Gatilhos redundantes: 'online' não é confiável no PWA standalone do
    // iPhone ao reconectar, e 'load' não dispara ao retomar o app da bandeja
    // (sem reload de verdade) — sem isso o item ficava preso na fila até
    // recarregar a página na mão (achado original do Portal dos Bares —
    // Grupo IZ, 2026-07-15, replicado aqui em 2026-07-17).
    window.addEventListener('online', processar);
    window.addEventListener('load', processar);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) processar(); });
    window.addEventListener('pageshow', processar);
    setInterval(processar, intervaloMs);
    processar();

    return { enfileirar: enfileirar, processar: processar, pendentes: pendentes, uuid: uuid };
  }

  // Selo global de pendências — roda em QUALQUER página que inclua este
  // script, mesmo sem chamar criar() (não precisa do fetch/backoff pra só
  // mostrar uma contagem). cfg: {elId, destinos: {registro: url, turno: url}}
  // destinos é opcional; sem ele o selo só mostra a contagem, sem navegar.
  // IMPORTANTE: o selo IGNORA filas que têm instância criar() local (registro
  // na registro.html, turno nas turno*.html) — nessas a própria página já
  // mostra o banner, e um segundo indicador da mesma coisa confundiria. Então
  // o selo representa só pendência de OUTRAS features; o toque leva pra lá.
  function iniciarSelo(cfg) {
    var el = document.getElementById(cfg.elId);
    if (!el) return;
    function render() {
      var r = contarPendentes();
      var total = 0, keys = [];
      Object.keys(r.porFila).forEach(function (k) {
        if (filasLocais[k]) return;      // fila local -> banner da página cobre
        if (r.porFila[k] > 0) { total += r.porFila[k]; keys.push(k); }
      });
      // display:none vem de regra de CLASSE (.fila-selo) no <style> da página —
      // então mostrar exige um valor EXPLÍCITO ('inline-flex'); '' só limparia
      // o inline e a regra de classe continuaria escondendo (lição registrada
      // no CLAUDE.md do Bento, batida de novo aqui).
      if (!total) { el.style.display = 'none'; return; }
      el.style.display = 'inline-flex';
      el.textContent = 'Pendente neste aparelho (' + total + ')';
      el.onclick = function () {
        // Só filas SEM instância local chegam aqui -> navega pra página que as
        // drena (a maior). A página de destino sincroniza sozinha ao abrir.
        var chaveMaior = keys.sort(function (a, b) { return r.porFila[b] - r.porFila[a]; })[0];
        if (cfg.destinos && cfg.destinos[chaveMaior]) location.href = cfg.destinos[chaveMaior];
      };
    }
    selosRender.push(render);         // atualização instantânea via notificarSelos()
    render();
    setInterval(render, 5000);        // reforço (cross-tab / mudanças fora do criar)
    window.addEventListener('storage', render);
  }

  window.FilaOffline = {
    criar: criar,
    contarPendentes: contarPendentes,
    ultimoSync: ultimoSync,
    iniciarSelo: iniciarSelo,
  };
})();
