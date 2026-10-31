/* Página principal: filtros, tabela, cards, mapa, comparação, CSV e URL. */
(function () {
  "use strict";
  const { TRACO, nulo, moeda, numero, pct, data, simNao, ocupado, cap, escapar, semAcentos, diasEntre, hojeIso,
    nomeFonte, ROTULOS, formatarCampo, carregarJson, carregarImoveis, lerQuery } = LT;

  const LOTE_LINHAS = 300;   // renderização incremental da tabela/cards
  const COLUNAS = [
    { id: "ia", rotulo: "Análise", fixa: true },
    { id: "sel", rotulo: "", fixa: true },
    { id: "cidade", rotulo: "Cidade", valor: r => r.cidade, chave: r => r.cidade, classe: "cel-cidade", html: true },
    { id: "bairro", rotulo: "Bairro", valor: r => r.bairro, chave: r => r.bairro },
    { id: "tipo", rotulo: "Tipo", valor: r => cap(r.tipo), chave: r => r.tipo },
    { id: "area", rotulo: "Área m²", num: true, valor: r => numero(areaRef(r)), chave: areaRef, titulo: "Área privativa; do terreno quando é terreno" },
    { id: "quartos", rotulo: "Qtos", num: true, valor: r => numero(r.quartos, 0), chave: r => r.quartos, padraoOculta: true },
    { id: "valor_avaliacao", rotulo: "Avaliação", num: true, valor: r => moeda(r.valor_avaliacao), chave: r => r.valor_avaliacao },
    { id: "valor_minimo", rotulo: "Lance mín.", num: true, valor: r => moeda(r.valor_minimo), chave: r => r.valor_minimo },
    { id: "desconto_pct", rotulo: "Desc.", num: true, valor: r => descontoHtml(r.desconto_pct), chave: r => r.desconto_pct, html: true, titulo: "Desconto do lance mínimo sobre a avaliação" },
    { id: "valor_m2", rotulo: "R$/m²", num: true, valor: r => numero(r.valor_m2, 0), chave: r => r.valor_m2 },
    { id: "natureza", rotulo: "Natureza", valor: r => cap(r.natureza), chave: r => r.natureza },
    { id: "modalidade", rotulo: "Modalidade", valor: r => r.modalidade, chave: r => r.modalidade, classe: "cel-mod" },
    { id: "data_leilao", rotulo: "Leilão", valor: r => data(r.data_leilao), chave: r => r.data_leilao },
    { id: "ocupado", rotulo: "Ocupação", valor: r => ocupado(r.ocupado), chave: r => r.ocupado },
    { id: "debitos", rotulo: "Débitos", valor: r => debitos(r), chave: r => debitos(r), titulo: "IPTU / condomínio por conta de", padraoOculta: true },
    { id: "aceita_fgts", rotulo: "FGTS", valor: r => simNaoHtml(r.aceita_fgts), chave: r => r.aceita_fgts, html: true },
    { id: "aceita_financiamento", rotulo: "Financ.", valor: r => simNaoHtml(r.aceita_financiamento), chave: r => r.aceita_financiamento, html: true, padraoOculta: true },
    { id: "fonte", rotulo: "Fonte", valor: r => nomeFonte(r.fonte), chave: r => r.fonte, classe: "cel-mod" },
    { id: "endereco", rotulo: "Endereço", valor: r => r.endereco, chave: r => r.endereco, classe: "cel-end", padraoOculta: true },
    { id: "primeira_vez_visto", rotulo: "Desde", valor: r => data(r.primeira_vez_visto), chave: r => r.primeira_vez_visto, padraoOculta: true },
    { id: "link", rotulo: "", fixa: true },
  ];

  const estado = {
    todos: [], filtrados: [], historico: null, meta: null, status: null,
    ordem: { coluna: "valor_avaliacao", desc: true },
    modo: localStorage.getItem("lt.modo") || (window.matchMedia("(max-width: 760px)").matches ? "cards" : "tabela"),
    ocultas: new Set(JSON.parse(localStorage.getItem("lt.colunasOcultas") || "null") || COLUNAS.filter(c => c.padraoOculta).map(c => c.id)),
    selecionados: new Set(),
    mapa: null, cluster: null,
    precoMudou30: new Set(), quedas: new Set(), altas: new Set(),
    ufsCarregadas: new Set(), dividido: false,
    mostrarNovo: true, limiteLinhas: LOTE_LINHAS, limiteCards: LOTE_LINHAS,
  };

  // ---------- auxiliares ----------
  /* Leilão cuja última data (1ª ou 2ª praça) já passou: a fonte às vezes mantém o anúncio no ar, mas não há
     mais lance a dar. Fica fora da lista, salvo com "incluir removidos e encerrados". */
  function encerrado(r) {
    const ultima = [r.data_leilao, r.data_segunda_praca].filter(Boolean).sort().pop();
    return !!ultima && ultima < LT.hojeIso();
  }
  function areaRef(r) { return r.tipo === "terreno" ? (r.area_terreno_m2 ?? r.area_privativa_m2) : (r.area_privativa_m2 ?? r.area_terreno_m2); }
  function debitos(r) {
    const a = r.debitos_iptu_por_conta_de, b = r.debitos_condominio_por_conta_de;
    if (nulo(a) && nulo(b)) return TRACO;
    return `${nulo(a) ? TRACO : cap(a)} / ${nulo(b) ? TRACO : cap(b)}`;
  }
  function descontoHtml(v) {
    if (nulo(v)) return TRACO;
    return `<span class="${v >= 0 ? "desc-pos" : "desc-neg"}">${pct(v)}</span>`;
  }
  function simNaoHtml(v) { return v === true ? '<span class="v-sim">Sim</span>' : v === false ? '<span class="v-nao">Não</span>' : TRACO; }
  function ehNovo(r) { return r.primeira_vez_visto && diasEntre(r.primeira_vez_visto, hojeIso()) <= 7; }
  function marcadores(r) {
    let s = "";
    if (estado.mostrarNovo && ehNovo(r)) s += '<span class="tag novo" title="Visto pela primeira vez nos últimos 7 dias">novo</span>';
    if (estado.quedas.has(r.id)) s += '<span class="tag queda" title="Preço caiu nos últimos 30 dias">↓ preço</span>';
    else if (estado.altas.has(r.id)) s += '<span class="tag alta" title="Preço subiu nos últimos 30 dias">↑ preço</span>';
    return s;
  }
  function $(id) { return document.getElementById(id); }
  function valoresSel(id) { return Array.from($(id).selectedOptions).map(o => o.value); }
  function numOuNull(id) { const v = $(id).value; return v === "" ? null : Number(v); }
  function urlDetalhe(r) { return `imovel.html?id=${encodeURIComponent(r.id)}${r.uf ? "&uf=" + encodeURIComponent(r.uf) : ""}`; }

  // ---------- menus de seleção múltipla (sobre os <select multiple> escondidos) ----------
  const ROTULO_OPCAO = { "f-tipo": cap, "f-natureza": cap, "f-fonte": nomeFonte };
  function montarMs(el) {
    const selId = el.dataset.sel, sel = $(selId);
    el.innerHTML = "";
    el.appendChild(sel);
    const botao = document.createElement("button");
    botao.type = "button"; botao.className = "ms-botao"; botao.setAttribute("aria-haspopup", "listbox");
    const menu = document.createElement("div"); menu.className = "ms-menu";
    el.append(botao, menu);
    botao.addEventListener("click", e => {
      e.stopPropagation();
      const abrir = !el.classList.contains("aberto");
      fecharMenus();
      if (abrir) { el.classList.add("aberto"); renderMsMenu(el); const b = menu.querySelector("input[type=search]"); if (b) b.focus(); }
    });
    menu.addEventListener("click", e => e.stopPropagation());
    renderMsBotao(el);
  }
  function renderMsBotao(el) {
    const sel = $(el.dataset.sel), botao = el.querySelector(".ms-botao");
    const vals = Array.from(sel.selectedOptions);
    const rot = el.dataset.rotulo;
    const fmt = ROTULO_OPCAO[el.dataset.sel] || (v => v);
    let texto = rot;
    if (vals.length === 1) texto = `${rot}: ${fmt(vals[0].value)}`;
    else if (vals.length > 1) texto = `${rot}: ${vals.length}`;
    botao.innerHTML = `${escapar(texto)} <span class="seta">▾</span>`;
    botao.classList.toggle("ativo", vals.length > 0);
    botao.disabled = sel.options.length === 0;
  }
  function renderMsMenu(el) {
    const sel = $(el.dataset.sel), menu = el.querySelector(".ms-menu");
    const fmt = ROTULO_OPCAO[el.dataset.sel] || (v => v);
    const termo = (menu.querySelector("input[type=search]") || {}).value || "";
    const t = semAcentos(termo).toLowerCase();
    const opts = Array.from(sel.options).filter(o => !t || semAcentos(fmt(o.value)).toLowerCase().includes(t));
    const busca = el.dataset.busca ? `<input type="search" placeholder="Filtrar ${escapar(el.dataset.rotulo.toLowerCase())}…" value="${escapar(termo)}" aria-label="Filtrar opções">` : "";
    const lista = opts.length ? opts.map(o => `<label><input type="checkbox" value="${escapar(o.value)}" ${o.selected ? "checked" : ""}> <span>${escapar(fmt(o.value))}</span><span class="n">${o.dataset.n || ""}</span></label>`).join("")
      : '<div class="vazio">nenhuma opção</div>';
    menu.innerHTML = `${busca}<div class="opcoes">${lista}</div><div class="rodape"><button type="button" class="btn pequeno limpar">Limpar</button><button type="button" class="btn pequeno primario fechar">OK</button></div>`;
    const inp = menu.querySelector("input[type=search]");
    if (inp) {
      inp.addEventListener("input", () => { const pos = inp.selectionStart; renderMsMenu(el); const n = menu.querySelector("input[type=search]"); n.focus(); n.setSelectionRange(pos, pos); });
      inp.addEventListener("keydown", e => { if (e.key === "Enter") { const first = menu.querySelector(".opcoes input"); if (first && opts.length === 1) { first.checked = !first.checked; first.dispatchEvent(new Event("change", { bubbles: true })); } } });
    }
    menu.querySelector(".opcoes").addEventListener("change", e => {
      const o = Array.from(sel.options).find(x => x.value === e.target.value);
      if (o) o.selected = e.target.checked;
      renderMsBotao(el);
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    menu.querySelector(".limpar").addEventListener("click", () => { for (const o of sel.options) o.selected = false; renderMsBotao(el); renderMsMenu(el); sel.dispatchEvent(new Event("change", { bubbles: true })); });
    menu.querySelector(".fechar").addEventListener("click", fecharMenus);
  }
  function fecharMenus() { document.querySelectorAll(".ms.aberto").forEach(m => m.classList.remove("aberto")); $("colunas-menu").classList.remove("aberto"); }
  function atualizarTodosMs() { document.querySelectorAll(".ms").forEach(renderMsBotao); }

  // ---------- opções dos filtros ----------
  function preencherSelect(id, valores) {
    const sel = $(id);
    const atuais = new Set(valoresSel(id));
    sel.innerHTML = "";
    for (const [v, n] of valores) {
      const o = document.createElement("option");
      o.value = v; o.textContent = v; o.dataset.n = n;
      if (atuais.has(v)) o.selected = true;
      sel.appendChild(o);
    }
  }
  function contagem(campo, base) {
    const m = new Map();
    for (const r of base) { const v = r[campo]; if (!nulo(v)) m.set(v, (m.get(v) || 0) + 1); }
    return Array.from(m.entries()).sort((a, b) => String(a[0]).localeCompare(String(b[0]), "pt-BR"));
  }
  /* Base das contagens dos seletores: a mesma regra da tabela (sem removidos nem leilões já encerrados,
     salvo com "incluir removidos e encerrados" marcado) — senão o seletor promete imóveis que o filtro não mostra. */
  function baseContagem() {
    const tudo = $("f-inativos") && $("f-inativos").checked;
    return tudo ? estado.todos : estado.todos.filter(r => r.ativo !== false && !encerrado(r));
  }
  function montarOpcoes() {
    const ativos = baseContagem();
    if (estado.todasUfs) {
      const n = Object.fromEntries(contagem("uf", ativos));
      preencherSelect("f-uf", estado.todasUfs.map(u => [u, estado.ufsCarregadas.has(u) ? (n[u] || 0) : "carregar"]));
    } else preencherSelect("f-uf", contagem("uf", ativos));
    preencherSelect("f-tipo", contagem("tipo", ativos));
    preencherSelect("f-natureza", contagem("natureza", ativos));
    preencherSelect("f-modalidade", contagem("modalidade", ativos));
    preencherSelect("f-fonte", contagem("fonte", ativos));
    atualizarCidadesBairros();
    atualizarTodosMs();
  }
  function atualizarCidadesBairros() {
    const ufs = valoresSel("f-uf");
    const ativos = baseContagem();
    const base = ufs.length ? ativos.filter(r => ufs.includes(r.uf)) : ativos;
    preencherSelect("f-cidade", contagem("cidade", base));
    const cidades = valoresSel("f-cidade");
    const base2 = cidades.length ? base.filter(r => cidades.includes(r.cidade)) : base;
    preencherSelect("f-bairro", contagem("bairro", base2));
    atualizarTodosMs();
  }

  function lerFiltros() {
    return {
      uf: valoresSel("f-uf"), cidade: valoresSel("f-cidade"), bairro: valoresSel("f-bairro"), tipo: valoresSel("f-tipo"),
      natureza: valoresSel("f-natureza"), modalidade: valoresSel("f-modalidade"), fonte: valoresSel("f-fonte"),
      vmin: numOuNull("f-vmin"), vmax: numOuNull("f-vmax"), dmin: numOuNull("f-dmin"), dmax: numOuNull("f-dmax"),
      m2min: numOuNull("f-m2min"), m2max: numOuNull("f-m2max"), amin: numOuNull("f-amin"),
      desocupados: $("f-desocupados").checked, fgts: $("f-fgts").checked, financiamento: $("f-financiamento").checked,
      debvendedor: $("f-debvendedor").checked, leilaoProx: $("f-leilao-prox").checked, leilaoDias: numOuNull("f-leilao-dias") || 30,
      novos: $("f-novos").checked, mudouPreco: $("f-mudou-preco").checked, inativos: $("f-inativos").checked,
      busca: $("f-busca").value.trim(),
    };
  }

  function aplicarFiltros() {
    const f = lerFiltros();
    const hoje = hojeIso();
    const busca = semAcentos(f.busca).toLowerCase();
    const dentro = (v, min, max) => !(min !== null && (nulo(v) || v < min)) && !(max !== null && (nulo(v) || v > max));
    estado.filtrados = estado.todos.filter(r => {
      if (!f.inativos && (r.ativo === false || encerrado(r))) return false;
      if (f.uf.length && !f.uf.includes(r.uf)) return false;
      if (f.cidade.length && !f.cidade.includes(r.cidade)) return false;
      if (f.bairro.length && !f.bairro.includes(r.bairro)) return false;
      if (f.tipo.length && !f.tipo.includes(r.tipo)) return false;
      if (f.natureza.length && !f.natureza.includes(r.natureza)) return false;
      if (f.modalidade.length && !f.modalidade.includes(r.modalidade)) return false;
      if (f.fonte.length && !f.fonte.includes(r.fonte)) return false;
      if (!dentro(r.valor_minimo, f.vmin, f.vmax)) return false;
      if (!dentro(r.desconto_pct, f.dmin, f.dmax)) return false;
      if (!dentro(r.valor_m2, f.m2min, f.m2max)) return false;
      if (f.amin !== null && (nulo(areaRef(r)) || areaRef(r) < f.amin)) return false;
      if (f.desocupados && r.ocupado !== false) return false;
      if (f.fgts && r.aceita_fgts !== true) return false;
      if (f.financiamento && r.aceita_financiamento !== true) return false;
      if (f.debvendedor && !(r.debitos_iptu_por_conta_de === "vendedor" || r.debitos_condominio_por_conta_de === "vendedor")) return false;
      if (f.leilaoProx) {
        if (!r.data_leilao) return false;
        const d = diasEntre(hoje, r.data_leilao);
        if (d < 0 || d > f.leilaoDias) return false;
      }
      if (f.novos && !ehNovo(r)) return false;
      if (f.mudouPreco && !estado.precoMudou30.has(r.id)) return false;
      if (busca) {
        const alvo = semAcentos([r.id, r.endereco, r.bairro, r.cidade, r.descricao_original, r.modalidade, r.leiloeiro, r.comitente].join(" ")).toLowerCase();
        if (!alvo.includes(busca)) return false;
      }
      return true;
    });
    estado.limiteLinhas = LOTE_LINHAS; estado.limiteCards = LOTE_LINHAS;
    ordenar();
    render();
    renderChips(f);
    escreverUrl(f);
  }

  // ---------- chips dos filtros ativos ----------
  function renderChips(f) {
    const chips = [];
    const lista = (chave, rot, fmt) => { for (const v of f[chave]) chips.push({ rot: `${rot}: ${fmt ? fmt(v) : v}`, desfazer: () => { const o = Array.from($("f-" + chave).options).find(x => x.value === v); if (o) o.selected = false; } }); };
    lista("uf", "UF"); lista("cidade", "Cidade"); lista("bairro", "Bairro"); lista("tipo", "Tipo", cap); lista("natureza", "Natureza", cap); lista("modalidade", "Modalidade"); lista("fonte", "Fonte", nomeFonte);
    const faixa = (min, max, rot, fmt) => {
      if (f[min] === null && f[max] === null) return;
      const a = f[min] === null ? "" : fmt(f[min]), b = f[max] === null ? "" : fmt(f[max]);
      chips.push({ rot: `${rot}: ${a && b ? a + " a " + b : a ? "≥ " + a : "≤ " + b}`, desfazer: () => { $("f-" + min).value = ""; $("f-" + max).value = ""; } });
    };
    faixa("vmin", "vmax", "Lance", v => moeda(v)); faixa("dmin", "dmax", "Desconto", v => v + "%"); faixa("m2min", "m2max", "R$/m²", v => numero(v, 0));
    if (f.amin !== null) chips.push({ rot: `Área ≥ ${numero(f.amin)} m²`, desfazer: () => { $("f-amin").value = ""; } });
    const cbs = [["desocupados", "só desocupados"], ["fgts", "aceita FGTS"], ["financiamento", "aceita financiamento"], ["debvendedor", "débitos do vendedor"], ["novos", "novos (7 dias)"], ["mudouPreco", "mudou de preço"], ["inativos", "inclui removidos"]];
    const ids = { desocupados: "f-desocupados", fgts: "f-fgts", financiamento: "f-financiamento", debvendedor: "f-debvendedor", novos: "f-novos", mudouPreco: "f-mudou-preco", inativos: "f-inativos" };
    for (const [k, rot] of cbs) if (f[k]) chips.push({ rot, desfazer: () => { $(ids[k]).checked = false; } });
    if (f.leilaoProx) chips.push({ rot: `leilão em até ${f.leilaoDias} dias`, desfazer: () => { $("f-leilao-prox").checked = false; } });
    if (f.busca) chips.push({ rot: `“${f.busca}”`, desfazer: () => { $("f-busca").value = ""; } });
    const el = $("chips");
    el.innerHTML = chips.map((c, i) => `<span class="chip">${escapar(c.rot)}<button type="button" data-i="${i}" aria-label="Remover filtro ${escapar(c.rot)}">×</button></span>`).join("");
    el.querySelectorAll("button").forEach(b => b.addEventListener("click", () => { chips[Number(b.dataset.i)].desfazer(); atualizarCidadesBairros(); aplicarFiltros(); }));
    $("filtros-ativos").classList.toggle("hidden", chips.length === 0);
    // contador no botão "Mais filtros": só os filtros que ficam na área recolhível
    const nMais = chips.length - (f.uf.length + f.cidade.length + f.tipo.length + f.natureza.length + f.fonte.length + (f.busca ? 1 : 0));
    const badge = $("mais-filtros-n");
    badge.textContent = nMais; badge.classList.toggle("hidden", nMais <= 0);
  }

  // ---------- URL ----------
  function escreverUrl(f) {
    const p = new URLSearchParams();
    const lista = (k, v) => { if (v && v.length) p.set(k, v.join(",")); };
    lista("uf", f.uf); lista("cidade", f.cidade); lista("bairro", f.bairro); lista("tipo", f.tipo);
    lista("natureza", f.natureza); lista("modalidade", f.modalidade); lista("fonte", f.fonte);
    for (const k of ["vmin", "vmax", "dmin", "dmax", "m2min", "m2max", "amin"]) if (f[k] !== null) p.set(k, f[k]);
    for (const k of ["desocupados", "fgts", "financiamento", "debvendedor", "novos", "mudouPreco", "inativos"]) if (f[k]) p.set(k, "1");
    if (f.leilaoProx) p.set("leilao", f.leilaoDias);
    if (f.busca) p.set("q", f.busca);
    if (estado.ordem.coluna !== "valor_avaliacao" || !estado.ordem.desc) p.set("ord", (estado.ordem.desc ? "-" : "") + estado.ordem.coluna);
    if (estado.modo !== "tabela") p.set("modo", estado.modo);
    const qs = p.toString();
    history.replaceState(null, "", qs ? "?" + qs : location.pathname);
  }
  function lerUrlParaFiltros() {
    const q = lerQuery();
    const marcar = (id, chave) => { if (q[chave]) { const vals = q[chave].split(","); for (const o of $(id).options) o.selected = vals.includes(o.value); } };
    marcar("f-uf", "uf"); atualizarCidadesBairros();
    marcar("f-cidade", "cidade"); atualizarCidadesBairros();
    marcar("f-bairro", "bairro"); marcar("f-tipo", "tipo"); marcar("f-natureza", "natureza"); marcar("f-modalidade", "modalidade"); marcar("f-fonte", "fonte");
    for (const k of ["vmin", "vmax", "dmin", "dmax", "m2min", "m2max", "amin"]) if (q[k] !== undefined) $("f-" + k).value = q[k];
    const cbs = { desocupados: "f-desocupados", fgts: "f-fgts", financiamento: "f-financiamento", debvendedor: "f-debvendedor", novos: "f-novos", mudouPreco: "f-mudou-preco", inativos: "f-inativos" };
    for (const [k, id] of Object.entries(cbs)) $(id).checked = q[k] === "1";
    if (q.leilao) { $("f-leilao-prox").checked = true; $("f-leilao-dias").value = q.leilao; }
    if (q.q) $("f-busca").value = q.q;
    if (q.ord) { estado.ordem = { coluna: q.ord.replace(/^-/, ""), desc: q.ord.startsWith("-") }; }
    if (q.modo && ["tabela", "cards", "mapa"].includes(q.modo)) estado.modo = q.modo;
    // se a URL traz filtros da área recolhível, abre a área
    const temMais = q.bairro || q.modalidade || ["vmin", "vmax", "dmin", "dmax", "m2min", "m2max", "amin", "leilao"].some(k => q[k] !== undefined) || Object.keys(cbs).some(k => q[k] === "1");
    if (temMais) alternarMaisFiltros(true);
    atualizarTodosMs();
  }
  function alternarMaisFiltros(abrir) {
    const area = $("filtros-mais"), btn = $("btn-mais-filtros");
    const aberto = abrir === undefined ? area.classList.contains("hidden") : abrir;
    area.classList.toggle("hidden", !aberto);
    btn.setAttribute("aria-expanded", String(aberto));
    btn.childNodes[btn.childNodes.length - 1].textContent = aberto ? " ▴" : " ▾";
  }

  // ---------- ordenação ----------
  function ordenar() {
    const col = COLUNAS.find(c => c.id === estado.ordem.coluna);
    if (!col || !col.chave) return;
    const dir = estado.ordem.desc ? -1 : 1;
    estado.filtrados.sort((a, b) => {
      const va = col.chave(a), vb = col.chave(b);
      if (nulo(va) && nulo(vb)) return 0;
      if (nulo(va)) return 1;  // nulos sempre no fim
      if (nulo(vb)) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      if (typeof va === "boolean" && typeof vb === "boolean") return ((va ? 1 : 0) - (vb ? 1 : 0)) * dir;
      return String(va).localeCompare(String(vb), "pt-BR") * dir;
    });
  }

  // ---------- render ----------
  function render() {
    const n = estado.filtrados.length;
    $("contador-filtrado").textContent = `${n.toLocaleString("pt-BR")} ${n === 1 ? "imóvel" : "imóveis"}`;
    document.querySelectorAll(".modo").forEach(b => b.classList.toggle("ativo", b.dataset.modo === estado.modo));
    $("vista-tabela").classList.toggle("hidden", estado.modo !== "tabela");
    $("vista-cards").classList.toggle("hidden", estado.modo !== "cards");
    $("mais-cards").classList.toggle("hidden", estado.modo !== "cards" || estado.filtrados.length <= estado.limiteCards);
    $("vista-mapa").classList.toggle("hidden", estado.modo !== "mapa");
    $("colunas-menu").classList.toggle("hidden", estado.modo !== "tabela");
    if (estado.modo === "tabela") renderTabela();
    else if (estado.modo === "cards") renderCards();
    else renderMapa();
    renderSelecao();
  }

  function colunasVisiveis() { return COLUNAS.filter(c => c.fixa || !estado.ocultas.has(c.id)); }

  function renderTabela() {
    const cab = $("cabecalho");
    cab.innerHTML = "";
    for (const c of colunasVisiveis()) {
      const th = document.createElement("th");
      if (c.num) th.className = "num";
      if (c.titulo) th.title = c.titulo;
      th.innerHTML = escapar(c.rotulo) + (estado.ordem.coluna === c.id ? `<span class="seta">${estado.ordem.desc ? "▼" : "▲"}</span>` : "");
      if (c.chave) {
        th.setAttribute("aria-sort", estado.ordem.coluna === c.id ? (estado.ordem.desc ? "descending" : "ascending") : "none");
        th.addEventListener("click", () => {
          if (estado.ordem.coluna === c.id) estado.ordem.desc = !estado.ordem.desc;
          else estado.ordem = { coluna: c.id, desc: !!c.num };
          ordenar(); render(); escreverUrl(lerFiltros());
        });
      }
      cab.appendChild(th);
    }
    const corpo = $("corpo");
    const partes = [];
    const cols = colunasVisiveis();
    const limite = Math.min(estado.filtrados.length, estado.limiteLinhas);
    for (let i = 0; i < limite; i++) {
      const r = estado.filtrados[i];
      const sel = estado.selecionados.has(r.id);
      let tr = `<tr data-id="${escapar(r.id)}" id="linha-${escapar(r.id)}" class="${sel ? "selecionado" : ""}${r.ativo === false ? " inativo" : ""}" title="Abrir a ficha do imóvel">`;
      for (const c of cols) {
        if (c.id === "ia") { tr += `<td class="cel-ia"><a class="btn-ia" href="${urlDetalhe(r)}#analise" title="Parecer detalhado gerado por IA: edital, matrícula, mercado, riscos e veredito">IA ✦</a></td>`; continue; }
        if (c.id === "sel") { tr += `<td><input type="checkbox" class="sel" data-id="${escapar(r.id)}" ${sel ? "checked" : ""} title="Selecionar para comparar (até 3)" aria-label="Selecionar para comparar"></td>`; continue; }
        if (c.id === "link") { tr += `<td class="cel-links"><a href="${escapar(r.url_anuncio || "#")}" target="_blank" rel="noopener" title="Abrir o anúncio no site de origem">anúncio ↗</a></td>`; continue; }
        if (c.id === "cidade") { tr += `<td class="cel-cidade"><a href="${urlDetalhe(r)}">${escapar(r.cidade || TRACO)}</a>${r.uf ? `<span class="muted">/${escapar(r.uf)}</span>` : ""}${marcadores(r)}</td>`; continue; }
        const v = c.valor(r);
        const conteudo = c.html ? v : escapar(nulo(v) ? TRACO : v);
        const title = (c.id === "endereco" || c.id === "modalidade" || c.id === "fonte") && v ? ` title="${escapar(v)}"` : "";
        tr += `<td class="${c.num ? "num" : ""} ${c.classe || ""}"${title}>${conteudo}</td>`;
      }
      partes.push(tr + "</tr>");
    }
    corpo.innerHTML = partes.join("") || `<tr><td colspan="${cols.length}" class="muted" style="padding:16px">Nenhum imóvel com esses filtros. <a href="#" id="limpar-inline">Limpar filtros</a></td></tr>`;
    const li = $("limpar-inline"); if (li) li.addEventListener("click", e => { e.preventDefault(); limparFiltros(); });
    const resta = estado.filtrados.length - limite;
    $("mais-linhas").classList.toggle("hidden", resta <= 0);
    $("mais-info").textContent = resta > 0 ? `mostrando ${limite.toLocaleString("pt-BR")} de ${estado.filtrados.length.toLocaleString("pt-BR")}` : "";
    $("btn-mais").textContent = `Mostrar mais ${Math.min(resta, LOTE_LINHAS).toLocaleString("pt-BR")}`;
  }

  const ICONES = {
    apartamento: '<svg viewBox="0 0 24 24"><path d="M5 21V4h10v17M15 9h4v12M8 8h1M8 12h1M8 16h1M11 8h1M11 12h1M11 16h1"/></svg>',
    casa: '<svg viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5M5 10v10h14V10M10 20v-6h4v6"/></svg>',
    terreno: '<svg viewBox="0 0 24 24"><path d="M3 18l6-9 4 6 3-4 5 7zM3 21h18"/></svg>',
    comercial: '<svg viewBox="0 0 24 24"><path d="M3 9l2-5h14l2 5M4 9v11h16V9M4 9a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0M9 20v-6h6v6"/></svg>',
    rural: '<svg viewBox="0 0 24 24"><path d="M3 20h18M6 20v-7l6-5 6 5v7M9 20v-4h6v4M12 8V4M10 6h4"/></svg>',
  };
  function iconeTipo(t) { return ICONES[t] || '<svg viewBox="0 0 24 24"><path d="M4 20V6l8-3 8 3v14M9 20v-5h6v5"/></svg>'; }

  /* Colunas que ficam vazias em quase toda a base carregada (ex.: FGTS, Ocupação e Leilão para a Caixa) saem
     da tabela por padrão; a pessoa pode religar em "Colunas". Só vale quando ela nunca salvou preferência. */
  function ocultarColunasVazias() {
    if (localStorage.getItem("lt.colunasOcultas")) return;
    const ativos = estado.todos.filter(r => r.ativo !== false);
    if (ativos.length < 50) return;
    for (const c of COLUNAS) {
      if (c.fixa || !c.chave || ["cidade", "bairro", "tipo", "valor_minimo", "desconto_pct", "fonte", "ocupado"].includes(c.id)) continue;
      let vazios = 0;
      for (const r of ativos) if (nulo(c.chave(r))) vazios++;
      if (vazios / ativos.length >= 0.8) estado.ocultas.add(c.id);
    }
  }
  function tituloCurto(r) {
    const tipo = cap(r.tipo) === TRACO ? "Imóvel" : cap(r.tipo);
    const onde = [r.bairro, r.cidade].filter(Boolean).join(", ");
    return `${tipo} em ${onde || TRACO}${r.uf ? "/" + r.uf : ""}`;
  }
  function renderCards() {
    const el = $("vista-cards");
    const limite = Math.min(estado.filtrados.length, estado.limiteCards);
    const html = [];
    for (let i = 0; i < limite; i++) {
      const r = estado.filtrados[i];
      const area = areaRef(r);
      html.push(`
      <article class="card">
        ${r.url_foto ? `<div class="foto" style="background-image:url('${escapar(r.url_foto)}')"></div>` : ""}
        <div class="topo-card">
          <div class="icone" aria-hidden="true">${iconeTipo(r.tipo)}</div>
          <div>
            <div class="titulo"><a href="${urlDetalhe(r)}">${escapar(tituloCurto(r))}</a>${marcadores(r)}</div>
            <div class="local">${escapar(r.endereco || "endereço não informado")}</div>
          </div>
        </div>
        <div class="corpo">
          <div class="preco-linha"><span class="preco">${moeda(r.valor_minimo)}</span>${nulo(r.desconto_pct) ? "" : `<span class="desc-badge ${r.desconto_pct < 0 ? "neg" : ""}">${pct(r.desconto_pct)}</span>`}<span class="meta">aval. ${moeda(r.valor_avaliacao)}</span></div>
          <div class="meta">${escapar(cap(r.natureza))} · ${escapar(r.modalidade || TRACO)} · ${escapar(nomeFonte(r.fonte))}</div>
          <div class="fatos">
            <div class="fato">Área<b>${nulo(area) ? TRACO : numero(area) + " m²"}</b></div>
            <div class="fato">R$/m²<b>${nulo(r.valor_m2) ? TRACO : numero(r.valor_m2, 0)}</b></div>
            <div class="fato">Leilão<b>${data(r.data_leilao)}</b></div>
            <div class="fato">Quartos<b>${numero(r.quartos, 0)}</b></div>
            <div class="fato">Ocupação<b>${ocupado(r.ocupado)}</b></div>
            <div class="fato">Pagamento<b>${[r.aceita_fgts === true ? "FGTS" : null, r.aceita_financiamento === true ? "financiamento" : null, r.aceita_parcelamento === true ? "parcelado" : null].filter(Boolean).join(", ") || (r.aceita_financiamento === false ? "à vista" : TRACO)}</b></div>
          </div>
          <div class="rodape">
            <label title="Marque até 3 imóveis para comparar lado a lado"><input type="checkbox" class="sel" data-id="${escapar(r.id)}" ${estado.selecionados.has(r.id) ? "checked" : ""}> comparar</label>
            <a href="${escapar(r.url_anuncio || "#")}" target="_blank" rel="noopener">ver anúncio ↗</a>
          </div>
        </div>
      </article>`);
    }
    el.innerHTML = html.join("") || '<p class="muted">Nenhum imóvel com esses filtros.</p>';
    const resta = estado.filtrados.length - limite;
    $("mais-cards").classList.toggle("hidden", resta <= 0);
    $("btn-mais-cards").textContent = `Mostrar mais ${Math.min(resta, LOTE_LINHAS).toLocaleString("pt-BR")} (de ${resta.toLocaleString("pt-BR")} restantes)`;
  }

  function renderMapa() {
    if (!estado.mapa) {
      estado.mapa = L.map("mapa", { preferCanvas: true }).setView([-20.3, -40.4], 8);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(estado.mapa);
      estado.cluster = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 45 });
      estado.mapa.addLayer(estado.cluster);
      criarFiltrosMapa();
    }
    sincronizarFiltrosMapa();
    estado.cluster.clearLayers();
    const pontos = [];
    for (const r of estado.filtrados) {
      if (nulo(r.lat) || nulo(r.lng)) continue;
      const aprox = r.geo_precisao && r.geo_precisao !== "endereco";
      const m = L.circleMarker([r.lat, r.lng], {
        radius: aprox ? 6 : 7, color: aprox ? "#777" : "#0b5fff", fillColor: aprox ? "#bbb" : "#0b5fff",
        fillOpacity: aprox ? .5 : .85, weight: aprox ? 1 : 2, dashArray: aprox ? "2,2" : null,
      });
      m.bindPopup(`<b>${escapar(tituloCurto(r))}</b><br><b>${moeda(r.valor_minimo)}</b> ${descontoHtml(r.desconto_pct)} · aval. ${moeda(r.valor_avaliacao)}<br>
        ${escapar(r.endereco || TRACO)}<br>
        ${escapar(r.modalidade || TRACO)} · ${nulo(areaRef(r)) ? TRACO : numero(areaRef(r)) + " m²"} · leilão ${data(r.data_leilao)}<br>
        <span class="muted">localização: ${escapar(r.geo_precisao === "endereco" ? "endereço" : r.geo_precisao || TRACO)}</span><br>
        <a href="${urlDetalhe(r)}">ficha completa</a> · <a href="${escapar(r.url_anuncio || "#")}" target="_blank" rel="noopener">ver anúncio ↗</a>`);
      pontos.push(m);
    }
    estado.cluster.addLayers(pontos);
    setTimeout(() => {
      estado.mapa.invalidateSize();
      if (pontos.length) estado.mapa.fitBounds(estado.cluster.getBounds().pad(0.1));
    }, 50);
  }

  // ---------- filtros rápidos sobre o mapa ----------
  // Espelham campos do formulário principal: mudar aqui muda lá (e vice-versa via sincronizar).
  const FILTROS_MAPA = [["mf-dmin", "f-dmin"], ["mf-vmax", "f-vmax"], ["mf-desocupados", "f-desocupados"], ["mf-financiamento", "f-financiamento"], ["mf-leilao", "f-leilao-prox"], ["mf-dias", "f-leilao-dias"]];
  function criarFiltrosMapa() {
    const Painel = L.Control.extend({
      options: { position: "topright" },
      onAdd() {
        const div = L.DomUtil.create("div", "mapa-filtros");
        div.innerHTML = `
          <button type="button" class="mf-titulo" aria-expanded="true">Filtros rápidos <span aria-hidden="true">▾</span></button>
          <div class="mf-corpo">
            <label>Desconto mín. % <input type="number" id="mf-dmin" min="0" step="5" placeholder="ex.: 30"></label>
            <label>Lance até R$ <input type="number" id="mf-vmax" min="0" step="10000" placeholder="ex.: 200000"></label>
            <label class="mf-cb"><input type="checkbox" id="mf-desocupados"> só desocupados</label>
            <label class="mf-cb"><input type="checkbox" id="mf-financiamento"> aceita financiamento</label>
            <span class="mf-cb"><label><input type="checkbox" id="mf-leilao"> leilão em até</label> <input type="number" id="mf-dias" value="30" min="1" class="mf-dias" aria-label="Quantidade de dias"> dias</span>
            <button type="button" class="btn pequeno" id="mf-limpar">Limpar estes filtros</button>
          </div>`;
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        return div;
      },
    });
    estado.mapa.addControl(new Painel());
    let t;
    for (const [de, para] of FILTROS_MAPA) {
      $(de).addEventListener("input", () => {
        const a = $(de), b = $(para);
        if (a.type === "checkbox") b.checked = a.checked; else b.value = a.value;
        clearTimeout(t); t = setTimeout(aplicarFiltros, 350);
      });
    }
    $("mf-limpar").addEventListener("click", () => {
      for (const [de, para] of FILTROS_MAPA) {
        const a = $(de), b = $(para);
        if (a.type === "checkbox") { a.checked = false; b.checked = false; }
        else if (de === "mf-dias") { a.value = "30"; b.value = "30"; }
        else { a.value = ""; b.value = ""; }
      }
      aplicarFiltros();
    });
    const btn = document.querySelector(".mapa-filtros .mf-titulo");
    btn.addEventListener("click", () => {
      const corpo = document.querySelector(".mapa-filtros .mf-corpo");
      const aberto = corpo.classList.toggle("hidden");
      btn.setAttribute("aria-expanded", String(!aberto));
      btn.querySelector("span").textContent = aberto ? "▸" : "▾";
    });
    // celular: começa recolhido para não cobrir o mapa
    if (window.matchMedia("(max-width: 700px)").matches) btn.click();
  }
  function sincronizarFiltrosMapa() {
    for (const [de, para] of FILTROS_MAPA) {
      const a = $(de), b = $(para);
      if (!a) continue;
      if (a.type === "checkbox") a.checked = b.checked; else a.value = b.value;
    }
  }

  // ---------- colunas ----------
  function montarMenuColunas() {
    const lista = $("colunas-lista");
    lista.innerHTML = COLUNAS.filter(c => !c.fixa).map(c =>
      `<label><input type="checkbox" data-col="${c.id}" ${estado.ocultas.has(c.id) ? "" : "checked"}> ${escapar(c.rotulo || c.id)}</label>`).join("");
    lista.addEventListener("change", e => {
      const col = e.target.dataset.col;
      if (!col) return;
      if (e.target.checked) estado.ocultas.delete(col); else estado.ocultas.add(col);
      localStorage.setItem("lt.colunasOcultas", JSON.stringify(Array.from(estado.ocultas)));
      renderTabela();
    });
    lista.addEventListener("click", e => e.stopPropagation());
    $("btn-colunas").addEventListener("click", e => { e.stopPropagation(); const aberto = $("colunas-menu").classList.contains("aberto"); fecharMenus(); if (!aberto) $("colunas-menu").classList.add("aberto"); });
  }

  // ---------- seleção / comparação ----------
  function renderSelecao() {
    const n = estado.selecionados.size;
    $("barra-selecao").classList.toggle("hidden", n === 0);
    $("selecao-texto").textContent = n < 2 ? `${n} selecionado · marque até 3 para comparar` : `${n} selecionados (máx. 3)`;
    $("btn-comparar").disabled = n < 2;
  }
  function aoSelecionar(e) {
    if (!e.target.classList.contains("sel")) return;
    const id = e.target.dataset.id;
    if (e.target.checked) {
      if (estado.selecionados.size >= 3) { e.target.checked = false; alert("Selecione no máximo 3 imóveis para comparar."); return; }
      estado.selecionados.add(id);
    } else estado.selecionados.delete(id);
    const tr = document.getElementById("linha-" + id);
    if (tr) tr.classList.toggle("selecionado", e.target.checked);
    renderSelecao();
  }
  const CAMPOS_COMPARACAO = ["fonte", "tipo", "cidade", "bairro", "endereco", "area_privativa_m2", "area_terreno_m2", "quartos", "vagas",
    "valor_avaliacao", "valor_minimo", "desconto_pct", "valor_m2", "natureza", "modalidade", "data_leilao", "data_segunda_praca",
    "ocupado", "aceita_financiamento", "aceita_fgts", "aceita_parcelamento", "debitos_iptu_por_conta_de", "debitos_condominio_por_conta_de",
    "comissao_leiloeiro_pct", "leiloeiro", "primeira_vez_visto"];
  const MELHOR = { valor_minimo: "min", valor_m2: "min", desconto_pct: "max", area_privativa_m2: "max", area_terreno_m2: "max", quartos: "max", vagas: "max" };
  function abrirComparacao() {
    const itens = Array.from(estado.selecionados).map(id => estado.todos.find(r => r.id === id)).filter(Boolean);
    if (itens.length < 2) return;
    let html = `<h2>Comparação lado a lado <button type="button" class="btn pequeno" id="fechar-comparar">fechar ✕</button></h2><p class="muted" style="margin:0 0 8px;font-size:.8rem">Células verdes marcam o melhor valor entre os selecionados (menor preço e R$/m², maior desconto e área).</p><table class="comparacao"><tr><th></th>`;
    for (const r of itens) html += `<th><a href="${urlDetalhe(r)}">${escapar(tituloCurto(r))}</a></th>`;
    html += "</tr>";
    for (const c of CAMPOS_COMPARACAO) {
      const vals = itens.map(r => r[c]);
      let melhor = null;
      if (MELHOR[c]) {
        const nums = vals.filter(v => typeof v === "number");
        if (nums.length > 1) melhor = MELHOR[c] === "min" ? Math.min(...nums) : Math.max(...nums);
      }
      html += `<tr><td>${escapar(ROTULOS[c] || c)}</td>` + itens.map(r => `<td class="${melhor !== null && r[c] === melhor ? "melhor" : ""}">${escapar(formatarCampo(c, r[c]))}</td>`).join("") + "</tr>";
    }
    html += `<tr><td>Links</td>` + itens.map(r => `<td><a href="${escapar(r.url_anuncio || "#")}" target="_blank" rel="noopener">anúncio ↗</a>${r.url_edital ? ` · <a href="${escapar(r.url_edital)}" target="_blank" rel="noopener">edital ↗</a>` : ""}</td>`).join("") + "</tr></table>";
    const painel = $("painel-comparar");
    painel.innerHTML = html;
    painel.classList.remove("hidden");
    $("fechar-comparar").addEventListener("click", () => painel.classList.add("hidden"));
  }

  // ---------- CSV ----------
  const CAMPOS_CSV = ["id", "fonte", "url_anuncio", "url_edital", "url_matricula", "leiloeiro", "tipo", "uf", "cidade", "bairro", "endereco", "lat", "lng", "geo_precisao",
    "area_privativa_m2", "area_terreno_m2", "area_total_m2", "quartos", "vagas", "valor_avaliacao", "valor_minimo", "desconto_pct", "valor_m2",
    "natureza", "modalidade", "data_leilao", "data_segunda_praca", "ocupado", "aceita_financiamento", "aceita_fgts", "aceita_parcelamento",
    "debitos_iptu_por_conta_de", "debitos_condominio_por_conta_de", "comissao_leiloeiro_pct", "matricula", "numero_processo", "comitente", "descricao_original",
    "url_foto", "primeira_vez_visto", "ultima_vez_visto", "ativo", "outras_fontes", "extracao_ia"];
  function csvValor(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "number") return String(v).replace(".", ",");  // Excel pt-BR
    if (typeof v === "boolean") return v ? "sim" : "não";
    if (typeof v === "object") v = JSON.stringify(v);
    v = String(v);
    return /[;"\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function exportarCsv() {
    const linhas = [CAMPOS_CSV.join(";")];
    for (const r of estado.filtrados) linhas.push(CAMPOS_CSV.map(c => csvValor(r[c])).join(";"));
    const blob = new Blob(["﻿" + linhas.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `aysha-leiloes-${hojeIso()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- cabeçalho (status) ----------
  function renderStatus() {
    const m = estado.meta, st = estado.status || {};
    if (!m) { $("contador").textContent = ""; return; }
    const todasUfs = m.ufs || Object.keys(m.por_uf || {});
    const carregadas = Array.from(estado.ufsCarregadas).sort();
    const quando = m.data_coleta === LT.hojeIso() ? "atualizado hoje" : `atualizado em ${data(m.data_coleta)}`;
    if (estado.dividido && carregadas.length && carregadas.length < todasUfs.length) {
      const n = estado.todos.filter(r => r.ativo !== false).length;
      $("contador").textContent = `${n.toLocaleString("pt-BR")} imóveis em ${carregadas.join(", ")} · ${todasUfs.length} estados no filtro UF · ${quando}`;
    } else {
      $("contador").textContent = `${m.ativos.toLocaleString("pt-BR")} imóveis em ${todasUfs.length} estados · ${quando}`;
    }
    const ativas = Object.entries(st).filter(([n, s]) => !n.startsWith("_") && s.ativa);
    $("rodape-fontes").innerHTML = ativas.filter(([, s]) => s.site).map(([n, s]) => `<a href="${escapar(s.site)}" rel="noopener" target="_blank">${escapar(nomeFonte(n))}</a>`).join(", ") || "Caixa";
    const cfg = window.LT_CONFIG || {};
    if (cfg.urlApoio) {
      const a = $("apoio-link");
      if (!a) return;
      a.href = cfg.urlApoio; a.textContent = cfg.textoApoio || "Apoie o projeto"; a.classList.remove("hidden");
    }
  }

  // ---------- histórico ----------
  function indexarHistorico() {
    if (!estado.historico) return;
    const hoje = hojeIso();
    const ultimo = {};
    for (const e of estado.historico.eventos || []) {
      if (e.tipo !== "mudou_preco" || diasEntre(e.data, hoje) > 30) continue;
      estado.precoMudou30.add(e.id);
      if (!ultimo[e.id] || e.data >= ultimo[e.id].data) ultimo[e.id] = e;
    }
    for (const [id, e] of Object.entries(ultimo)) {
      if (e.de !== null && e.para !== null) (e.para < e.de ? estado.quedas : estado.altas).add(id);
    }
    // a etiqueta "novo" só informa quando é minoria: numa base recém-criada tudo seria "novo"
    const ativos = estado.todos.filter(r => r.ativo !== false);
    const novos = ativos.filter(ehNovo).length;
    estado.mostrarNovo = ativos.length > 0 && novos / ativos.length <= 0.3;
  }

  // ---------- carga sob demanda por UF ----------
  async function carregarUfs(lista) {
    if (!estado.dividido) return;
    const faltam = lista.filter(u => !estado.ufsCarregadas.has(u) && (!estado.todasUfs || estado.todasUfs.includes(u)));
    if (!faltam.length) return;
    $("contador-filtrado").textContent = `carregando ${faltam.join(", ")}…`;
    const novos = await Promise.all(faltam.map(u => carregarJson(`imoveis_${u}.json`)));
    estado.todos = estado.todos.concat(novos.flat().map(LT.normalizar));
    faltam.forEach(u => estado.ufsCarregadas.add(u));
    indexarHistorico();
  }
  async function garantirUfs() { await carregarUfs(valoresSel("f-uf")); }

  // ---------- primeira visita: UF do visitante (celular) e painel "onde você procura?" ----------
  const UFS_BR = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];
  const CELULAR = window.matchMedia("(max-width: 760px)").matches;
  function lerLocal(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function gravarLocal(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sem storage */ } }
  /* No celular, a base inteira (todas as UFs) pesa demais: carregamos só a UF da pessoa. A UF vem da
     última escolha dela ou da geolocalização de rede (api/uf, servida pelo Worker do site; sem permissão
     e sem guardar nada). Sem resposta, começa pelo ES, origem do projeto. */
  async function ufDoVisitante() {
    const lembrada = lerLocal("lt.ufInicial");
    if (UFS_BR.includes(lembrada)) return lembrada;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      const r = await fetch("api/uf", { signal: ctrl.signal, cache: "no-store" });
      clearTimeout(t);
      const d = await r.json();
      if (UFS_BR.includes(d.uf)) return d.uf;
    } catch (e) { /* fora da Cloudflare ou sem rede */ }
    return "ES";
  }
  function boasVindas(ufInicial) {
    const painel = $("boas-vindas");
    if (!painel || location.search || lerLocal("lt.boasvindas")) return;
    const ufs = estado.todasUfs || Array.from(new Set(estado.todos.map(r => r.uf).filter(Boolean))).sort();
    $("bv-uf").innerHTML = '<option value="">Todo o Brasil</option>' + ufs.map(u => `<option value="${u}"${u === ufInicial ? " selected" : ""}>${u}</option>`).join("");
    const encherCidades = () => {
      const uf = $("bv-uf").value;
      const cid = contagem("cidade", baseContagem().filter(r => !uf || r.uf === uf));
      $("bv-cidade").innerHTML = '<option value="">Todas as cidades</option>' + cid.map(([c, n]) => `<option value="${escapar(c)}">${escapar(c)} (${n})</option>`).join("");
    };
    encherCidades();
    $("bv-uf").addEventListener("change", async () => {
      const uf = $("bv-uf").value;
      if (uf && !estado.ufsCarregadas.has(uf)) { $("bv-cidade").innerHTML = "<option>carregando…</option>"; await carregarUfs([uf]); }
      encherCidades();
    });
    const fechar = () => { painel.classList.add("hidden"); gravarLocal("lt.boasvindas", "1"); };
    $("bv-ver").addEventListener("click", async () => {
      const uf = $("bv-uf").value, cidade = $("bv-cidade").value;
      for (const o of $("f-uf").options) o.selected = !!uf && o.value === uf;
      await garantirUfs(); montarOpcoes();
      for (const o of $("f-cidade").options) o.selected = !!cidade && o.value === cidade;
      atualizarCidadesBairros(); aplicarFiltros(); fechar();
      if (uf) gravarLocal("lt.ufInicial", uf);
    });
    $("bv-todos").addEventListener("click", async () => {
      for (const o of $("f-uf").options) o.selected = false;
      $("bv-todos").disabled = true; $("bv-todos").textContent = "carregando o Brasil…";
      await carregarUfs(ufs); montarOpcoes(); aplicarFiltros(); fechar();
    });
    $("bv-fechar").addEventListener("click", fechar);
    painel.classList.remove("hidden");
  }

  function limparFiltros() {
    $("filtros").reset();
    for (const s of $("filtros").querySelectorAll("select")) for (const o of s.options) o.selected = false;
    atualizarCidadesBairros(); aplicarFiltros();
  }

  // ---------- início ----------
  async function iniciar() {
    const q = lerQuery();
    let ufsUrl = q.uf ? q.uf.split(",") : null;
    let ufInicial = null;
    if (!ufsUrl && CELULAR) { ufInicial = await ufDoVisitante(); ufsUrl = [ufInicial]; }
    const [base, historico, status] = await Promise.all([
      carregarImoveis(ufsUrl),
      carregarJson("historico.json").catch(() => ({ eventos: [] })),
      carregarJson("status_fontes.json").catch(() => ({})),
    ]);
    estado.meta = base.meta; estado.todos = base.imoveis; estado.historico = historico; estado.status = status;
    estado.dividido = !!base.meta.dividido_por_uf;
    for (const a of base.carregados) { const m = a.match(/^imoveis_(\w+)\.json$/); if (m) estado.ufsCarregadas.add(m[1]); }
    if (estado.dividido) {
      // o seletor de UF lista todas as UFs da base, carregadas ou não; as não carregadas entram ao serem escolhidas
      estado.todasUfs = base.meta.ufs || base.arquivos.map(a => (a.match(/^imoveis_(\w+)\.json$/) || [])[1]).filter(Boolean);
      const naoCarregadas = estado.todasUfs.filter(u => !estado.ufsCarregadas.has(u));
      if (naoCarregadas.length) $("contador").title = `Carregadas: ${Array.from(estado.ufsCarregadas).join(", ")}. Selecione ${naoCarregadas.join(", ")} no filtro UF para carregar.`;
    }
    indexarHistorico();
    renderStatus();
    ocultarColunasVazias();
    document.querySelectorAll(".ms").forEach(montarMs);
    montarOpcoes();
    if (ufInicial && estado.ufsCarregadas.has(ufInicial)) {
      // celular: a UF do visitante entra como filtro visível (chip "UF: ES"), trocável a qualquer momento
      for (const o of $("f-uf").options) o.selected = o.value === ufInicial;
      atualizarCidadesBairros();
    }
    lerUrlParaFiltros();
    montarMenuColunas();
    boasVindas(ufInicial || (lerLocal("lt.ufInicial") || ""));

    $("filtros").addEventListener("submit", e => e.preventDefault());
    $("filtros").addEventListener("change", async e => {
      if (e.target.id === "f-uf") { await garantirUfs(); montarOpcoes(); const sel = valoresSel("f-uf"); if (sel.length === 1) gravarLocal("lt.ufInicial", sel[0]); }
      if (e.target.id === "f-cidade") atualizarCidadesBairros();
      if (e.target.id === "f-inativos") montarOpcoes();  // as contagens seguem a mesma regra da tabela
      if (e.target.tagName === "SELECT" || e.target.type === "checkbox" || e.target.type === "number") aplicarFiltros();
    });
    let timer;
    $("filtros").addEventListener("input", e => {
      if (e.target.type === "search" && e.target.id === "f-busca" || e.target.type === "number") { clearTimeout(timer); timer = setTimeout(aplicarFiltros, 250); }
    });
    $("btn-mais-filtros").addEventListener("click", () => alternarMaisFiltros());
    $("btn-limpar").addEventListener("click", limparFiltros);
    $("btn-copiar-link").addEventListener("click", () => navigator.clipboard.writeText(location.href).then(() => { $("btn-copiar-link").textContent = "Link copiado!"; setTimeout(() => $("btn-copiar-link").textContent = "Copiar link da busca", 1500); }));
    document.querySelectorAll(".modo").forEach(b => b.addEventListener("click", () => { estado.modo = b.dataset.modo; localStorage.setItem("lt.modo", estado.modo); render(); escreverUrl(lerFiltros()); }));
    $("btn-csv").addEventListener("click", exportarCsv);
    $("btn-mais").addEventListener("click", () => { estado.limiteLinhas += LOTE_LINHAS; renderTabela(); });
    $("btn-mais-cards").addEventListener("click", () => { estado.limiteCards += LOTE_LINHAS; renderCards(); });
    document.addEventListener("change", aoSelecionar);
    document.addEventListener("click", fecharMenus);
    document.addEventListener("keydown", e => { if (e.key === "Escape") { fecharMenus(); $("painel-comparar").classList.add("hidden"); } });
    // linha inteira abre a ficha (exceto cliques em links, checkbox e seleção de texto)
    $("corpo").addEventListener("click", e => {
      if (e.target.closest("a, input, button") || window.getSelection().toString()) return;
      const tr = e.target.closest("tr[data-id]");
      if (tr) location.href = `imovel.html?id=${encodeURIComponent(tr.dataset.id)}`;
    });
    $("btn-comparar").addEventListener("click", abrirComparacao);
    $("btn-limpar-selecao").addEventListener("click", () => { estado.selecionados.clear(); render(); });
    aplicarFiltros();
  }

  iniciar().catch(err => {
    console.error(err);
    $("contador").textContent = "erro ao carregar os dados";
    $("corpo").innerHTML = `<tr><td colspan="20">Não foi possível carregar os dados (${escapar(err.message)}). Se abriu o arquivo direto do disco, sirva a pasta docs/ por HTTP.</td></tr>`;
  });
})();
