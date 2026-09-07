/* Módulo compartilhado das telas de turno / mural do Portal do Bar | Bento.
 *
 * Antes desta extração, `blocosDaFase()` e `normalizaTurnoLabel()` viviam
 * copiados dentro das 6 páginas de turno mantidas à mão (turno-abertura.html
 * e turno.html × 3 silos `` / `maitres-` / `admin-`). O mural (mural.html)
 * precisa da mesma lógica e seria a 7ª cópia — daí este arquivo, no mesmo
 * padrão do `fila-offline.js` que já é carregado por essas páginas: IIFE,
 * expõe em `window`, sem dependências, sem build.
 *
 * IMPORTANTE: nada aqui pode presumir o fuso do ambiente. No navegador o
 * relógio é local (Goiânia); no Worker é UTC. `diaOperacional()` recebe o
 * instante e faz a conversão de fuso EXPLÍCITA — ver o comentário dela.
 */
(function () {

  // --- blocos por fase -----------------------------------------------------
  // FASE decide os blocos: abertura mostra o que "quem abre" faz (abertura +
  // mise en place + periódicas do dia); fechamento mostra só o fechamento
  // (a divisão por turno, no worker, já separa por BLOCO_TURNO — aqui só
  // decide quais blocos ESTA página exibe).
  function blocosDaFase(fase) {
    // 'durante' entra nas duas: os dois turnos fazem (BLOCO_TURNO='todos' no
    // gerador), e task pontual sem bloco escolhido nasce em 'durante'
    // (default do worker) — sem isso ela não apareceria em página nenhuma.
    return fase === 'abertura'
      ? ['abertura', 'mise_en_place', 'durante', 'periodica']
      : ['fechamento', 'durante'];
  }

  // --- grafia do turno ---------------------------------------------------
  // As páginas falam 'Almoço'/'Jantar'; a escala e o D1 falam 'Dia'/'Noite'.
  // Espelha `normalizaTurnoRotina` do worker (worker/src/index.ts): entrada
  // desconhecida devolve null — o chamador decide o que fazer com isso
  // (tipicamente: lista de nomes vazia -> fallback). NÃO cai em 'Dia' por
  // padrão como a versão antiga embutida nas páginas fazia.
  function normalizaTurnoLabel(t) {
    var v = typeof t === 'string' ? t.trim() : '';
    if (v === 'Dia' || v === 'Almoço' || v === 'Almoco') return 'Dia';
    if (v === 'Noite' || v === 'Jantar') return 'Noite';
    return null;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  // Aceita um Date por duck-typing (`.getTime`), não `instanceof Date` — este
  // módulo pode ser carregado num realm diferente do do chamador (teste em vm,
  // iframe) e aí `instanceof` de outro realm falharia em silêncio.
  function comoData(agora) {
    return (agora && typeof agora.getTime === 'function') ? agora : new Date();
  }

  // --- dia de calendário local (mantém o hoje() das páginas) --------------
  // Sem corte de turno: só o Y-M-D do relógio local de quem abre a página.
  function hoje(agora) {
    var d = comoData(agora);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  // --- dia operacional (D3 do PLANO_TURNO_V4) ----------------------------
  // Retorna 'AAAA-MM-DD'. Regra: antes das 05:00 no horário de Goiânia
  // (America/Sao_Paulo, UTC-3, sem horário de verão), "hoje" ainda é o DIA
  // ANTERIOR — o fechamento feito à 01:00 pertence ao serviço da véspera.
  //
  // Conversão de fuso EXPLÍCITA, nunca herdada do ambiente:
  //   `agora.getTime()` é epoch em ms, idêntico no navegador e no Worker.
  //   Goiânia = UTC-3, então tirar 3h leva o instante para a hora-de-parede
  //   de Goiânia; tirar mais 5h joga qualquer horário < 05:00 para o dia
  //   anterior. Depois é só ler Y-M-D em UTC do instante deslocado.
  //   Total: -8h. (Se o Brasil voltar a ter horário de verão, revisar aqui.)
  //
  // `agora` é opcional (Date) para dar testabilidade; sem argumento usa
  // `new Date()`.
  function diaOperacional(agora) {
    var d = comoData(agora);
    var deslocado = new Date(d.getTime() - (3 + 5) * 3600 * 1000);
    return deslocado.getUTCFullYear() + '-' +
      pad2(deslocado.getUTCMonth() + 1) + '-' +
      pad2(deslocado.getUTCDate());
  }

  // --- progresso do dia por fase ---------------------------------------
  // `payload` = JSON de `GET /api/rotinas?dia=` (handleRotinasGet no worker).
  // Os itens do dia estão em `payload.hoje.blocos` — um mapa
  // { bloco: [item_id, ...] }. (O `payload.blocos` de topo é só o metadado
  // {chave,rotulo,ordem} dos blocos, NÃO a lista de itens do dia.)
  // `payload.conclusoes` = linhas do D1
  // { item_id, turno, pessoa, feito, valor, obs, atualizado_em } — `feito` é
  // 1/0 (inteiro do SQLite).
  //
  // Devolve { feitos, total, pct }:
  //   total  = qtd de itens distintos do dia nos blocos de `blocosDaFase(fase)`
  //   feitos = quantos desses itens têm ao menos uma conclusão com feito truthy
  //   pct    = Math.round(feitos/total*100); 0 quando total é 0 (nunca NaN,
  //            nunca divisão por zero)
  function progressoDoDia(payload, fase) {
    var vazio = { feitos: 0, total: 0, pct: 0 };
    if (!payload || !payload.hoje || !payload.hoje.blocos) return vazio;

    var blocosDoDia = payload.hoje.blocos;
    var idsDaFase = {};
    blocosDaFase(fase).forEach(function (b) {
      var lista = blocosDoDia[b] || [];
      for (var i = 0; i < lista.length; i++) idsDaFase[lista[i]] = true;
    });

    var total = 0, k;
    for (k in idsDaFase) if (idsDaFase.hasOwnProperty(k)) total++;
    if (!total) return vazio;

    var feitosSet = {};
    var concs = payload.conclusoes || [];
    for (var j = 0; j < concs.length; j++) {
      var c = concs[j] || {};
      if (idsDaFase[c.item_id] && (c.feito === 1 || c.feito === true || c.feito === '1')) {
        feitosSet[c.item_id] = true;
      }
    }
    var feitos = 0;
    for (k in feitosSet) if (feitosSet.hasOwnProperty(k)) feitos++;

    return { feitos: feitos, total: total, pct: Math.round(feitos / total * 100) };
  }

  window.RotinasComum = {
    blocosDaFase: blocosDaFase,
    normalizaTurnoLabel: normalizaTurnoLabel,
    hoje: hoje,
    diaOperacional: diaOperacional,
    progressoDoDia: progressoDoDia,
  };
})();
