/* Página Sobre: estado das fontes, editais e campos em branco. */
(function () {
  "use strict";
  const { TRACO, data, dataHora, escapar, nomeFonte, ROTULOS, carregarJson } = LT;

  function mesAtual() { return new Date().toISOString().slice(0, 7); }

  async function iniciar() {
    const cfg = window.LT_CONFIG || {};
    if (cfg.urlApoio) {
      const a = document.getElementById("apoio-link");
      a.href = cfg.urlApoio; a.textContent = cfg.textoApoio || "apoie o projeto";
      document.getElementById("apoio").classList.remove("hidden");
    }
    const [status, meta, editais] = await Promise.all([
      carregarJson("status_fontes.json").catch(() => ({})),
      carregarJson("meta.json").catch(() => null),
      carregarJson("editais.json").catch(() => ({ editais: [] })),
    ]);
    const ed = document.querySelector("#tabela-editais tbody");
    const lista = (editais.editais || []).slice(0, 40);
    ed.innerHTML = lista.length ? lista.map(e => `<tr><td>${escapar(nomeFonte(e.fonte))}</td>
      <td>${e.url ? `<a href="${escapar(e.url)}" rel="noopener" target="_blank">${escapar(e.titulo || e.url)}</a>` : escapar(e.titulo || TRACO)}${e.objeto ? `<div class="muted">${escapar(e.objeto)}</div>` : ""}</td>
      <td>${data(e.publicado_em)}</td><td>${data(e.data_leilao)}</td><td>${data(e.data_segunda_praca)}</td>
      <td>${escapar(e.leiloeiro || "")} ${(e.sites_leiloeiro || (e.site_leiloeiro ? [e.site_leiloeiro] : [])).map(s => `<a href="${escapar(s)}" rel="noopener" target="_blank">${escapar(s.replace(/^https?:\/\/(www\.)?/, ""))}</a>`).join(", ")}</td></tr>`).join("")
      : '<tr><td colspan="6" class="muted">nenhum edital registrado</td></tr>';

    const corpo = document.querySelector("#tabela-fontes tbody");
    const linhas = [];
    for (const [nome, s] of Object.entries(status)) {
      if (nome.startsWith("_")) continue;
      const estado = !s.ativa ? "desativada" : (meta && s.ultima_coleta_ok === meta.data_coleta ? "ok" : "falhou na última coleta");
      const cls = estado === "ok" ? "v-sim" : (estado === "desativada" ? "muted" : "v-nao");
      linhas.push(`<tr><td>${escapar(nomeFonte(nome))}</td><td>${s.site ? `<a href="${escapar(s.site)}" rel="noopener" target="_blank">${escapar(s.site)}</a>` : TRACO}</td>
        <td class="${cls}">${estado}</td><td>${data(s.ultima_coleta_ok)}</td><td>${s.registros ?? TRACO}</td><td class="muted">${escapar(s.ultimo_erro || TRACO)}</td></tr>`);
    }
    corpo.innerHTML = linhas.join("") || '<tr><td colspan="6" class="muted">sem informação</td></tr>';
    if (meta) document.getElementById("coleta-geral").textContent = `Última execução do coletor: ${dataHora(meta.gerado_em)} · ${meta.ativos} imóveis ativos (${Object.entries(meta.por_uf || {}).map(([u, n]) => `${u}: ${n}`).join(", ")}).`;

    const nulos = document.querySelector("#tabela-nulos tbody");
    if (meta && meta.percentual_nulos) {
      nulos.innerHTML = Object.entries(meta.percentual_nulos)
        .filter(([c]) => !["id", "fonte", "url_anuncio", "primeira_vez_visto", "ultima_vez_visto", "ativo", "descricao_original"].includes(c))
        .sort((a, b) => b[1] - a[1])
        .map(([c, p]) => `<tr><td>${escapar(ROTULOS[c] || c)}</td><td class="${p >= 99 ? "v-nao" : p === 0 ? "v-sim" : ""}">${p.toLocaleString("pt-BR")}%</td></tr>`).join("");
    }

  }

  iniciar().catch(err => console.error(err));
})();
