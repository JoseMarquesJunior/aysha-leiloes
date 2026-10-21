/* Página principal: filtros, tabela, cards, mapa, comparação, CSV e URL. */
(function () {
  "use strict";
  const { TRACO, nulo, moeda, numero, pct, area, data, simNao, ocupado, cap, escapar, semAcentos, diasEntre, hojeIso,
    nomeFonte, SITES_FONTES, ROTULOS, formatarCampo, carregarJson, carregarImoveis, lerQuery } = LT;

  const COLUNAS = [
    { id: "sel", rotulo: "", fixa: true },
    { id: "fonte", rotulo: "Fonte", valor: r => nomeFonte(r.fonte), chave: r => r.fonte },
    { id: "cidade", rotulo: "Cidade", valor: r => r.cidade, chave: r => r.cidade },
    { id: "bairro", rotulo: "Bairro", valor: r => r.bairro, chave: r => r.bairro },
    { id: "endereco", rotulo: "Endereço", valor: r => r.endereco, chave: r => r.endereco, classe: "cel-end", padraoOculta: true },
    { id: "tipo", rotulo: "Tipo", valor: r => cap(r.tipo), chave: r => r.tipo },
    { id: "area", rotulo: "Área m²", num: true, valor: r => numero(areaRef(r)), chave: areaRef, titulo: "Área privativa; do terreno quando é terreno" },
    { id: "quartos", rotulo: "Qtos", num: true, valor: r => numero(r.quartos, 0), chave: r => r.quartos, padraoOculta: true },
    { id: "valor_avaliacao", rotulo: "Avaliação", num: true, valor: r => moeda(r.valor_avaliacao), chave: r => r.valor_avaliacao },
    { id: "valor_minimo", rotulo: "Lance mín.", num: true, valor: r => moeda(r.valor_minimo), chave: r => r.valor_minimo },
    { id: "desconto_pct", rotulo: "Desc. %", num: true, valor: r => descontoHtml(r.desconto_pct), chave: r => r.desconto_pct, html: true },
    { id: "valor_m2", rotulo: "R$/m²", num: true, valor: r => numero(r.valor_m2, 0), chave: r => r.valor_m2 },
    { id: "natureza", rotulo: "Natureza", valor: r => cap(r.natureza), chave: r => r.natureza },
    { id: "modalidade", rotulo: "Modalidade", valor: r => r.modalidade, chave: r => r.modalidade },
    { id: "data_leilao", rotulo: "Leilão", valor: r => data(r.data_leilao), chave: r => r.data_leilao },
    { id: "ocupado", rotulo: "Ocupação", valor: r => ocupado(r.ocupado), chave: r => r.ocupado },
    { id: "debitos", rotulo: "Débitos", valor: r => debitos(r), chave: r => debitos(r), titulo: "IPTU / condomínio por conta de" },
    { id: "aceita_fgts", rotulo: "FGTS", valor: r => simNaoHtml(r.aceita_fgts), chave: r => r.aceita_fgts, html: true },
    { id: "aceita_financiamento", rotulo: "Financ.", valor: r => simNaoHtml(r.aceita_financiamento), chave: r => r.aceita_financiamento, html: true, padraoOculta: true },
    { id: "primeira_vez_visto", rotulo: "Desde", valor: r => data(r.primeira_vez_visto), chave: r => r.primeira_vez_visto, padraoOculta: true },
    { id: "link", rotulo: "", fixa: true },
  ];

  const estado = {
    todos: [], filtrados: [], historico: null, meta: null, status: null,
    ordem: { coluna: "desconto_pct", desc: true },
    modo: localStorage.getItem("lt.modo") || "tabela",
    ocultas: new Set(JSON.parse(localStorage.getItem("lt.colunasOcultas") || "null") || COLUNAS.filter(c => c.padraoOculta).map(c => c.id)),
    selecionados: new Set(),
    mapa: null, cluster: null,
    precoMudou30: new Set(), quedas: new Set(), altas: new Set(),
    ufsCarregadas: new Set(), dividido: false,
  };

  // ---------- auxiliares ----------
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
    if (ehNovo(r)) s += '<span class="tag novo" title="Visto pela primeira vez nos últimos 7 dias">novo</span>';
    if (estado.quedas.has(r.id)) s += '<span class="tag queda" title="Preço caiu nos últimos 30 dias">↓ preço</span>';
    else if (estado.altas.has(r.id)) s += '<span class="tag alta" title="Preço subiu nos últimos 30 dias">↑ preço</span>';
    return s;
  }
  function $(id) { return document.getElementById(id); }
  function valoresSel(id) { return Array.from($(id).selectedOptions).map(o => o.value); }
  function numOuNull(id) { const v = $(id).value; return v === "" ? null : Number(v); }

  // ---------- filtros ----------
  function preencherSelect(id, valores, rotulo) {
    const sel = $(id);
    const atuais = new Set(valoresSel(id));
    sel.innerHTML = "";
    for (const v of valores) {
      const o = document.createElement("option");
      o.value = v; o.textContent = rotulo ? rotulo(v) : v;
      if (atuais.has(v)) o.selected = true;
      sel.appendChild(o);
    }
  }
  function distintos(campo, base) {
    return Array.from(new Set((base || estado.todos).map(r => r[campo]).filter(v => !nulo(v)))).sort((a, b) => String(a).localeCompare(String(b), "pt-BR"));
  }
  function montarOpcoes() {
    preencherSelect("f-uf", distintos("uf"));
    preencherSelect("f-tipo", distintos("tipo"), cap);
    preencherSelect("f-natureza", distintos("natureza"), cap);
    preencherSelect("f-modalidade", distintos("modalidade"));
    preencherSelect("f-fonte", distintos("fonte"), nomeFonte);
    atualizarCidadesBairros();
  }
  function atualizarCidadesBairros() {
    const ufs = valoresSel("f-uf");
    const base = ufs.length ? estado.todos.filter(r => ufs.includes(r.uf)) : estado.todos;
    preencherSelect("f-cidade", distintos("cidade", base));
    const cidades = valoresSel("f-cidade");
    const base2 = cidades.length ? base.filter(r => cidades.includes(r.cidade)) : base;
    preencherSelect("f-bairro", distintos("bairro", base2));
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
      if (!f.inativos && r.ativo === false) return false;
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
        const alvo = semAcentos([r.id, r.endereco, r.bairro, r.cidade, r.descricao_original, r.modalidade, r.leiloeiro].join(" ")).toLowerCase();
        if (!alvo.includes(busca)) return false;
      }
      return true;
    });
    ordenar();
    render();
    escreverUrl(f);
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
    if (estado.ordem.coluna !== "desconto_pct" || !estado.ordem.desc) p.set("ord", (estado.ordem.desc ? "-" : "") + estado.ordem.coluna);
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
    $("contador-filtrado").textContent = `${estado.filtrados.length.toLocaleString("pt-BR")} ${estado.filtrados.length === 1 ? "imóvel encontrado" : "imóveis encontrados"}`;
    document.querySelectorAll(".modo").forEach(b => b.classList.toggle("ativo", b.dataset.modo === estado.modo));
    $("vista-tabela").classList.toggle("hidden", estado.modo !== "tabela");
    $("vista-cards").classList.toggle("hidden", estado.modo !== "cards");
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
      if (c.chave) th.addEventListener("click", () => {
        if (estado.ordem.coluna === c.id) estado.ordem.desc = !estado.ordem.desc;
        else estado.ordem = { coluna: c.id, desc: c.num || c.id === "data_leilao" ? true : false };
        if (c.id === "data_leilao") estado.ordem.desc = estado.ordem.coluna === c.id ? estado.ordem.desc : false;
        ordenar(); render(); escreverUrl(lerFiltros());
      });
      cab.appendChild(th);
    }
    const corpo = $("corpo");
    const partes = [];
    const cols = colunasVisiveis();
    for (const r of estado.filtrados) {
      const sel = estado.selecionados.has(r.id);
      let tr = `<tr data-id="${escapar(r.id)}" id="linha-${escapar(r.id)}" class="${sel ? "selecionado" : ""}${r.ativo === false ? " muted" : ""}">`;
      for (const c of cols) {
        if (c.id === "sel") { tr += `<td><input type="checkbox" class="sel" data-id="${escapar(r.id)}" ${sel ? "checked" : ""} title="Selecionar para comparar (até 3)"></td>`; continue; }
        if (c.id === "link") { tr += `<td><a href="imovel.html?id=${encodeURIComponent(r.id)}">detalhe</a> · <a href="${escapar(r.url_anuncio || "#")}" target="_blank" rel="noopener">fonte ↗</a></td>`; continue; }
        const v = c.valor(r);
        const conteudo = c.html ? v : escapar(nulo(v) ? TRACO : v);
        const extra = c.id === "cidade" ? marcadores(r) : "";
        tr += `<td class="${c.num ? "num" : ""} ${c.classe || ""}" ${c.id === "endereco" ? `title="${escapar(r.endereco || "")}"` : ""}>${conteudo}${extra}</td>`;
      }
      partes.push(tr + "</tr>");
    }
    corpo.innerHTML = partes.join("") || `<tr><td colspan="${cols.length}" class="muted">Nenhum imóvel com esses filtros.</td></tr>`;
  }

  function renderCards() {
    const el = $("vista-cards");
    el.innerHTML = estado.filtrados.map(r => `
      <div class="card">
        <div class="foto" ${r.url_foto ? `style="background-image:url('${escapar(r.url_foto)}')"` : ""}>${r.url_foto ? "" : "sem foto (veja no anúncio original)"}</div>
        <div class="corpo">
          <div class="titulo">${escapar(cap(r.tipo))} em ${escapar(r.bairro || TRACO)}, ${escapar(r.cidade || TRACO)}/${escapar(r.uf || "")} ${marcadores(r)}</div>
          <div class="meta">${escapar(r.endereco || TRACO)}</div>
          <div class="preco">${moeda(r.valor_minimo)} <span class="muted" style="font-size:.8rem">${descontoHtml(r.desconto_pct)} · aval. ${moeda(r.valor_avaliacao)}</span></div>
          <div class="meta">${escapar(r.modalidade || TRACO)} · ${nulo(areaRef(r)) ? TRACO : numero(areaRef(r)) + " m²"} · ${nulo(r.valor_m2) ? TRACO : "R$ " + numero(r.valor_m2, 0) + "/m²"}${r.quartos ? ` · ${r.quartos} qto` : ""}${r.vagas ? ` · ${r.vagas} vaga` : ""}</div>
          <div class="meta">Leilão: ${data(r.data_leilao)} · ${ocupado(r.ocupado)} · FGTS: ${simNao(r.aceita_fgts)} · Financ.: ${simNao(r.aceita_financiamento)}</div>
          <div class="rodape">
            <label class="muted"><input type="checkbox" class="sel" data-id="${escapar(r.id)}" ${estado.selecionados.has(r.id) ? "checked" : ""}> comparar</label>
            <span>${escapar(nomeFonte(r.fonte))} · <a href="imovel.html?id=${encodeURIComponent(r.id)}">detalhe</a> · <a href="${escapar(r.url_anuncio || "#")}" target="_blank" rel="noopener">fonte ↗</a></span>
          </div>
        </div>
      </div>`).join("") || '<p class="muted">Nenhum imóvel com esses filtros.</p>';
  }

  function renderMapa() {
    if (!estado.mapa) {
      estado.mapa = L.map("mapa", { preferCanvas: true }).setView([-20.3, -40.4], 8);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(estado.mapa);
      estado.cluster = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 45 });
      estado.mapa.addLayer(estado.cluster);
    }
    estado.cluster.clearLayers();
    const pontos = [];
    for (const r of estado.filtrados) {
      if (nulo(r.lat) || nulo(r.lng)) continue;
      const aprox = r.geo_precisao && r.geo_precisao !== "endereco";
      const m = L.circleMarker([r.lat, r.lng], {
        radius: aprox ? 6 : 7, color: aprox ? "#777" : "#0b5fff", fillColor: aprox ? "#bbb" : "#0b5fff",
        fillOpacity: aprox ? .5 : .85, weight: aprox ? 1 : 2, dashArray: aprox ? "2,2" : null,
      });
      m.bindPopup(`<b>${escapar(cap(r.tipo))} · ${moeda(r.valor_minimo)}</b> ${descontoHtml(r.desconto_pct)}<br>
        ${escapar(r.endereco || TRACO)}<br>${escapar(r.bairro || TRACO)}, ${escapar(r.cidade || "")}/${escapar(r.uf || "")}<br>
        ${escapar(r.modalidade || TRACO)} · ${nulo(areaRef(r)) ? TRACO : numero(areaRef(r)) + " m²"} · leilão ${data(r.data_leilao)}<br>
        <span class="muted">precisão: ${escapar(r.geo_precisao || TRACO)}</span><br>
        <a href="imovel.html?id=${encodeURIComponent(r.id)}">detalhe</a> · <a href="?${urlLinhaTabela(r)}">ver na tabela</a> · <a href="${escapar(r.url_anuncio || "#")}" target="_blank" rel="noopener">fonte ↗</a>`);
      pontos.push(m);
    }
    estado.cluster.addLayers(pontos);
    setTimeout(() => {
      estado.mapa.invalidateSize();
      if (pontos.length) estado.mapa.fitBounds(estado.cluster.getBounds().pad(0.1));
    }, 50);
  }
  function urlLinhaTabela(r) {
    const p = new URLSearchParams(location.search);
    p.set("modo", "tabela"); p.set("q", r.id);
    return p.toString();
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
    $("btn-colunas").addEventListener("click", e => { e.stopPropagation(); $("colunas-menu").classList.toggle("aberto"); });
    document.addEventListener("click", e => { if (!$("colunas-menu").contains(e.target)) $("colunas-menu").classList.remove("aberto"); });
  }

  // ---------- seleção / comparação ----------
  function renderSelecao() {
    const n = estado.selecionados.size;
    $("barra-selecao").classList.toggle("hidden", n === 0);
    $("selecao-texto").textContent = `${n} selecionado${n > 1 ? "s" : ""} (máx. 3)`;
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
    let html = `<h2>Comparação lado a lado <button type="button" class="btn pequeno" id="fechar-comparar">fechar ✕</button></h2><table class="comparacao"><tr><th></th>`;
    for (const r of itens) html += `<th><a href="imovel.html?id=${encodeURIComponent(r.id)}">${escapar(r.id)}</a></th>`;
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
    "debitos_iptu_por_conta_de", "debitos_condominio_por_conta_de", "comissao_leiloeiro_pct", "matricula", "numero_processo", "descricao_original",
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
    a.download = `leiloes-em-tabela-${hojeIso()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- cabeçalho (status) ----------
  function renderStatus() {
    const m = estado.meta, st = estado.status || {};
    $("contador").textContent = m ? `${m.ativos.toLocaleString("pt-BR")} imóveis ativos` : "";
    $("ultima-coleta").textContent = m ? `coleta: ${data(m.data_coleta)}` : "";
    const partes = [], rodape = [];
    for (const [nome, s] of Object.entries(st)) {
      if (nome.startsWith("_")) continue;
      const cls = !s.ativa ? "off" : (s.ultima_coleta_ok === (m && m.data_coleta) ? "ok" : "falha");
      const titulo = !s.ativa ? "fonte desativada" : (cls === "ok" ? `coleta ok em ${data(s.ultima_coleta_ok)}, ${s.registros} registros` : `última falha: ${s.ultimo_erro || "?"}`);
      partes.push(`<span class="${cls}" title="${escapar(titulo)}"></span>${escapar(nomeFonte(nome))}`);
      if (s.ativa && s.site) rodape.push(`<a href="${escapar(s.site)}" rel="noopener" target="_blank">${escapar(nomeFonte(nome))}</a>`);
    }
    $("fontes-status").innerHTML = partes.join(" ");
    $("rodape-fontes").innerHTML = rodape.join(", ") || "Caixa";
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
  }

  // ---------- carga sob demanda por UF ----------
  async function garantirUfs() {
    if (!estado.dividido) return;
    const ufs = valoresSel("f-uf");
    const faltam = ufs.filter(u => !estado.ufsCarregadas.has(u));
    if (!faltam.length) return;
    const novos = await Promise.all(faltam.map(u => carregarJson(`imoveis_${u}.json`)));
    estado.todos = estado.todos.concat(novos.flat());
    faltam.forEach(u => estado.ufsCarregadas.add(u));
  }

  // ---------- início ----------
  async function iniciar() {
    const q = lerQuery();
    const ufsUrl = q.uf ? q.uf.split(",") : null;
    const [base, historico, status] = await Promise.all([
      carregarImoveis(ufsUrl),
      carregarJson("historico.json").catch(() => ({ eventos: [] })),
      carregarJson("status_fontes.json").catch(() => ({})),
    ]);
    estado.meta = base.meta; estado.todos = base.imoveis; estado.historico = historico; estado.status = status;
    estado.dividido = !!base.meta.dividido_por_uf;
    for (const a of base.carregados) { const m = a.match(/^imoveis_(\w+)\.json$/); if (m) estado.ufsCarregadas.add(m[1]); }
    if (estado.dividido && ufsUrl) {
      // o seletor de UF precisa listar todas as UFs disponíveis, não só as carregadas
      estado.todasUfs = base.arquivos.map(a => (a.match(/^imoveis_(\w+)\.json$/) || [])[1]).filter(Boolean);
    }
    indexarHistorico();
    renderStatus();
    montarOpcoes();
    if (estado.todasUfs) preencherSelect("f-uf", estado.todasUfs);
    lerUrlParaFiltros();
    montarMenuColunas();

    $("filtros").addEventListener("change", async e => {
      if (e.target.id === "f-uf") { await garantirUfs(); montarOpcoes(); atualizarCidadesBairros(); }
      if (e.target.id === "f-cidade") atualizarCidadesBairros();
      aplicarFiltros();
    });
    let timer;
    $("filtros").addEventListener("input", e => {
      if (e.target.type === "search" || e.target.type === "number") { clearTimeout(timer); timer = setTimeout(aplicarFiltros, 250); }
    });
    $("btn-limpar").addEventListener("click", () => { $("filtros").reset(); for (const s of $("filtros").querySelectorAll("select")) for (const o of s.options) o.selected = false; atualizarCidadesBairros(); aplicarFiltros(); });
    $("btn-copiar-link").addEventListener("click", () => navigator.clipboard.writeText(location.href).then(() => { $("btn-copiar-link").textContent = "Copiado!"; setTimeout(() => $("btn-copiar-link").textContent = "Copiar link", 1500); }));
    document.querySelectorAll(".modo").forEach(b => b.addEventListener("click", () => { estado.modo = b.dataset.modo; localStorage.setItem("lt.modo", estado.modo); render(); escreverUrl(lerFiltros()); }));
    $("btn-csv").addEventListener("click", exportarCsv);
    document.addEventListener("change", aoSelecionar);
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
