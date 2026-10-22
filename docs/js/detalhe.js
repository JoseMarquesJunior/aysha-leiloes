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
  function nomeArquivo(id) { return id.replace(/[^\w.\-]/g, "_"); }
  function mdInline(s) {
    s = escapar(s);
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<i>$2</i>").replace(/`([^`]+)`/g, "<code>$1</code>");
    return s;
  }
  function markdownParaHtml(md) {
    const linhas = md.replace(/\r/g, "").split("\n");
    const out = [];
    let lista = null, tabela = null, par = [];
    const fecharPar = () => { if (par.length) { out.push(`<p>${par.map(mdInline).join(" ")}</p>`); par = []; } };
    const fecharLista = () => { if (lista) { out.push(`</${lista}>`); lista = null; } };
    const fecharTabela = () => {
      if (!tabela) return;
      const [cab, ...corpo] = tabela;
      out.push("<table><thead><tr>" + cab.map(c => `<th>${mdInline(c)}</th>`).join("") + "</tr></thead><tbody>" +
        corpo.map(l => "<tr>" + l.map(c => `<td>${mdInline(c)}</td>`).join("") + "</tr>").join("") + "</tbody></table>");
      tabela = null;
    };
    for (const raw of linhas) {
      const l = raw.trimEnd();
      if (/^\s*\|.*\|\s*$/.test(l)) {
        fecharPar(); fecharLista();
        const celulas = l.trim().slice(1, -1).split("|").map(c => c.trim());
        if (celulas.every(c => /^:?-{2,}:?$/.test(c))) continue;  // linha separadora
        (tabela = tabela || []).push(celulas);
        continue;
      }
      fecharTabela();
      let m;
      if ((m = l.match(/^(#{1,4})\s+(.*)/))) { fecharPar(); fecharLista(); out.push(`<h${m[1].length + 2}>${mdInline(m[2])}</h${m[1].length + 2}>`); continue; }
      if ((m = l.match(/^\s*[-*]\s+(.*)/))) { fecharPar(); if (lista !== "ul") { fecharLista(); out.push("<ul>"); lista = "ul"; } out.push(`<li>${mdInline(m[1])}</li>`); continue; }
      if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { fecharPar(); if (lista !== "ol") { fecharLista(); out.push("<ol>"); lista = "ol"; } out.push(`<li>${mdInline(m[1])}</li>`); continue; }
      if (!l.trim()) { fecharPar(); fecharLista(); continue; }
      par.push(l.trim());
    }
    fecharPar(); fecharLista(); fecharTabela();
    return out.join("\n");
  }
  function renderRelatorio(rel) {
    const uso = rel.uso || {};
    return `<div class="relatorio-meta muted">Gerado em ${dataHora(rel.gerado_em)} · modelo ${escapar(rel.modelo || "")} · ${rel.documentos_lidos || 0} documento(s) lido(s) · ${uso.buscas || 0} busca(s) na web · custo US$ ${(rel.custo_usd || 0).toFixed(3)}. Relatório gerado uma vez e guardado; não é refeito a cada clique.</div>
      <div class="relatorio-texto">${markdownParaHtml(rel.markdown || "")}</div>
      <p class="aviso">Parecer automático, gerado por IA a partir do edital, da matrícula e de buscas na web. Pode conter erros. Não é assessoria jurídica nem recomendação de investimento: confira os documentos e consulte um profissional antes de dar lance.</p>`;
  }
  async function carregarAnalise(r) {
    const corpo = document.getElementById("analise-corpo");
    const cfg = window.LT_CONFIG || {};
    try {
      const rel = await carregarJson(`relatorios/${nomeArquivo(r.id)}.json`);
      corpo.innerHTML = renderRelatorio(rel);
      return;
    } catch (e) { /* ainda não existe */ }
    const temDoc = !!(r.url_edital || r.url_matricula);
    const titulo = `Analisar ${r.id}`;
    const corpoIssue = `Pedido de análise com IA do imóvel ${r.id}\n\nFicha: ${location.origin}${location.pathname}?id=${encodeURIComponent(r.id)}\nAnúncio: ${r.url_anuncio || ""}\n\n(Não edite o título: o robô lê o id dele.)`;
    const urlIssue = cfg.repositorioIssues ? `${cfg.repositorioIssues}?title=${encodeURIComponent(titulo)}&body=${encodeURIComponent(corpoIssue)}` : null;
    corpo.innerHTML = `
      <p>Ainda não há relatório para este imóvel. A análise lê o edital, a matrícula e o laudo inteiros, pesquisa o preço de mercado do bairro e escreve um parecer com custos no lance, sinais vermelhos, veredito e diligências. Leva de 2 a 4 minutos e fica guardada: quem abrir esta ficha depois vê o mesmo relatório sem nova análise.</p>
      ${temDoc ? "" : '<p class="muted">Atenção: este imóvel não tem edital nem matrícula em PDF acessíveis; o parecer sairá só do anúncio e da pesquisa de mercado.</p>'}
      <p>${cfg.urlAnaliseWorker ? `<button type="button" class="btn primario" id="btn-gerar">Gerar análise com IA</button>` : ""}
         ${urlIssue ? `<a class="btn ${cfg.urlAnaliseWorker ? "" : "primario"}" href="${escapar(urlIssue)}" target="_blank" rel="noopener">Solicitar análise com IA (via GitHub)</a>` : ""}
         <span class="muted" style="font-size:.8rem">${cfg.urlAnaliseWorker ? "" : "Abre um pedido no GitHub (precisa de conta gratuita); o robô gera o relatório e ele aparece aqui em alguns minutos."}</span></p>`;
    const btn = document.getElementById("btn-gerar");
    if (btn) btn.addEventListener("click", async () => {
      btn.disabled = true; btn.textContent = "Gerando (até 4 minutos)…";
      try {
        const resp = await fetch(cfg.urlAnaliseWorker, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id }) });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        corpo.innerHTML = renderRelatorio(await resp.json());
      } catch (e) { btn.disabled = false; btn.textContent = "Tentar de novo"; alert("Não foi possível gerar agora: " + e.message); }
    });
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
    <div class="links-principais">${link(r.url_anuncio, "Anúncio original", "primario")}${link(r.url_edital, "Edital")}${link(r.url_matricula, "Matrícula")}<a class="btn" href="./">← voltar à tabela</a></div>`;
    html += '<div class="grade">';
    for (const [t, lista] of GRUPOS) html += bloco(t, campos(r, lista));
    html += bloco("Onde fica", mapaHtml(r));
    html += bloco("Outras fontes com o mesmo imóvel", outrasFontesHtml(r));
    if (r.extracao_ia) html += bloco("Extração por IA (com trechos-fonte)", extracaoIaHtml(r.extracao_ia));
    html += `<div class="bloco largo relatorio" id="analise"><h3>Análise com IA</h3><div id="analise-corpo"><p class="muted">verificando se já existe um relatório…</p></div></div>`;
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
