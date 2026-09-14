/* Painel do Maître — primeira tela do mural de `maitres`.
   PLANO_MURAL_MAITRE.md, fase F2.

   EIXO (decidido pelo Rodrigo em 2026-09-14, depois da medição de F1.5):
   este painel NÃO nasce fiscalizando desvio. A medição em produção achou
   1 linha de contagem de copos em 26 semanas (e era linha de teste),
   3 quebras em 12 meses e 1 turno registrado em 35 dias — o desvio é
   invisível porque ninguém produz o número. Então a primeira tela mostra
   O QUE FALTA REGISTRAR, e o botão principal cria o dado.

   Quando o dado passar a existir, os mesmos cards viram fiscalização
   SOZINHOS: `reconciliaVidraria` já devolve `motivo` em vez de zero, e
   `estadoVidraria` abaixo só traduz esse motivo em texto de tela. Nenhum
   código novo é necessário nessa virada — é o ponto todo de ter separado
   o cálculo (reconcilia-vidraria.js) da apresentação (aqui).

   Derivações são PURAS e testadas em bento/testa_reconcilia_vidraria.mjs.
   O fetch é separado e tem DEGRADAÇÃO GRACIOSA como requisito duro: sem
   sessão, sem rede, ou com 401, o painel fica só com os links e nenhum
   número — nunca um "—" piscando, nunca erro no console. */
(function (raiz) {
  "use strict";

  function n0(v) { return typeof v === "number" && isFinite(v) ? v : 0; }
  function diaISO(d) { return d.toISOString().slice(0, 10); }

  /* --- Estado do registro de turno ------------------------------------- */
  /* Entra o payload cru de GET /api/turno/conformidade (últimos 35 dias,
     janela fixa do worker) e o dia de hoje. Sai o que a tela precisa.
     NUNCA afirma "fechou certo" a partir de ausência: linha que não existe
     é "sem registro", que é coisa diferente de "não fez". A tela usa essa
     distinção no texto. */
  function estadoRegistro(entrada) {
    var linhas = (entrada && entrada.linhas) || [];
    var hoje = (entrada && entrada.hoje) || "";
    var achaHoje = { abertura: null, fechamento: null };
    var dias = Object.create(null);
    var aberturas = 0, fechamentos = 0, comFoto = 0;

    for (var i = 0; i < linhas.length; i++) {
      var L = linhas[i];
      if (!L || !L.data) continue;
      if (L.fase === "abertura") aberturas++;
      else if (L.fase === "fechamento") fechamentos++;
      if (L.tem_foto) comFoto++;
      dias[L.data] = true;
      if (L.data === hoje && (L.fase === "abertura" || L.fase === "fechamento")) {
        var atual = achaHoje[L.fase];
        /* Mais de um envio no mesmo dia/fase: fica o mais recente. */
        if (!atual || String(L.enviado_em || "") > String(atual.enviado_em || "")) {
          achaHoje[L.fase] = L;
        }
      }
    }

    return {
      hoje: achaHoje,
      janela: {
        dias: 35,
        turnos: linhas.length,
        diasComRegistro: Object.keys(dias).length,
        aberturas: aberturas,
        fechamentos: fechamentos,
        comFoto: comFoto,
      },
    };
  }

  /* --- Tradução para o card de Conformidade ---------------------------- */
  function cardRegistro(est) {
    var j = est.janela;
    if (!j.turnos) {
      return {
        grav: "alta",
        numero: "0",
        sub: "",
        exp: "turnos registrados em 35 dias",
        pe: "Nenhuma abertura, nenhum fechamento",
      };
    }
    /* 35 dias ≈ 35 turnos de abertura + 35 de fechamento numa casa que abre
       todo dia. Mostrar o BRUTO, não um percentual: percentual sobre uma
       base que ninguém combinou vira número que parece meta. */
    return {
      grav: j.turnos < 10 ? "alta" : j.turnos < 25 ? "media" : "ok",
      numero: String(j.turnos),
      sub: "",
      exp: j.turnos === 1 ? "turno registrado em 35 dias" : "turnos registrados em 35 dias",
      pe: j.aberturas + " abertura" + (j.aberturas === 1 ? "" : "s") +
          " · " + j.fechamentos + " fechamento" + (j.fechamentos === 1 ? "" : "s"),
    };
  }

  /* --- Tradução para o card de Copos e taças --------------------------- */
  /* Recebe a saída de ReconciliaVidraria.reconciliaVidraria(). Os dois
     motivos de "não dá para comparar" viram texto de IMPLANTAÇÃO, não de
     erro: para quem chega, "ainda não contado" é tarefa, não falha. */
  function cardVidraria(rec) {
    if (!rec || rec.ok !== true) {
      var motivo = rec && rec.motivo;
      /* `rotulo` existe porque o número grande MENTE aqui. Medido na tela
         real (2026-09-14): "1" em coral, do mesmo tamanho e cor que o
         "19 sumiram" do modo fiscalização, se lê como "1 peça sumiu" —
         quando significa "1 contagem existe". Em modo implantação a tela
         mostra o rótulo em texto; o número fica só no `numero`, para quem
         quiser compor outra frase. */
      if (motivo === "uma_contagem_so") {
        return {
          grav: "alta", modo: "implantar", numero: "1", rotulo: "Falta a 2ª",
          exp: "contagem registrada até hoje",
          pe: "Precisa de duas para saber o que sumiu",
        };
      }
      return {
        grav: "alta", modo: "implantar", numero: "0", rotulo: "Nunca contada",
        exp: "contagem de vidraria registrada",
        pe: "A conta do que sumiu começa na primeira",
      };
    }
    var t = rec.totais;
    return {
      grav: t.semExplicacao > 0 ? "alta" : "ok",
      modo: "fiscalizar", rotulo: null,
      numero: String(t.semExplicacao),
      exp: t.semExplicacao === 1 ? "sumiu e ninguém reportou" : "sumiram e ninguém reportou",
      pe: t.emCirculacao + (t.lastroIncompleto ? "" : " de " + t.lastro) + " no bar" +
          (rec.itens.length && rec.itens[0].semExplicacao > 0
            ? " · " + rec.itens[0].nome + " é a pior"
            : ""),
    };
  }

  /* --- As rupturas que a faixa vermelha lista -------------------------- */
  /* Ordem é por GRAVIDADE e depois por quanto tempo está parado. Cada item
     aponta para a página que RESOLVE, nunca para um relatório. */
  function rupturas(est, recCard) {
    var lista = [];
    if (recCard.modo === "implantar") {
      lista.push({
        chave: "vidraria",
        texto: recCard.numero === "0"
          ? "A vidraria nunca foi contada"
          : "Só existe uma contagem de vidraria",
        detalhe: "Sem duas contagens não dá para saber o que sumiu",
        grav: "alta",
      });
    }
    var j = est.janela;
    if (!j.fechamentos) {
      lista.push({
        chave: "fechamento",
        texto: "Nenhum fechamento registrado em 35 dias",
        detalhe: "É o envio que prova que o bar fechou em ordem",
        grav: "alta",
      });
    } else if (j.fechamentos < j.aberturas) {
      lista.push({
        chave: "fechamento",
        texto: (j.aberturas - j.fechamentos) + " turnos abriram e não fecharam",
        detalhe: "Abertura sem fechamento fica sem prova do fim",
        grav: "media",
      });
    }
    if (j.turnos && j.comFoto < j.turnos) {
      lista.push({
        chave: "foto",
        texto: (j.turnos - j.comFoto) + " envios sem foto",
        detalhe: "A foto é a única prova visual do turno",
        grav: "media",
      });
    }
    return lista;
  }

  var api = {
    estadoRegistro: estadoRegistro,
    cardRegistro: cardRegistro,
    cardVidraria: cardVidraria,
    rupturas: rupturas,
    _diaISO: diaISO,
    _n0: n0,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (raiz) raiz.MaitrePainel = api;
})(typeof window !== "undefined" ? window : null);
