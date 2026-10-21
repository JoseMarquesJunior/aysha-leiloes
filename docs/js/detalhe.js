/* Página de detalhe de um imóvel: todos os campos, outras fontes, extração IA, histórico e gráfico. */
(function () {
  "use strict";
  const { TRACO, nulo, moeda, data, dataHora, cap, escapar, nomeFonte, ROTULOS, formatarCampo, carregarJson, carregarImoveis, lerQuery } = LT;

  const GRUPOS = [
    ["Identificação", ["id", "fonte", "leiloeiro", "natureza", "modalidade", "data_leilao", "data_segunda_praca", "primeira_vez_visto", "ultima_vez_visto", "ativo"]],
    ["Localização", ["uf", "cidade", "bairro", "endereco", "lat", "lng", "geo_precisao"]],
    ["Imóvel", ["tipo", "area_privativa_m2", "area_terreno_m2", "area_total_m2", "quartos", "vagas", "matricula", "numero_processo"]],
    ["Valores", ["valor_avaliacao", "valor_minimo", "desconto_pct", "valor_m2", "comissao_leiloeiro_pct"]],
    ["Condições", ["ocupado", "aceita_financiamento", "aceita_fgts", "aceita_parcelamento", "debitos_iptu_por_conta_de", "debitos_condominio_por_conta_de"]],
  ];

  function bloco(titulo, html) { return `<div class="bloco"><h3>${escapar(titulo)}</h3>${html}</div>`; }
  function campos(r, lista) {
    return `<dl class="campos">${lista.map(c => `<dt>${escapar(ROTULOS[c] || c)}</dt><dd>${escapar(formatarCampo(c, r[c]))}</dd>`).join("")}</dl>`;
  }
  function link(url, rotulo) { return url ? `<a href="${escapar(url)}" target="_blank" rel="noopener">${escapar(rotulo)} ↗</a>` : `<span class="muted">${escapar(rotulo)}: ${TRACO}</span>`; }

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
      if (e.tipo === "novo" && e.para !== null) pontos.push([e.data, e.para]);
      if (e.tipo === "mudou_preco" && e.para !== null) pontos.push([e.data, e.para]);
    }
    if (!pontos.length && r.valor_minimo !== null) pontos.push([r.primeira_vez_visto || r.ultima_vez_visto, r.valor_minimo]);
    if (r.valor_minimo !== null && r.ultima_vez_visto && pontos[pontos.length - 1][0] !== r.ultima_vez_visto) pontos.push([r.ultima_vez_visto, r.valor_minimo]);
    pontos.sort((a, b) => a[0].localeCompare(b[0]));
    if (pontos.length < 1) return '<p class="muted">Sem dados de evolução.</p>';
    const W = 600, H = 160, mL = 70, mR = 10, mT = 12, mB = 24;
    const xs = pontos.map(p => new Date(p[0] + "T00:00:00").getTime());
    const ys = pontos.map(p => p[1]);
    let x0 = Math.min(...xs), x1 = Math.max(...xs);
    if (x1 === x0) { x0 -= 86400000 * 7; x1 += 86400000 * 7; }
    let y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (y1 === y0) { y0 *= 0.9; y1 *= 1.1; }
    const X = t => mL + (t - x0) / (x1 - x0) * (W - mL - mR);
    const Y = v => mT + (1 - (v - y0) / (y1 - y0)) * (H - mT - mB);
    // degraus: o valor vale até o próximo evento
    let d = "";
    pontos.forEach((p, i) => {
      const x = X(xs[i]), y = Y(p[1]);
      d += i === 0 ? `M${x},${y}` : `H${x}V${y}`;
    });
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
    if (!ia) return '<p class="muted">Sem extração por IA para este imóvel (etapa desligada ou imóvel fora do filtro).</p>';
    const linhas = [];
    for (const [k, v] of Object.entries(ia)) {
      if (k === "trechos_fonte" || k === "modelo" || k === "processado_em" || k === "hash_documento") continue;
      const trecho = ia.trechos_fonte && ia.trechos_fonte[k];
      const valor = Array.isArray(v) ? (v.length ? v.join(", ") : TRACO) : formatarCampo(k, v);
      linhas.push(`<dt>${escapar(ROTULOS[k] || k)}</dt><dd>${escapar(valor)}${trecho ? `<div class="ia-trecho">“${escapar(trecho)}”</div>` : ""}</dd>`);
    }
    return `<dl class="campos">${linhas.join("")}</dl><p class="muted" style="font-size:.78rem">Modelo: ${escapar(ia.modelo || TRACO)} · ${dataHora(ia.processado_em)}. Apoio à leitura; confira no edital.</p>`;
  }

  async function iniciar() {
    const id = lerQuery().id;
    const el = document.getElementById("detalhe");
    if (!id) { el.innerHTML = '<p>Informe um imóvel: <code>imovel.html?id=…</code></p>'; return; }
    const ufDoId = null;
    const [base, historico] = await Promise.all([carregarImoveis(ufDoId), carregarJson("historico.json").catch(() => ({ eventos: [] }))]);
    let r = base.imoveis.find(x => x.id === id);
    if (!r && base.meta.dividido_por_uf) {
      // base dividida: procura o id em cada arquivo ainda não carregado
      for (const a of base.arquivos) {
        if (base.carregados.has(a)) continue;
        const lista = await carregarJson(a);
        r = lista.find(x => x.id === id);
        if (r) break;
      }
    }
    if (!r) { el.innerHTML = `<p>Imóvel <b>${escapar(id)}</b> não encontrado na base atual. Ele pode ter sido removido há mais de 90 dias.</p>`; return; }
    document.title = `${cap(r.tipo)} em ${r.bairro || ""} ${r.cidade || ""} — Leilões em Tabela`;
    const eventos = (historico.eventos || []).filter(e => e.id === id).sort((a, b) => b.data.localeCompare(a.data));

    let html = `<h2>${escapar(cap(r.tipo))} · ${escapar(r.bairro || TRACO)}, ${escapar(r.cidade || TRACO)}/${escapar(r.uf || "")} · ${moeda(r.valor_minimo)}
        <span class="${(r.desconto_pct ?? 0) >= 0 ? "desc-pos" : "desc-neg"}" style="font-size:.9rem">${formatarCampo("desconto_pct", r.desconto_pct)}</span></h2>
      <div class="sub">${escapar(r.endereco || TRACO)} · ${escapar(r.modalidade || TRACO)} · ${escapar(nomeFonte(r.fonte))}${r.ativo === false ? ' · <b class="v-nao">não aparece mais na fonte</b>' : ""}</div>
      <p>${link(r.url_anuncio, "Anúncio original")} · ${link(r.url_edital, "Edital")} · ${link(r.url_matricula, "Matrícula")}</p>`;
    if (r.ativo === false) html += '<div class="aviso">Este imóvel saiu da fonte (vendido, arrematado ou retirado). Fica aqui por até 90 dias para consulta do histórico.</div>';
    html += '<div class="grade">';
    for (const [t, lista] of GRUPOS) html += bloco(t, campos(r, lista));
    html += bloco("Outras fontes onde aparece", r.outras_fontes && r.outras_fontes.length
      ? `<ul class="eventos">${r.outras_fontes.map(o => `<li>${escapar(nomeFonte(o.fonte))}${o.leiloeiro ? " (" + escapar(o.leiloeiro) + ")" : ""} · ${moeda(o.valor_minimo)} · ${escapar(o.modalidade || TRACO)} · ${link(o.url_anuncio, o.id || "anúncio")}</li>`).join("")}</ul>`
      : '<p class="muted">Nenhuma outra fonte com o mesmo imóvel (endereço + área ou matrícula).</p>');
    html += bloco("Extração por IA (com trechos-fonte)", extracaoIaHtml(r.extracao_ia));
    html += "</div>";
    html += `<div class="grade" style="margin-top:12px">${bloco("Descrição original (da fonte)", `<div class="descricao">${escapar(r.descricao_original || TRACO)}</div>`)}
      ${bloco("Evolução do lance mínimo", `<div class="grafico">${graficoSvg(r, eventos)}</div>`)}
      ${bloco("Histórico de eventos", eventos.length ? `<ul class="eventos">${eventos.map(eventoHtml).join("")}</ul>` : '<p class="muted">Sem eventos registrados.</p>')}</div>`;
    el.innerHTML = html;
    if (document.referrer && document.referrer.includes(location.host)) document.getElementById("voltar").href = document.referrer;
  }

  iniciar().catch(err => { console.error(err); document.getElementById("detalhe").innerHTML = `<p>Erro ao carregar: ${escapar(err.message)}</p>`; });
})();
