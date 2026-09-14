/* Reconciliação de vidraria — o que sumiu contra o que foi reportado.
   PLANO_MURAL_MAITRE.md, fase F1.

   Existe porque o Bento tem os DOIS lados do dado desde sempre e nunca os
   cruzou: a contagem periódica de copos (`/api/contagem/historico`, campo
   `copos`) e as quebras reportadas com motivo (`/api/quebras/historico`).
   A diferença entre as duas é a quebra que ninguém registrou — que é,
   literalmente, o que a rotina mensal `per_vidraria` já promete em texto
   ("é o que mostra quebra que ninguém registrou") e nunca calculou.

   Função PURA de propósito: não faz fetch, não olha relógio, não toca no DOM.
   É o único jeito de testar as bordas (janela de data, nome que não casa,
   semana zerada) sem subir nada. Harness: bento/testa_reconcilia_vidraria.mjs.

   AS CINCO REGRAS QUE ESTE ARQUIVO EXISTE PARA CUMPRIR
   1. Zero não é ausência — semana inteira zerada é PULADA, não lida como
      "sumiu tudo". Sem par comparável, devolve ok:false com motivo, nunca 0.
   2. Nome casa por EXATO normalizado, nunca substring nem semelhança. Quebra
      aceita texto livre ("Outro item"), então nome que não casa vai para
      `naoCasadas` e NÃO é subtraído de ninguém.
   3. A janela é (data da contagem anterior, data da contagem atual]. A
      contagem carimba só o DIA: quebra na mesma data da contagem anterior é
      ambígua e fica de FORA, senão seria contada duas vezes.
   4. `reportado > sumiu` nunca vira negativo. Vira `inconsistente: true` —
      é sinal de contagem errada, não um número para esconder.
   5. Dinheiro nunca é fabricado. O preço unitário é DERIVADO de uma quebra
      reportada (custo / quantidade); item sem quebra no período não tem preço
      conhecido aqui, então custo fica `null` e o total sai `custoIncompleto`.
      Nunca R$ 0,00, nunca média, nunca estimativa. */
(function (raiz) {
  "use strict";

  function norm(s) {
    return String(s == null ? "" : s)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function num(v) {
    return typeof v === "number" && isFinite(v) ? v : 0;
  }

  /* Uma semana só serve se tem linha de copo COM número. Regra 1: se todas as
     linhas vieram zeradas, a contagem não aconteceu de verdade (formulário
     aberto e enviado em branco é o caso real) — pular, não acreditar. */
  function semanaUtil(sem) {
    var copos = (sem && sem.copos) || [];
    if (!copos.length) return false;
    for (var i = 0; i < copos.length; i++) {
      if (num(copos[i].contagem) > 0) return true;
    }
    return false;
  }

  /* A data da contagem é a MAIOR data entre as linhas da semana — não o fim da
     semana ISO. O formulário pode ser enviado em dias diferentes, e é a data
     real que define a janela das quebras. */
  function dataDaSemana(sem) {
    var d = "";
    var copos = (sem && sem.copos) || [];
    for (var i = 0; i < copos.length; i++) {
      var x = copos[i].data || "";
      if (x > d) d = x;
    }
    return d || (sem && sem.fim) || "";
  }

  function mapaPorNome(sem) {
    var m = new Map();
    var copos = (sem && sem.copos) || [];
    for (var i = 0; i < copos.length; i++) {
      var it = copos[i];
      var k = norm(it.nome);
      if (!k) continue;
      /* Grafia duplicada na mesma semana: soma, e é determinístico porque a
         ordem de chegada não muda o total (mordida registrada no
         PLANO_PRODUCAO_INTERNA do IZ, onde o merge não era determinístico). */
      var ant = m.get(k);
      if (ant) {
        ant.contagem += num(it.contagem);
        if (ant.lastro == null && it.lastro != null) ant.lastro = num(it.lastro);
      } else {
        m.set(k, {
          nome: it.nome,
          contagem: num(it.contagem),
          lastro: it.lastro == null ? null : num(it.lastro),
        });
      }
    }
    return m;
  }

  function reconciliaVidraria(dados) {
    var semanas = (dados && dados.semanas) || [];
    var meses = (dados && dados.meses) || [];

    var uteis = [];
    for (var i = 0; i < semanas.length; i++) {
      if (semanaUtil(semanas[i])) uteis.push(semanas[i]);
    }
    /* O payload vem desc do worker, mas não confiar nisso: ordenar aqui. */
    uteis.sort(function (a, b) {
      return dataDaSemana(a) < dataDaSemana(b) ? 1 : -1;
    });

    if (!uteis.length) return { ok: false, motivo: "sem_contagem" };
    if (uteis.length < 2) {
      return {
        ok: false,
        motivo: "uma_contagem_so",
        atual: { semana: uteis[0].semana, data: dataDaSemana(uteis[0]) },
      };
    }

    var semAtual = uteis[0];
    var semAnterior = uteis[1];
    var dataAtual = dataDaSemana(semAtual);
    var dataAnterior = dataDaSemana(semAnterior);

    var mAtual = mapaPorNome(semAtual);
    var mAnterior = mapaPorNome(semAnterior);

    /* Regra 3: janela ABERTA no início, FECHADA no fim. */
    var quebrasPorNome = new Map();
    var naoCasadas = [];
    for (var a = 0; a < meses.length; a++) {
      var entradas = (meses[a] && meses[a].entradas) || [];
      for (var b = 0; b < entradas.length; b++) {
        var q = entradas[b];
        var d = q.data || "";
        if (!(d > dataAnterior && d <= dataAtual)) continue;
        var k = norm(q.nome);
        var qtd = num(q.quantidade);
        if (!k || qtd <= 0) continue;
        /* Regra 2: só entra quem existe NA CONTAGEM. "Prato raso" digitado no
           campo livre não pode virar quebra de copo nenhum. */
        if (!mAtual.has(k) && !mAnterior.has(k)) {
          naoCasadas.push({ nome: q.nome, quantidade: qtd, data: d });
          continue;
        }
        var acc = quebrasPorNome.get(k) || { qtd: 0, custo: 0, temCusto: false };
        acc.qtd += qtd;
        if (typeof q.custo === "number" && isFinite(q.custo) && qtd > 0) {
          acc.custo += q.custo;
          acc.temCusto = true;
        }
        quebrasPorNome.set(k, acc);
      }
    }

    var itens = [];
    var incomparaveis = [];
    var tot = {
      emCirculacao: 0,
      lastro: 0,
      lastroIncompleto: false,
      abaixoDoLastro: 0,
      sumiu: 0,
      reportado: 0,
      semExplicacao: 0,
      custo: 0,
      custoIncompleto: false,
    };

    mAtual.forEach(function (at, k) {
      tot.emCirculacao += at.contagem;
      if (at.lastro == null) tot.lastroIncompleto = true;
      else tot.lastro += at.lastro;

      var ant = mAnterior.get(k);
      if (!ant) {
        /* Regra 1: sem par, não se afirma nada sobre este item. */
        incomparaveis.push({ nome: at.nome, motivo: "so_na_atual", contado: at.contagem });
        return;
      }

      var qb = quebrasPorNome.get(k) || { qtd: 0, custo: 0, temCusto: false };
      var sumiu = ant.contagem - at.contagem;
      if (sumiu < 0) sumiu = 0; /* entrou copo novo — não é sumiço */
      var reportado = qb.qtd;
      var semExpl = sumiu - reportado;
      var inconsistente = false;
      if (semExpl < 0) {
        /* Regra 4 */
        semExpl = 0;
        inconsistente = true;
      }

      /* Regra 5: preço unitário só existe se veio de uma quebra com custo. */
      var precoUnit = qb.temCusto && qb.qtd > 0 ? qb.custo / qb.qtd : null;
      var custoSemExpl = precoUnit == null ? null : precoUnit * semExpl;
      if (semExpl > 0 && custoSemExpl == null) tot.custoIncompleto = true;
      if (custoSemExpl != null) tot.custo += custoSemExpl;

      tot.sumiu += sumiu;
      tot.reportado += reportado;
      tot.semExplicacao += semExpl;
      if (at.lastro != null && at.lastro > at.contagem) {
        tot.abaixoDoLastro += at.lastro - at.contagem;
      }

      itens.push({
        nome: at.nome,
        lastro: at.lastro,
        contado: at.contagem,
        anterior: ant.contagem,
        sumiu: sumiu,
        reportado: reportado,
        semExplicacao: semExpl,
        inconsistente: inconsistente,
        precoUnit: precoUnit,
        custoSemExplicacao: custoSemExpl,
      });
    });

    mAnterior.forEach(function (ant, k) {
      if (!mAtual.has(k)) {
        incomparaveis.push({ nome: ant.nome, motivo: "so_na_anterior", contado: null });
      }
    });

    itens.sort(function (x, y) {
      if (y.semExplicacao !== x.semExplicacao) return y.semExplicacao - x.semExplicacao;
      if (y.sumiu !== x.sumiu) return y.sumiu - x.sumiu;
      return x.nome < y.nome ? -1 : 1;
    });

    if (tot.custo === 0 && tot.custoIncompleto) tot.custo = null;
    if (tot.semExplicacao === 0) tot.custo = tot.custoIncompleto ? null : 0;

    return {
      ok: true,
      atual: { semana: semAtual.semana, data: dataAtual },
      anterior: { semana: semAnterior.semana, data: dataAnterior },
      janela: { de: dataAnterior, ate: dataAtual },
      totais: tot,
      itens: itens,
      incomparaveis: incomparaveis,
      naoCasadas: naoCasadas,
    };
  }

  var api = { reconciliaVidraria: reconciliaVidraria, _norm: norm };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (raiz) raiz.ReconciliaVidraria = api;
})(typeof window !== "undefined" ? window : null);
