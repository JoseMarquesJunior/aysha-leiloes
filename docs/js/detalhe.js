/* Página de detalhe de um imóvel: números principais, campos, outras fontes, extração IA, histórico, gráfico e mapa. */
(function () {
  "use strict";
  const { TRACO, nulo, moeda, numero, pct, data, dataHora, cap, escapar, nomeFonte, ROTULOS, formatarCampo, carregarJson, carregarImoveis, lerQuery } = LT;

  const GRUPOS = [
    ["Valores", ["valor_avaliacao", "valor_minimo", "desconto_pct", "valor_m2", "comissao_leiloeiro_pct"]],
    ["Imóvel", ["tipo", "area_privativa_m2", "area_terreno_m2", "area_total_m2", "quartos", "vagas", "matricula"]],
    ["Condições", ["ocupado", "aceita_financiamento", "aceita_fgts", "aceita_parcelamento", "debitos_iptu_por_conta_de", "debitos_condominio_por_conta_de"]],
    ["Leilão", ["natureza", "modalidade", "data_leilao", "data_segunda_praca", "leiloeiro", "comitente", "numero_processo"]],
    ["Localização", ["endereco", "bairro", "cidade", "uf", "geo_precisao"]],
    ["Registro na base", ["id", "fonte", "primeira_vez_visto", "ultima_vez_visto", "ativo", "lat", "lng"]],
  ];

  function bloco(titulo, html, extra) { return `<div class="bloco ${extra || ""}"><h3>${escapar(titulo)}</h3>${html}</div>`; }
  function campos(r, lista) {
    return `<dl class="campos">${lista.map(c => `<dt>${escapar(ROTULOS[c] || c)}</dt><dd>${escapar(formatarCampo(c, r[c]))}</dd>`).join("")}</dl>`;
  }
  function link(url, rotulo, classe) {
    return url ? `<a class="btn ${classe || ""}" href="${escapar(url)}" target="_blank" rel="noopener">${escapar(rotulo)} ↗</a>`
      : `<span class="btn" style="opacity:.5;cursor:default" title="Não disponível nesta fonte">${escapar(rotulo)}: ${TRACO}</span>`;
  }
  function kpi(rotulo, valor, sub, classe) { return `<div class="kpi"><div class="r">${escapar(rotulo)}</div><div class="v ${classe || ""}">${valor}</div>${sub ? `<div class="s">${sub}</div>` : ""}</div>`; }

  const ROTULO_EVENTO = { novo: "Entrou na base", mudou_preco: "Preço mudou", mudou_modalidade: "Modalidade mudou", mudou_data_leilao: "Data do leilão mudou", removido: "Saiu da fonte", reativado: "Voltou a aparecer" };
  function eventoHtml(e) {
    let det = "";
    if (e.tipo === "novo") det = e.para !== null ? `com ${moeda(e.para)}` : "";
    else if (e.tipo === "mudou_preco") det = `de ${moeda(e.de)} para ${moeda(e.para)}`;
    else if (e.tipo === "removido") det = e.de !== null ? `(último valor ${moeda(e.de)})` : "";
    else det = `de ${escapar(formatarCampo(e.tipo === "mudou_data_leilao" ? "data_leilao" : "modalidade", e.de))} para ${escapar(formatarCampo(e.tipo === "mudou_data_leilao" ? "data_leilao" : "modalidade", e.para))}`;
    return `<li><span class="mono">${data(e.data)}</span> · ${ROTULO_EVENTO[e.tipo] || e.tipo} ${det}</li>`;
  }

  /* Série do valor mínimo a partir dos eventos (novo + mudou_preco) e do valor atual; gráfico em SVG puro. */
  function graficoSvg(r, eventos) {
    const pontos = [];
    for (const e of eventos) {
      if ((e.tipo === "novo" || e.tipo === "mudou_preco") && e.para !== null) pontos.push([e.data, e.para]);
    }
    if (!pontos.length && r.valor_minimo !== null) pontos.push([r.primeira_vez_visto || r.ultima_vez_visto, r.valor_minimo]);
    if (r.valor_minimo !== null && r.ultima_vez_visto && pontos.length && pontos[pontos.length - 1][0] !== r.ultima_vez_visto) pontos.push([r.ultima_vez_visto, r.valor_minimo]);
    pontos.sort((a, b) => a[0].localeCompare(b[0]));
    const valores = new Set(pontos.map(p => p[1]));
    if (pontos.length < 2 || valores.size < 2) {
      return `<p class="muted" style="margin:4px 0">Sem variação de preço registrada desde ${data(r.primeira_vez_visto)}: ${moeda(r.valor_minimo)}. O gráfico aparece quando o lance mínimo mudar entre coletas.</p>`;
    }
    const W = 600, H = 160, mL = 70, mR = 10, mT = 12, mB = 24;
    const xs = pontos.map(p => new Date(p[0] + "T00:00:00").getTime());
    const ys = pontos.map(p => p[1]);
    let x0 = Math.min(...xs), x1 = Math.max(...xs);
    if (x1 === x0) { x0 -= 86400000 * 7; x1 += 86400000 * 7; }
    let y0 = Math.min(...ys), y1 = Math.max(...ys);
    const X = t => mL + (t - x0) / (x1 - x0) * (W - mL - mR);
    const Y = v => mT + (1 - (v - y0) / (y1 - y0)) * (H - mT - mB);
    let d = "";
    pontos.forEach((p, i) => { const x = X(xs[i]), y = Y(p[1]); d += i === 0 ? `M${x},${y}` : `H${x}V${y}`; });
    const circulos = pontos.map((p, i) => `<circle cx="${X(xs[i])}" cy="${Y(p[1])}" r="3" fill="#0b5fff"><title>${data(p[0])}: ${moeda(p[1])}</title></circle>`).join("");
    const fmtK = v => v >= 1e6 ? (v / 1e6).toFixed(2) + " mi" : (v / 1e3).toFixed(0) + " mil";
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolução do valor mínimo">
      <line x1="${mL}" y1="${Y(y0)}" x2="${W - mR}" y2="${Y(y0)}" stroke="#d9dee4"/>
      <line x1="${mL}" y1="${Y(y1)}" x2="${W - mR}" y2="${Y(y1)}" stroke="#d9dee4"/>
      <text x="${mL - 6}" y="${Y(y1) + 4}" text-anchor="end" font-size="10" fill="#5c6670">R$ ${fmtK(y1)}</text>
      <text x="${mL - 6}" y="${Y(y0) + 4}" text-anchor="end" font-size="10" fill="#5c6670">R$ ${fmtK(y0)}</text>
      <text x="${mL}" y="${H - 6}" font-size="10" fill="#5c6670">${data(pontos[0][0])}</text>
      <text x="${W - mR}" y="${H - 6}" text-anchor="end" font-size="10" fill="#5c6670">${data(pontos[pontos.length - 1][0])}</text>
      <path d="${d}" fill="none" stroke="#0b5fff" stroke-width="2"/>${circulos}</svg>`;
  }

  function extracaoIaHtml(ia) {
    const linhas = [];
    for (const [k, v] of Object.entries(ia)) {
      if (k === "trechos_fonte" || k === "modelo" || k === "processado_em" || k === "hash_documento") continue;
      const trecho = ia.trechos_fonte && ia.trechos_fonte[k];
      const valor = Array.isArray(v) ? (v.length ? v.join(", ") : TRACO) : formatarCampo(k, v);
      linhas.push(`<dt>${escapar(ROTULOS[k] || k)}</dt><dd>${escapar(valor)}${trecho ? `<div class="ia-trecho">“${escapar(trecho)}”</div>` : ""}</dd>`);
    }
    return `<dl class="campos">${linhas.join("")}</dl><p class="muted" style="font-size:.78rem">Modelo: ${escapar(ia.modelo || TRACO)} · ${dataHora(ia.processado_em)}. Apoio à leitura; confira no edital.</p>`;
  }

  function outrasFontesHtml(r) {
    if (!r.outras_fontes || !r.outras_fontes.length) return '<p class="muted">Só nesta fonte. Imóveis iguais em outras fontes são reconhecidos por matrícula ou por endereço e área.</p>';
    return `<ul class="eventos">${r.outras_fontes.map(o => {
      const nome = nomeFonte(o.fonte);
      const leil = o.leiloeiro && !nome.includes((o.leiloeiro.split(" (")[0] || "").split(" ")[0]) ? ` (${escapar(o.leiloeiro.split(" (")[0])})` : "";
      return `<li><b>${escapar(nome)}</b>${leil} · ${moeda(o.valor_minimo)} · ${escapar(o.modalidade || TRACO)} · ${o.url_anuncio ? `<a href="${escapar(o.url_anuncio)}" target="_blank" rel="noopener">abrir anúncio ↗</a>` : escapar(o.id || "")}</li>`;
    }).join("")}</ul>`;
  }

  function mapaHtml(r) {
    if (nulo(r.lat) || nulo(r.lng)) return '<p class="muted">Sem coordenadas para este imóvel.</p>';
    const prec = r.geo_precisao === "endereco" ? "localização do endereço" : `localização aproximada (${r.geo_precisao || "?"})`;
    return `<div id="mapa-detalhe" role="img" aria-label="Mapa"></div><p class="muted" style="font-size:.78rem;margin:4px 0 0">${escapar(prec)} · <a href="https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lng}#map=17/${r.lat}/${r.lng}" target="_blank" rel="noopener">abrir no OpenStreetMap ↗</a> · <a href="https://www.google.com/maps?q=${r.lat},${r.lng}" target="_blank" rel="noopener">Google Maps ↗</a></p>`;
  }
  function montarMapa(r) {
    if (nulo(r.lat) || nulo(r.lng) || typeof L === "undefined") return;
    const m = L.map("mapa-detalhe", { scrollWheelZoom: false }).setView([r.lat, r.lng], r.geo_precisao === "endereco" ? 16 : 13);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(m);
    const aprox = r.geo_precisao !== "endereco";
    (aprox ? L.circle([r.lat, r.lng], { radius: r.geo_precisao === "bairro" ? 600 : 2500, color: "#777", fillOpacity: .15 }) : L.circleMarker([r.lat, r.lng], { radius: 8, color: "#0b5fff", fillColor: "#0b5fff", fillOpacity: .9 })).addTo(m);
  }

  /* ---------- análise com IA (relatório gerado uma vez e guardado em data/relatorios/<id>.json) ---------- */
  const { markdownParaHtml } = LT;
  function renderRelatorio(rel) {
    return `<div class="relatorio-texto">${markdownParaHtml(rel.markdown || "")}</div>
      <p class="aviso">Parecer automático, gerado por IA a partir do edital, da matrícula e de buscas na web. Pode conter erros. Não é assessoria jurídica nem recomendação de investimento: confira os documentos e consulte um profissional antes de dar lance.</p>`;
  }
  const DESCRICAO_ANALISE = '<p>Parecer para quem vai dar lance: leitura do edital e da matrícula, preço de mercado do bairro, custos no lance, sinais vermelhos, veredito e diligências. Os dados estruturados que a análise encontrar (área, endereço, bairro, quartos…) também passam a preencher esta ficha na coleta seguinte. <a href="exemplo-analise.html" target="_blank" rel="noopener">Veja um exemplo de análise completa ↗</a></p>';

  /* Fluxo: sem conta → formulário de login; com conta → pergunta ao Worker se já tem acesso ao relatório
     (pronto / em andamento / sem acesso). Sem acesso: botão que usa a análise grátis ou 1 crédito; sem
     crédito, link para comprar. Quem pede uma análise nova espera o robô (3 a 6 minutos). */
  async function carregarAnalise(r) {
    const corpo = document.getElementById("analise-corpo");
    const temDoc = !!(r.url_edital || r.url_matricula);
    const semDoc = temDoc ? "" : '<p class="muted">Este imóvel não tem edital nem matrícula em PDF acessíveis; o parecer usa o anúncio e a pesquisa de mercado.</p>';
    if (!LT.urlWorker()) { corpo.innerHTML = '<p class="muted">Análise indisponível nesta instalação.</p>'; return; }
    if (!LT.sessao()) {
      corpo.innerHTML = DESCRICAO_ANALISE + semDoc + '<div id="login-analise"></div>';
      LT.formularioLogin(document.getElementById("login-analise"), { titulo: "<b>Toda conta nova ganha 1 crédito: a primeira análise é grátis.</b> Entre com seu e-mail para gerar ou abrir a análise deste imóvel.", voltarPara: location.href.split("#")[0] + "#analise" });
      return;
    }
    let r1;
    try { r1 = await LT.api(`/relatorio/${encodeURIComponent(r.id)}`); }
    catch (e) { corpo.innerHTML = '<p class="muted">Serviço de análises fora do ar no momento. Tente de novo em alguns minutos.</p>'; return; }
    if (r1.status === 401) { carregarAnalise(r); return; }  // sessão expirada: volta ao login
    if (r1.ok && r1.dados.status === "pronto") { corpo.innerHTML = renderRelatorio(r1.dados.relatorio); return; }
    if (r1.status === 202 && r1.dados.status === "em_andamento") { esperarRelatorio(r, corpo, r1.dados.pedido_em); return; }
    // sem acesso ainda: mostra o que a análise vai custar
    const conta = await LT.api("/conta").catch(() => ({ ok: false, dados: {} }));
    const c = conta.dados || {};
    const custo = c.creditos > 0 ? `<b>1 crédito</b> (você tem ${c.creditos})` : "<b>1 crédito</b> (você não tem créditos)";
    corpo.innerHTML = DESCRICAO_ANALISE + semDoc + `<p>Custo desta análise: ${custo}. Conta: ${escapar(c.email || LT.emailSessao())} · <a href="conta.html">minha conta</a></p>
      <p>${(c.creditos > 0)
        ? '<button type="button" class="btn primario" id="btn-gerar">Gerar análise com IA</button>'
        : '<a class="btn primario" href="conta.html#creditos">Comprar créditos</a> <span class="muted" style="font-size:.8rem">Pix ou cartão, a partir de R$ 14,90</span>'}</p>`;
    const btn = document.getElementById("btn-gerar");
    if (btn) btn.addEventListener("click", async () => {
      btn.disabled = true; btn.textContent = "Pedindo a análise…";
      let r2;
      try { r2 = await LT.api("/analise", { body: { id: r.id } }); }
      catch (e) { btn.disabled = false; btn.textContent = "Tentar de novo"; alert("Sem conexão com o serviço de análises."); return; }
      if (r2.status === 402) { location.href = "conta.html#creditos"; return; }
      if (!r2.ok && r2.status !== 202) { btn.disabled = false; btn.textContent = "Tentar de novo"; alert("Não foi possível pedir a análise agora: " + (r2.dados.erro || `HTTP ${r2.status}`)); return; }
      LT.evento("analise-credito");
      if (r2.dados.status === "pronto") { corpo.innerHTML = renderRelatorio(r2.dados.relatorio); return; }
      if (r2.dados.status === "fila") { corpo.innerHTML = `<p class="aviso">${escapar(r2.dados.mensagem)}</p>`; return; }
      esperarRelatorio(r, corpo, null);
    });
  }
  async function esperarRelatorio(r, corpo, pedidoEm) {
    // o robô gera e grava no Worker: consultamos a cada 20 s (normalmente 3 a 6 minutos)
    const inicio = pedidoEm ? Math.max(Date.parse(pedidoEm) || Date.now(), Date.now() - 9 * 60000) : Date.now();
    corpo.innerHTML = `<p><button type="button" class="btn primario" disabled id="btn-espera">Gerando a análise…</button></p>
      <p class="muted" id="espera-msg">A IA está lendo o edital e a matrícula e pesquisando o mercado. Pode fechar esta página e voltar depois: o resultado fica guardado na sua conta.</p>`;
    const btn = document.getElementById("btn-espera"), msg = document.getElementById("espera-msg");
    while (Date.now() - inicio < 15 * 60 * 1000) {
      const dec = Date.now() - inicio, min = Math.floor(dec / 60000), seg = Math.floor((dec % 60000) / 1000);
      btn.textContent = `Gerando a análise… ${min}:${String(seg).padStart(2, "0")}`;
      await new Promise(res => setTimeout(res, 20000));
      const x = await LT.api(`/relatorio/${encodeURIComponent(r.id)}`).catch(() => null);
      if (x && x.ok && x.dados.status === "pronto") { corpo.innerHTML = renderRelatorio(x.dados.relatorio); return; }
    }
    btn.disabled = false; btn.textContent = "Verificar de novo";
    btn.addEventListener("click", () => carregarAnalise(r));
    msg.textContent = "Está demorando mais que o normal. Clique para verificar ou volte em alguns minutos; a análise aparece aqui quando ficar pronta.";
  }

  function areaRef(r) { return r.tipo === "terreno" ? (r.area_terreno_m2 ?? r.area_privativa_m2) : (r.area_privativa_m2 ?? r.area_terreno_m2); }
  function diasAte(iso) { if (!iso) return null; const d = Math.round((new Date(iso + "T00:00:00") - new Date(LT.hojeIso() + "T00:00:00")) / 86400000); return d; }

  async function iniciar() {
    const id = lerQuery().id;
    const el = document.getElementById("detalhe");
    if (!id) { el.innerHTML = '<p>Informe um imóvel: <code>imovel.html?id=…</code></p>'; return; }
    const ufLink = lerQuery().uf;  // a tabela passa a UF no link: com a base dividida, carrega só esse arquivo
    const [base, historico] = await Promise.all([carregarImoveis(ufLink ? [ufLink] : null), carregarJson("historico.json").catch(() => ({ eventos: [] }))]);
    let r = base.imoveis.find(x => x.id === id);
    if (!r && base.meta.dividido_por_uf) {
      for (const a of base.arquivos) {
        if (base.carregados.has(a)) continue;
        const lista = await carregarJson(a);
        r = lista.find(x => x.id === id);
        if (r) break;
      }
    }
    if (!r) { el.innerHTML = `<p>Imóvel <b>${escapar(id)}</b> não encontrado na base atual. Ele pode ter sido removido há mais de 90 dias.</p><p><a href="./">← voltar à tabela</a></p>`; return; }
    const tipo = cap(r.tipo) === TRACO ? "Imóvel" : cap(r.tipo);
    document.title = `${tipo} em ${r.bairro ? r.bairro + ", " : ""}${r.cidade || ""} · ${moeda(r.valor_minimo)} — Aysha Leilões`;
    const eventos = (historico.eventos || []).filter(e => e.id === id).sort((a, b) => b.data.localeCompare(a.data));
    const dias = diasAte(r.data_leilao);
    const area = areaRef(r);

    let html = `<h2>${escapar(tipo)} em ${escapar([r.bairro, r.cidade].filter(Boolean).join(", ") || TRACO)}${r.uf ? "/" + escapar(r.uf) : ""}</h2>
      <div class="sub">${escapar(r.endereco || "endereço não informado")} · ${escapar(nomeFonte(r.fonte))}${r.leiloeiro ? " · " + escapar(r.leiloeiro) : ""}${r.ativo === false ? ' · <b class="v-nao">não aparece mais na fonte</b>' : ""}</div>`;
    if (r.ativo === false) html += '<div class="aviso">Este imóvel saiu da fonte (vendido, arrematado ou retirado). Fica aqui por até 90 dias para consulta do histórico.</div>';
    html += `<div class="kpis">
      ${kpi("Lance mínimo / preço", moeda(r.valor_minimo), r.modalidade ? escapar(r.modalidade) : "")}
      ${kpi("Avaliação", moeda(r.valor_avaliacao))}
      ${kpi("Desconto", pct(r.desconto_pct), "", nulo(r.desconto_pct) ? "" : (r.desconto_pct >= 0 ? "ok" : "bad"))}
      ${kpi("R$/m²", nulo(r.valor_m2) ? TRACO : numero(r.valor_m2, 0), nulo(area) ? "" : `${numero(area)} m² ${r.tipo === "terreno" ? "de terreno" : "privativos"}`)}
      ${kpi("Leilão", data(r.data_leilao), dias === null ? "" : dias < 0 ? "já passou" : dias === 0 ? "hoje" : `em ${dias} dia${dias > 1 ? "s" : ""}`, dias !== null && dias >= 0 && dias <= 7 ? "bad" : "")}
      ${kpi("Ocupação", LT.ocupado(r.ocupado), r.aceita_fgts === true ? "aceita FGTS" : r.aceita_financiamento === true ? "aceita financiamento" : "")}
    </div>
    <div class="links-principais"><a class="btn primario btn-ia-grande" href="#analise">✦ Análise com IA</a>${link(r.url_anuncio, "Anúncio original")}${link(r.url_edital, "Edital")}${link(r.url_matricula, "Matrícula")}<a class="btn" href="./">← voltar à tabela</a></div>`;
    html += '<div class="grade">';
    html += `<div class="bloco largo relatorio" id="analise"><h3>✦ Análise com IA</h3><div id="analise-corpo"><p class="muted">verificando se já existe um relatório…</p></div></div>`;
    for (const [t, lista] of GRUPOS) html += bloco(t, campos(r, lista));
    html += bloco("Onde fica", mapaHtml(r));
    html += bloco("Outras fontes com o mesmo imóvel", outrasFontesHtml(r));
    if (r.extracao_ia) html += bloco("Extração por IA (com trechos-fonte)", extracaoIaHtml(r.extracao_ia));
    html += bloco("Descrição original (da fonte)", `<div class="descricao">${escapar(r.descricao_original || TRACO)}</div>`, "largo");
    html += bloco("Evolução do lance mínimo", `<div class="grafico">${graficoSvg(r, eventos)}</div>`);
    html += bloco("Histórico na base", eventos.length ? `<ul class="eventos">${eventos.map(eventoHtml).join("")}</ul>` : '<p class="muted">Sem eventos registrados.</p>');
    html += "</div>";
    el.innerHTML = html;
    montarMapa(r);
    carregarAnalise(r).then(() => { if (location.hash === "#analise") document.getElementById("analise").scrollIntoView({ behavior: "smooth" }); });
    const voltar = document.getElementById("voltar");
    if (voltar && document.referrer && document.referrer.includes(location.host) && document.referrer.includes("index")) voltar.href = document.referrer;
  }

  iniciar().catch(err => { console.error(err); document.getElementById("detalhe").innerHTML = `<p>Erro ao carregar: ${escapar(err.message)}</p>`; });
})();
