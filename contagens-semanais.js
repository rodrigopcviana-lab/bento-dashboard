/* Contagens semanais — PLANO_CONTAGENS_SEMANAIS.md (2026-09-25).

   A página "Contagens semanais" (contagem.html nos 3 silos) mostra a semana
   vigente com as 3 contagens (insumos, produções, copos) e o histórico
   agrupado por mês. Quem é a fonte: a database "Contagens Semanais" do Notion,
   via POST /api/contagens/semanas no worker bento-portal-contagem.

   Este arquivo tem duas metades:
   - PURA (sem fetch, sem DOM, sem relógio): semana ISO, mês da semana, os
     estados de cada contagem. É o que decide o que a equipe vê — testada em
     bento/testa_contagens_semanais.mjs.
   - montar(cfg): busca e desenha. Só pinta o que a metade pura decidiu.

   "Toda semana nasce uma contagem esperando" é CALCULADO aqui: a semana
   vigente sem página no Notion aparece como "aguardando". Nada é gravado
   antes de alguém confirmar — o pedido do Rodrigo foi exatamente esse.

   A regra da semana e a do mês são as MESMAS do worker (isoWeekInfo e
   mesDaSemanaContagem em worker/src/index.ts). Mudar uma exige mudar a outra;
   o selo confere as duas contra os mesmos casos. */
(function (raiz) {
  "use strict";

  var TIPOS = [
    { tipo: "insumos", rotulo: "Insumos", arquivo: "contagem-insumos.html",
      desc: "Águas, cervejas, energéticos e refrigerantes." },
    { tipo: "producoes", rotulo: "Produções", arquivo: "contagem-producoes.html",
      desc: "Xaropes, sucos, espumas e pré-batches." },
    { tipo: "copos", rotulo: "Copos e taças", arquivo: "contagem-copos.html",
      desc: "Copos, taças e outros itens, com o lastro." },
  ];

  var MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
    "agosto", "setembro", "outubro", "novembro", "dezembro"];

  // ---------------------------------------------------------------- PURA

  function paraData(iso) { return new Date(iso + "T00:00:00Z"); }
  function paraISO(d) { return d.toISOString().slice(0, 10); }
  function somaDias(iso, n) { var d = paraData(iso); d.setUTCDate(d.getUTCDate() + n); return paraISO(d); }

  // Mesma conta do isoWeekInfo do worker: segunda a domingo, e o ano/número
  // da semana são os da QUINTA-FEIRA.
  function semanaISO(iso) {
    var d = paraData(iso);
    var diaSemana = (d.getUTCDay() + 6) % 7;
    var inicio = somaDias(iso, -diaSemana);
    var quinta = paraData(somaDias(inicio, 3));
    var ano = quinta.getUTCFullYear();
    var primeira = new Date(Date.UTC(ano, 0, 1));
    var diaPrimeira = (primeira.getUTCDay() + 6) % 7;
    primeira.setUTCDate(primeira.getUTCDate() + (3 - diaPrimeira));
    var num = 1 + Math.round((quinta.getTime() - primeira.getTime()) / (7 * 86400000));
    return { semana: ano + "-W" + (num < 10 ? "0" : "") + num, inicio: inicio, fim: somaDias(inicio, 6) };
  }

  // O mês de uma semana é o da quinta-feira (31/08–06/09 é de setembro).
  function mesDaSemana(inicioISO) {
    var q = somaDias(inicioISO, 3);
    var mes = Number(q.slice(5, 7));
    var nome = MESES[mes - 1];
    return { chave: q.slice(0, 7), rotulo: nome.charAt(0).toUpperCase() + nome.slice(1) + " de " + q.slice(0, 4) };
  }

  function numeroSemana(semana) { return Number(String(semana).split("-W")[1]); }

  // "21–27/09" ou, atravessando o mês, "28/09–04/10".
  function rotuloPeriodo(inicio, fim) {
    var di = inicio.slice(8, 10), mi = inicio.slice(5, 7), df = fim.slice(8, 10), mf = fim.slice(5, 7);
    return mi === mf ? di + "–" + df + "/" + mf : di + "/" + mi + "–" + df + "/" + mf;
  }

  function diaMes(iso) { return iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) : ""; }

  // Data de HOJE no fuso do aparelho — nunca toISOString(): às 22h em Goiânia
  // o UTC já é o dia seguinte, e no domingo à noite a semana viraria cedo.
  function hojeLocal(agora) {
    var d = agora || new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  /* As semanas que a tela mostra, da mais recente para a mais antiga, cada uma
     com o estado das 3 contagens:
       contada      — existe página da semana no Notion
       aguardando   — semana vigente, ainda sem contagem
       nao_contada  — semana que passou sem contagem
     O intervalo começa na PRIMEIRA semana com qualquer contagem (antes disso
     o sistema não existia — "não contada" ali seria acusação falsa) e vai até
     a vigente. Sem contagem nenhuma, só a vigente aparece. `maxSemanas` corta
     o histórico longo pelo lado antigo. */
  function montaSemanas(contagens, hojeISO, maxSemanas) {
    var atual = semanaISO(hojeISO);
    var porChave = {};
    var menorInicio = atual.inicio;
    var maiorInicio = atual.inicio;
    (contagens || []).forEach(function (c) {
      if (!c || !c.tipo || !c.semana) return;
      var inicio = c.inicio || "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio)) return;
      // A semana da página vem do Notion; a conta local só confere a segunda.
      inicio = semanaISO(inicio).inicio;
      var k = c.tipo + "|" + inicio;
      if (!porChave[k]) porChave[k] = c;
      if (inicio < menorInicio) menorInicio = inicio;
      if (inicio > maiorInicio) maiorInicio = inicio;
    });

    var semanas = [];
    for (var ini = maiorInicio; ini >= menorInicio; ini = somaDias(ini, -7)) {
      var s = semanaISO(ini);
      var linha = { semana: s.semana, inicio: s.inicio, fim: s.fim, atual: s.semana === atual.semana,
        futura: s.inicio > atual.inicio, tipos: {} };
      TIPOS.forEach(function (t) {
        var c = porChave[t.tipo + "|" + s.inicio];
        if (c) linha.tipos[t.tipo] = { status: "contada", contagem: c };
        else linha.tipos[t.tipo] = { status: s.inicio >= atual.inicio ? "aguardando" : "nao_contada" };
      });
      semanas.push(linha);
      if (maxSemanas && semanas.length >= maxSemanas) break;
    }
    return semanas;
  }

  // Agrupa preservando a ordem (mais recente primeiro).
  function agrupaPorMes(semanas) {
    var grupos = [];
    semanas.forEach(function (s) {
      var m = mesDaSemana(s.inicio);
      var ult = grupos[grupos.length - 1];
      if (!ult || ult.chave !== m.chave) grupos.push({ chave: m.chave, rotulo: m.rotulo, semanas: [s] });
      else ult.semanas.push(s);
    });
    return grupos;
  }

  // ---------------------------------------------------------------- DOM

  var CSS =
    ".cs-sec{font-size:11px;letter-spacing:.12em;color:var(--text-3);margin:22px 0 8px;text-transform:uppercase}" +
    ".cs-atual{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}" +
    ".cs-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:13px 14px;min-width:0}" +
    ".cs-card.pend{border-color:var(--ambar)}" +
    ".cs-card.feita{border-color:#4f8a5f}" +
    ".cs-card .t{font-weight:600;font-size:15px}" +
    ".cs-card .d{font-size:12px;color:var(--text-2);margin-top:2px;line-height:1.4}" +
    ".cs-est{font-size:12.5px;margin-top:9px;line-height:1.45}" +
    ".cs-est.ok{color:#9fdcae}.cs-est.pend{color:var(--ambar-2)}" +
    ".cs-bt{display:inline-block;margin-top:10px;font-size:13px;font-weight:600;padding:8px 14px;border-radius:999px;text-decoration:none}" +
    ".cs-bt.pri{background:var(--ambar);color:#2b2620}" +
    ".cs-bt.sec{border:1px solid var(--border-2);color:var(--text-2)}" +
    ".cs-mes{font-family:Georgia,serif;font-size:17px;margin:18px 0 6px}" +
    ".cs-linha{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:7px}" +
    ".cs-sem{font-size:13px;font-weight:600}.cs-sem span{color:var(--text-3);font-weight:400}" +
    ".cs-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}" +
    ".cs-chip{font:inherit;font-size:12px;padding:4px 10px;border-radius:999px;border:1px solid var(--border);background:none;color:var(--text-3)}" +
    ".cs-chip.ok{border-color:#4f8a5f;color:#9fdcae}" +
    ".cs-chip.nao{border-color:#7a4a3d;color:#e0a08c}" +
    ".cs-chip.pend{border-color:var(--ambar);color:var(--ambar-2)}" +
    "button.cs-chip{cursor:pointer}button.cs-chip.on{background:rgba(79,138,95,.18)}" +
    ".cs-det{margin-top:9px;font-size:12.5px;color:var(--text-2)}" +
    ".cs-det table{width:100%;border-collapse:collapse}" +
    ".cs-det td{padding:4px 0;border-top:1px solid var(--border)}.cs-det td.n{text-align:right;color:var(--text);font-variant-numeric:tabular-nums}" +
    ".cs-det .cat{color:var(--text-3);font-size:11px;letter-spacing:.08em;padding-top:8px;border-top:none}" +
    ".cs-msg{font-size:13px;color:var(--text-2);margin:8px 0}" +
    ".cs-leg{font-size:11.5px;color:var(--text-3);margin-top:10px;line-height:1.5}";

  function el(tag, cls, texto) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (texto != null) e.textContent = texto;
    return e;
  }

  function simbolo(status) { return status === "contada" ? "✓ " : status === "nao_contada" ? "✗ " : "⏳ "; }
  function classeChip(status) { return status === "contada" ? "ok" : status === "nao_contada" ? "nao" : "pend"; }

  function cardAtual(t, info, prefixo) {
    var feita = info.status === "contada";
    var card = el("div", "cs-card " + (feita ? "feita" : "pend"));
    card.appendChild(el("div", "t", t.rotulo));
    card.appendChild(el("div", "d", t.desc));
    var c = info.contagem;
    var est = feita
      ? "✓ Contada em " + diaMes(c.data) + (c.responsavel ? " por " + c.responsavel : "") +
        (typeof c.itens === "number" ? " · " + c.itens + " itens" : "")
      : "⏳ Aguardando contagem desta semana";
    card.appendChild(el("div", "cs-est " + (feita ? "ok" : "pend"), est));
    var a = el("a", "cs-bt " + (feita ? "sec" : "pri"), feita ? "Corrigir contagem" : "Contar agora");
    a.href = prefixo + t.arquivo;
    card.appendChild(a);
    return card;
  }

  function desenhaItens(caixa, itens) {
    caixa.textContent = "";
    if (!itens.length) { caixa.appendChild(el("div", "", "Nenhum item ligado a esta semana.")); return; }
    var tabela = el("table");
    var catAtual = null;
    itens.forEach(function (it) {
      if (it.categoria && it.categoria !== catAtual) {
        catAtual = it.categoria;
        var trc = el("tr");
        var tdc = el("td", "cat", it.categoria.toUpperCase());
        tdc.colSpan = 2;
        trc.appendChild(tdc);
        tabela.appendChild(trc);
      }
      var tr = el("tr");
      var extra = typeof it.lastro === "number" ? "  (lastro " + it.lastro + ")" : "";
      if (typeof it.sistema === "number") extra = "  (sistema " + it.sistema + ")";
      tr.appendChild(el("td", "", it.nome + extra));
      tr.appendChild(el("td", "n", it.contagem == null ? "—" : String(it.contagem)));
      tabela.appendChild(tr);
    });
    caixa.appendChild(tabela);
  }

  function linhaSemana(s, cfg) {
    var box = el("div", "cs-linha");
    var cab = el("div", "cs-sem", "Semana " + numeroSemana(s.semana) + " ");
    cab.appendChild(el("span", "", rotuloPeriodo(s.inicio, s.fim) + (s.atual ? " · esta semana" : "")));
    box.appendChild(cab);
    var chips = el("div", "cs-chips");
    var det = el("div", "cs-det");
    det.hidden = true;
    var aberto = null;
    TIPOS.forEach(function (t) {
      var info = s.tipos[t.tipo];
      var texto = simbolo(info.status) + t.rotulo;
      var podeAbrir = info.status === "contada" && cfg.chaveHistorico && info.contagem.id;
      var chip = el(podeAbrir ? "button" : "span", "cs-chip " + classeChip(info.status), texto);
      if (podeAbrir) {
        chip.type = "button";
        chip.addEventListener("click", function () {
          if (aberto === chip) { det.hidden = true; chip.classList.remove("on"); aberto = null; return; }
          if (aberto) aberto.classList.remove("on");
          aberto = chip;
          chip.classList.add("on");
          det.hidden = false;
          det.textContent = "Carregando itens…";
          fetch(cfg.worker + "/api/contagens/semana", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chave: cfg.chaveHistorico, id: info.contagem.id }),
          })
            .then(function (r) { return r.json(); })
            .then(function (d) {
              if (aberto !== chip) return;
              if (!d || !d.ok) { det.textContent = "Não consegui carregar os itens agora."; return; }
              desenhaItens(det, d.itens || []);
            })
            .catch(function () { if (aberto === chip) det.textContent = "Sem conexão agora."; });
        });
      }
      chips.appendChild(chip);
    });
    box.appendChild(chips);
    box.appendChild(det);
    return box;
  }

  function montar(cfg) {
    var raizEl = document.getElementById(cfg.alvo || "contagens-semanais");
    if (!raizEl) return;
    var estilo = document.createElement("style");
    estilo.textContent = CSS;
    document.head.appendChild(estilo);

    var hoje = hojeLocal();
    var atual = semanaISO(hoje);
    var prefixo = cfg.prefixo || "";

    function pinta(contagens, erro) {
      raizEl.textContent = "";
      var semanas = montaSemanas(contagens, hoje, cfg.maxSemanas || 26);
      // Só some se o corte de maxSemanas engolir a vigente (contagens com data
      // lá no futuro) — mesmo assim os botões de contar têm de aparecer.
      var vigente = semanas.filter(function (s) { return s.atual; })[0] ||
        montaSemanas([], hoje, 1)[0];

      raizEl.appendChild(el("div", "cs-sec",
        "Esta semana · Semana " + numeroSemana(atual.semana) + " (" + rotuloPeriodo(atual.inicio, atual.fim) + ")"));
      var grade = el("div", "cs-atual");
      TIPOS.forEach(function (t) { grade.appendChild(cardAtual(t, vigente.tipos[t.tipo], prefixo)); });
      raizEl.appendChild(grade);

      if (erro) {
        raizEl.appendChild(el("p", "cs-msg",
          "Não consegui carregar o histórico agora — a contagem funciona normalmente pelos botões acima."));
        return;
      }

      var anteriores = semanas.filter(function (s) { return !s.atual && !s.futura; });
      if (!anteriores.length) return;
      raizEl.appendChild(el("div", "cs-sec", "Semanas anteriores"));
      agrupaPorMes(anteriores).forEach(function (g) {
        raizEl.appendChild(el("div", "cs-mes", g.rotulo));
        g.semanas.forEach(function (s) { raizEl.appendChild(linhaSemana(s, cfg)); });
      });
      raizEl.appendChild(el("p", "cs-leg",
        "✓ contada · ✗ a semana passou sem contagem · ⏳ aguardando" +
        (cfg.chaveHistorico ? ". Toque numa contagem ✓ para ver os itens." : ".")));
    }

    raizEl.textContent = "Carregando contagens…";
    fetch(cfg.worker + "/api/contagens/semanas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chave: cfg.chaveHistorico || cfg.chave }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.ok) pinta(d.contagens || [], false); else pinta([], true); })
      .catch(function () { pinta([], true); });
  }

  var api = {
    TIPOS: TIPOS,
    semanaISO: semanaISO,
    mesDaSemana: mesDaSemana,
    rotuloPeriodo: rotuloPeriodo,
    hojeLocal: hojeLocal,
    montaSemanas: montaSemanas,
    agrupaPorMes: agrupaPorMes,
    montar: montar,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (raiz) raiz.ContagensSemanais = api;
})(typeof window !== "undefined" ? window : null);
