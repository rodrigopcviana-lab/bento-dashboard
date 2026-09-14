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

  var api = {
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
