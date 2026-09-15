/* Painel do Bartender — primeira tela do mural de `equipe`.
   PLANO_MURAL_MAITRE.md, F7.

   POR QUE ESTE PAINEL EXISTE. Medido em produção em 2026-09-14, com o acesso
   de equipe: em 12 dias houve 16 marcações de rotina, TODAS num único dia
   (06/09) e todas da Gisleide — que é RH, não bartender. Em 35 dias, nenhum
   turno enviado por bartender. O mural que eles tinham não era ruim (982px,
   21 links, 10 páginas em 3 gavetas): ele era IMPESSOAL. Dizia "Boa noite"
   sem saber quem, e mostrava Abertura e Fechamento como dois botões iguais
   às 18h e às 2h da manhã.

   A ideia deste painel é responder duas perguntas que o anterior não
   respondia: QUEM é você e o que está acontecendo AGORA.

   Derivações puras, testadas em bento/testa_bartender.mjs. O fetch e o DOM
   ficam na página; aqui não entra nem relógio (a hora chega por parâmetro,
   senão o teste não consegue fixar o momento). */
(function (raiz) {
  "use strict";

  /* Turno pela hora. Alinhado com a faixa de contexto que o mural já mostrava
     ("Turno de almoço" até 15h, "Turno de jantar" das 18h às 23h) — não é
     régua nova. A madrugada é o ponto que engana: às 3h o bar está FECHANDO
     a noite anterior, não abrindo o almoço; por isso h < 5 devolve Noite.
     (O dia em si já é resolvido por RotinasComum.diaOperacional.) */
  function turnoDoMomento(agora) {
    var h = (agora instanceof Date ? agora : new Date()).getHours();
    if (h < 5) return "Noite";
    if (h < 15) return "Dia";
    return "Noite";
  }

  /* A grafia do turno diverge entre as camadas: as páginas falam
     Almoço/Jantar, a escala e o D1 falam Dia/Noite. `turnosEnviados` chega na
     grafia do D1, mas aceitar as duas aqui custa três linhas e evita que uma
     mudança de camada faça a cobrança sumir só num dos turnos — armadilha já
     registrada no comentário da própria rota. */
  function mesmoTurno(a, b) {
    function norm(t) {
      var s = String(t || "").toLowerCase();
      if (s.indexOf("almo") === 0 || s === "dia") return "dia";
      if (s.indexOf("jant") === 0 || s === "noite") return "noite";
      return s;
    }
    return norm(a) === norm(b) && norm(a) !== "";
  }

  /* A fase corrente sai do ESTADO, não do relógio: enquanto a abertura deste
     turno não foi enviada, a fase é abertura — às 22h inclusive, porque uma
     abertura que ninguém registrou continua pendente. Depois dela, fechamento.
     `concluido` marca o turno inteiro registrado, para a tela poder parar de
     cobrar em vez de mostrar um botão que não tem mais o que fazer. */
  function faseDoMomento(turnosEnviados, turno) {
    var lista = Array.isArray(turnosEnviados) ? turnosEnviados : [];
    var abriu = false, fechou = false;
    for (var i = 0; i < lista.length; i++) {
      var e = lista[i];
      if (!e || !mesmoTurno(e.turno, turno)) continue;
      if (e.fase === "abertura") abriu = true;
      else if (e.fase === "fechamento") fechou = true;
    }
    if (!abriu) return { fase: "abertura", concluido: false, abriu: false, fechou: fechou };
    if (!fechou) return { fase: "fechamento", concluido: false, abriu: true, fechou: false };
    return { fase: "fechamento", concluido: true, abriu: true, fechou: true };
  }

  /* Quem está escalado hoje, na ordem dos turnos. Dia sem escala devolve
     lista VAZIA — a tela então não afirma que ninguém trabalha hoje, ela
     pergunta quem é a pessoa. Ausência não é escala vazia. */
  function escaladosHoje(payload) {
    var esc = payload && payload.hoje && payload.hoje.escala;
    if (!esc || typeof esc !== "object") return [];
    var fora = [];
    ["Dia", "Noite"].forEach(function (t) {
      (esc[t] || []).forEach(function (n) {
        if (n && fora.indexOf(n) < 0) fora.push(n);
      });
    });
    /* Turno com grafia inesperada não é descartado: melhor um nome a mais na
       lista de escolha do que a pessoa não se achar nela. */
    Object.keys(esc).forEach(function (t) {
      if (t === "Dia" || t === "Noite") return;
      (esc[t] || []).forEach(function (n) {
        if (n && fora.indexOf(n) < 0) fora.push(n);
      });
    });
    return fora;
  }

  /* O elenco inteiro, do padrão semanal — é a lista do "não sou eu". Existe
     porque a escala de hoje pode vir do PADRÃO e não de publicação (o campo
     `escala_origem` diz qual), e nesse caso ela é um palpite: quem trocou de
     folga precisa conseguir se achar. */
  function elenco(payload) {
    var padrao = payload && payload.escala && payload.escala.padrao;
    if (!Array.isArray(padrao)) return [];
    var fora = [];
    padrao.forEach(function (p) {
      var n = p && p.pessoa;
      if (n && fora.indexOf(n) < 0) fora.push(n);
    });
    return fora;
  }

  /* A escala de hoje é palpite ou é publicada? A tela muda o verbo por causa
     disso: "você está na noite de hoje" quando publicada, "pela escala padrão
     você está na noite" quando é o padrão. Afirmar o palpite seria mentir
     para quem trocou de folga. */
  function escalaConfirmada(payload) {
    var o = payload && payload.hoje && payload.hoje.escala_origem;
    return o === "publicada" || o === "pontual";
  }

  /* --- O que já está feito NESTE turno ---------------------------------
     `RotinasComum.progressoDoDia` conta conclusão de QUALQUER turno: se o
     Almoço marcou 10 itens, a abertura do Jantar aparece 10/19 antes de a
     equipe da noite fazer qualquer coisa. As conclusões são gravadas por
     (dia, TURNO, item) — o F1 do formulário já filtra certo, e aqui é a
     mesma régua. Não alterei o módulo compartilhado porque ele é usado por
     outras telas; a lógica correta mora aqui, testada. */
  function feitosNoTurno(payload, turno) {
    var fora = {};
    var alvo = normTurno(turno);
    if (!alvo) return fora;
    var concs = (payload && payload.conclusoes) || [];
    for (var i = 0; i < concs.length; i++) {
      var c = concs[i] || {};
      if (!c.item_id) continue;
      if (!(c.feito === 1 || c.feito === true || c.feito === "1")) continue;
      if (normTurno(c.turno) !== alvo) continue;
      fora[c.item_id] = { pessoa: c.pessoa || "", em: c.atualizado_em || "" };
    }
    return fora;
  }

  function normTurno(t) {
    var s = String(t == null ? "" : t).trim();
    if (s === "Dia" || s === "Almoço" || s === "Almoco") return "Dia";
    if (s === "Noite" || s === "Jantar") return "Noite";
    return "";
  }

  /* Ids da fase, na ordem dos blocos, sem repetir. `blocos` vem de
     RotinasComum.blocosDaFase(fase) — passado de fora para este módulo não
     duplicar aquela decisão. */
  function idsDaFase(payload, blocos) {
    var fora = [], vistos = {};
    var doDia = (payload && payload.hoje && payload.hoje.blocos) || {};
    (blocos || []).forEach(function (b) {
      (doDia[b] || []).forEach(function (id) {
        if (id && !vistos[id]) { vistos[id] = true; fora.push(id); }
      });
    });
    return fora;
  }

  function progressoDoTurno(payload, blocos, turno) {
    var ids = idsDaFase(payload, blocos);
    if (!ids.length) return { feitos: 0, total: 0, pct: 0 };
    var feitos = feitosNoTurno(payload, turno);
    var n = 0;
    ids.forEach(function (id) { if (feitos[id]) n++; });
    return { feitos: n, total: ids.length, pct: Math.round(n / ids.length * 100) };
  }

  /* Os próximos `n` itens ainda não marcados neste turno.
     PRIORITÁRIOS PRIMEIRO, e dentro de cada grupo na ordem do dia. O campo
     `prio` está no cadastro de rotinas desde sempre e nenhuma tela usava:
     dezenove itens numa lista plana são uma parede; "os 3 que importam
     agora" é uma tarefa. Item sem entrada no catálogo é PULADO — nunca
     inventar texto de rotina. */
  function proximos(payload, blocos, turno, n) {
    var catalogo = (payload && payload.itens) || {};
    var feitos = feitosNoTurno(payload, turno);
    var pend = [];
    idsDaFase(payload, blocos).forEach(function (id) {
      if (feitos[id]) return;
      var it = catalogo[id];
      if (!it || !it.t) return;
      pend.push({ id: it.id || id, t: it.t, d: it.d || "", prio: !!it.prio,
                  minutos: typeof it.minutos === "number" ? it.minutos : null,
                  bloco: it.bloco || "" });
    });
    var prio = pend.filter(function (x) { return x.prio; });
    var resto = pend.filter(function (x) { return !x.prio; });
    return prio.concat(resto).slice(0, typeof n === "number" && n > 0 ? n : 3);
  }

  /* O que falta, em linguagem de tarefa e não de dívida.
     O card dizia "0 de 19 feitos": dezenove é uma parede, e o número não
     diz por onde começar nem quanto custa. `prio` e `minutos` estão no
     cadastro de rotinas desde sempre e nenhuma tela usava.
     Os minutos são os que FALTAM, não os do bloco inteiro — encolhem
     conforme a pessoa marca, que é o ponto.
     Sem minutos cadastrados devolve `minutos: null` e quem monta o texto
     omite: estimativa inventada é pior que nenhuma. */
  function resumoDoQueFalta(payload, blocos, turno) {
    var catalogo = (payload && payload.itens) || {};
    var feitos = feitosNoTurno(payload, turno);
    var pend = 0, prio = 0, min = 0, temMin = false;
    idsDaFase(payload, blocos).forEach(function (id) {
      if (feitos[id]) return;
      var it = catalogo[id];
      if (!it || !it.t) return;
      pend++;
      if (it.prio) prio++;
      if (typeof it.minutos === "number" && it.minutos > 0) { min += it.minutos; temMin = true; }
    });
    return { pendentes: pend, prioritarios: prio, minutos: temMin ? min : null };
  }

  /* A frase do card. Ordem deliberada: primeiro o que fazer agora, depois
     quanto custa. "Tudo feito" só quando não sobra nada — nunca arredondar
     para cima um trabalho incompleto. */
  function textoDoQueFalta(resumo) {
    if (!resumo || !resumo.pendentes) return "tudo marcado neste turno";
    var quanto = resumo.minutos ? " · uns " + resumo.minutos + " min" : "";
    if (resumo.prioritarios > 0) {
      return resumo.prioritarios === 1
        ? "comece pelo item de prioridade" + quanto
        : "comece pelos " + resumo.prioritarios + " de prioridade" + quanto;
    }
    return resumo.pendentes === 1
      ? "falta 1 item" + quanto
      : "faltam " + resumo.pendentes + " itens" + quanto;
  }

  var api = {
    resumoDoQueFalta: resumoDoQueFalta,
    textoDoQueFalta: textoDoQueFalta,
    feitosNoTurno: feitosNoTurno,
    idsDaFase: idsDaFase,
    progressoDoTurno: progressoDoTurno,
    proximos: proximos,
    turnoDoMomento: turnoDoMomento,
    faseDoMomento: faseDoMomento,
    escaladosHoje: escaladosHoje,
    elenco: elenco,
    escalaConfirmada: escalaConfirmada,
    _mesmoTurno: mesmoTurno,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (raiz) raiz.BartenderPainel = api;
})(typeof window !== "undefined" ? window : null);
