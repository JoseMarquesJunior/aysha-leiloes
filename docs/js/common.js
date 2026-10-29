/* Utilitários compartilhados pelas páginas (sem framework). */
(function (global) {
  "use strict";

  const DADOS = "data/";
  const fmtMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const fmtMoeda2 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
  const fmtNum = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
  const fmtInt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

  const TRACO = "—";

  function nulo(v) { return v === null || v === undefined || v === ""; }
  function moeda(v, centavos) { return nulo(v) ? TRACO : (centavos ? fmtMoeda2 : fmtMoeda).format(v); }
  function numero(v, casas) { return nulo(v) ? TRACO : (casas === 0 ? fmtInt : fmtNum).format(v); }
  function pct(v) { return nulo(v) ? TRACO : fmtNum.format(v) + "%"; }
  function area(v) { return nulo(v) ? TRACO : fmtNum.format(v) + " m²"; }
  function data(iso) {
    if (nulo(iso)) return TRACO;
    const [a, m, d] = String(iso).slice(0, 10).split("-");
    return d && m && a ? `${d}/${m}/${a}` : iso;
  }
  function dataHora(iso) { return nulo(iso) ? TRACO : data(iso) + " " + String(iso).slice(11, 16); }
  function simNao(v) { return v === true ? "Sim" : v === false ? "Não" : TRACO; }
  function ocupado(v) { return v === true ? "Ocupado" : v === false ? "Desocupado" : TRACO; }
  function texto(v) { return nulo(v) ? TRACO : String(v); }
  function cap(s) { return nulo(s) ? TRACO : s.charAt(0).toUpperCase() + s.slice(1); }
  function escapar(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function semAcentos(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function diasEntre(isoA, isoB) {
    const a = new Date(isoA + "T00:00:00"), b = new Date(isoB + "T00:00:00");
    return Math.round((b - a) / 86400000);
  }
  function hojeIso() { return new Date().toISOString().slice(0, 10); }

  const NOMES_FONTES = {
    caixa: "Caixa", banestes: "Banestes", bandes: "Bandes", spu: "SPU (União)", resale: "Resale", jfes: "Justiça Federal (JFES)",
    "leiloeiro-emleilao": "Em Leilão (Ayrton Porto Filho)", "leiloeiro-buaiz": "Buaiz Leilões", "leiloeiro-esleiloes": "ES Leilões (Sérgio de Paula)",
    "leiloeiro-vix": "VIX Leilões (Gabriel Fardin)", "leiloeiro-colodete": "Colodete Leilões (Mauro Colodete)", "leiloeiro-hd": "HD Leilões (Hidirlene Duszeiko)",
    "leiloeiro-suedpeter": "Sued Peter Leilões",
    "leiloeiro-mega": "Mega Leilões (Fernando Cerello)", "leiloeiro-frazao": "Frazão Leilões",
    suporteleiloes: "Leiloeiros (Em Leilão, Buaiz, ES Leilões, Sued Peter)", vixleiloes: "VIX Leilões", colodete: "Colodete Leilões", hdleiloes: "HD Leilões",
    megaleiloes: "Mega Leilões", frazao: "Frazão Leilões",
  };
  function nomeFonte(f) { return NOMES_FONTES[f] || (f ? f.replace(/^leiloeiro-/, "Leiloeiro: ") : TRACO); }

  const SITES_FONTES = {
    caixa: "https://venda-imoveis.caixa.gov.br/",
    banestes: "https://www.banestes.com.br/publicacoes_legais/leilao-bem-imovel.html",
    bandes: "https://www.bandes.com.br/",
    spu: "https://imoveis.vendasgov.serpro.gov.br/",
    jfes: "https://www.trf2.jus.br/jfes/transparencia/listagem",
    resale: "https://www.resale.com.br/",
  };

  // Rótulos de todos os campos do esquema (usados no detalhe, na comparação e no CSV).
  const ROTULOS = {
    id: "ID", fonte: "Fonte", url_anuncio: "Anúncio", url_edital: "Edital", url_matricula: "Matrícula (doc.)",
    leiloeiro: "Leiloeiro", tipo: "Tipo", uf: "UF", cidade: "Cidade", bairro: "Bairro", endereco: "Endereço",
    lat: "Latitude", lng: "Longitude", geo_precisao: "Precisão geográfica",
    area_privativa_m2: "Área privativa", area_terreno_m2: "Área do terreno", area_total_m2: "Área total",
    quartos: "Quartos", vagas: "Vagas", valor_avaliacao: "Valor de avaliação", valor_minimo: "Lance mínimo / preço",
    desconto_pct: "Desconto", valor_m2: "R$/m²", natureza: "Natureza", modalidade: "Modalidade",
    data_leilao: "Data do leilão", data_segunda_praca: "2ª praça", ocupado: "Ocupação",
    aceita_financiamento: "Aceita financiamento", aceita_fgts: "Aceita FGTS", aceita_parcelamento: "Aceita parcelamento",
    debitos_iptu_por_conta_de: "Débitos de IPTU por conta de", debitos_condominio_por_conta_de: "Débitos de condomínio por conta de",
    comissao_leiloeiro_pct: "Comissão do leiloeiro", matricula: "Nº da matrícula", numero_processo: "Nº do processo", comitente: "Comitente (quem vende)",
    descricao_original: "Descrição original", url_foto: "Foto", primeira_vez_visto: "Visto pela 1ª vez",
    ultima_vez_visto: "Visto pela última vez", ativo: "Ativo", outras_fontes: "Outras fontes", extracao_ia: "Extração por IA",
    onus_na_matricula: "Ônus na matrícula", alertas: "Alertas",
  };

  function formatarCampo(campo, v) {
    switch (campo) {
      case "valor_avaliacao": case "valor_minimo": return moeda(v);
      case "valor_m2": return nulo(v) ? TRACO : fmtInt.format(v);
      case "desconto_pct": case "comissao_leiloeiro_pct": return pct(v);
      case "area_privativa_m2": case "area_terreno_m2": case "area_total_m2": return area(v);
      case "data_leilao": case "data_segunda_praca": case "primeira_vez_visto": case "ultima_vez_visto": return data(v);
      case "ocupado": return ocupado(v);
      case "aceita_financiamento": case "aceita_fgts": case "aceita_parcelamento": case "ativo": return simNao(v);
      case "fonte": return nomeFonte(v);
      case "geo_precisao": return v === "endereco" ? "Endereço" : cap(v);
      case "tipo": case "natureza": case "debitos_iptu_por_conta_de": case "debitos_condominio_por_conta_de": return cap(v);
      case "lat": case "lng": return nulo(v) ? TRACO : v.toFixed(5);
      default: return texto(v);
    }
  }

  async function carregarJson(nome) {
    const r = await fetch(DADOS + nome, { cache: "no-cache" });
    if (!r.ok) throw new Error(`falha ao carregar ${nome}: HTTP ${r.status}`);
    return r.json();
  }

  /* Carrega meta.json e os arquivos de imóveis. Com a base dividida por UF, carrega só as UFs pedidas
     (`ufs`) ou, sem pedido, as UFs padrão de meta.ufs_padrao; as outras ficam para carga sob demanda.
     Devolve {meta, imoveis, carregados:Set, arquivos}. */
  async function carregarImoveis(ufs) {
    const meta = await carregarJson("meta.json");
    const arquivos = meta.arquivos || ["imoveis.json"];
    let escolhidos = arquivos;
    if (meta.dividido_por_uf) {
      const pedidas = (ufs && ufs.length) ? ufs : (meta.ufs_padrao || []);
      const filtrados = arquivos.filter(a => pedidas.some(u => a === `imoveis_${u}.json`));
      if (filtrados.length) escolhidos = filtrados;
    }
    const listas = await Promise.all(escolhidos.map(carregarJson));
    const imoveis = listas.flat();
    for (const r of imoveis) normalizar(r);
    return { meta, imoveis, carregados: new Set(escolhidos), arquivos };
  }

  /* Os arquivos são gravados sem os campos null (economia de ~40 %); aqui todo registro volta a ter
     todos os campos do esquema, para o resto do código tratar "ausente" e "null" do mesmo jeito. */
  const CAMPOS = ["id", "fonte", "url_anuncio", "url_edital", "url_matricula", "leiloeiro", "tipo", "uf", "cidade", "bairro", "endereco",
    "lat", "lng", "geo_precisao", "area_privativa_m2", "area_terreno_m2", "area_total_m2", "quartos", "vagas", "valor_avaliacao",
    "valor_minimo", "desconto_pct", "valor_m2", "natureza", "modalidade", "data_leilao", "data_segunda_praca", "ocupado",
    "aceita_financiamento", "aceita_fgts", "aceita_parcelamento", "debitos_iptu_por_conta_de", "debitos_condominio_por_conta_de",
    "comissao_leiloeiro_pct", "matricula", "numero_processo", "comitente", "descricao_original", "url_foto", "primeira_vez_visto",
    "ultima_vez_visto", "ativo", "outras_fontes", "extracao_ia"];
  function normalizar(r) {
    for (const c of CAMPOS) if (!(c in r)) r[c] = c === "outras_fontes" ? [] : null;
    if (r.ativo === null) r.ativo = true;
    return r;
  }

  function lerQuery() {
    const p = new URLSearchParams(location.search);
    const o = {};
    for (const [k, v] of p.entries()) o[k] = v;
    return o;
  }

  /* Contagem de visitas (Umami), só quando configurada. O rastreio automático fica desligado e a página
     é contada manualmente com o caminho sem a query string (os filtros da busca não saem do navegador);
     a ficha do imóvel conta como /imovel/<id>, o que mostra no painel quais imóveis são mais abertos.
     Sem cookies e sem identificador persistente. */
  function caminhoContagem() {
    let caminho = location.pathname.replace(/^\/aysha-leiloes/, "").replace(/index\.html$/, "") || "/";
    if (/imovel\.html$/.test(location.pathname)) {
      const id = new URLSearchParams(location.search).get("id");
      caminho = "/imovel/" + (id ? id.replace(/[^\w.-]/g, "_") : "sem-id");
    }
    return caminho;
  }
  function iniciarContagem() {
    const cfg = global.LT_CONFIG || {};
    const id = (cfg.umami || "").trim();
    if (/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) === false) return;
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") return;
    const s = document.createElement("script");
    s.defer = true;
    s.src = "https://cloud.umami.is/script.js";
    s.setAttribute("data-website-id", id);
    s.setAttribute("data-auto-track", "false");
    s.onload = () => {
      try { global.umami.track((p) => ({ ...p, url: caminhoContagem() })); } catch (e) { /* bloqueador */ }
      enviarEventos();
    };
    document.head.appendChild(s);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciarContagem);
  else iniciarContagem();

  /* Markdown (subconjunto: títulos, parágrafos, listas, tabelas, negrito, itálico, código, links) → HTML seguro. */
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

  /* Endereço antigo (GitHub Pages) → endereço atual, preservando caminho, query e fragmento. */
  (function redirecionarSeAntigo() {
    const alvo = ((global.LT_CONFIG || {}).urlSite || "").replace(/\/$/, "");
    if (!alvo || !/\.github\.io$/.test(location.hostname)) return;
    const caminho = location.pathname.replace(/^\/aysha-leiloes/, "");
    location.replace(alvo + caminho + location.search + location.hash);
  })();

  /* Eventos do funil (Umami): visitante → conta criada → análise pedida → compra paga. Cada evento aparece
     por nome no painel (conta-nova, analise-credito, compra-paga...). Sem dados pessoais: só o nome do
     evento e o caminho sem a query string. O script carrega assíncrono; antes disso os eventos esperam. */
  const filaEventos = [];
  function evento(nome) {
    const cfg = global.LT_CONFIG || {};
    if (!cfg.umami) return;
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") return;
    filaEventos.push(nome);
    enviarEventos();
  }
  function enviarEventos() {
    const u = global.umami;
    if (!u || typeof u.track !== "function") { if (filaEventos.length) setTimeout(enviarEventos, 1000); return; }
    while (filaEventos.length) {
      const nome = filaEventos.shift();
      try { u.track((p) => ({ ...p, url: caminhoContagem(), name: nome })); } catch (e) { /* bloqueador */ }
    }
  }

  /* Conta (link mágico) e chamadas ao Worker. A sessão é um token portador guardado no navegador. */
  const CHAVE_SESSAO = "lt.sessao", CHAVE_EMAIL = "lt.email", CHAVE_VOLTAR = "lt.voltar";
  function urlWorker() { return ((global.LT_CONFIG || {}).urlWorker || "").replace(/\/$/, ""); }
  function sessao() { try { return localStorage.getItem(CHAVE_SESSAO) || ""; } catch (e) { return ""; } }
  function emailSessao() { try { return localStorage.getItem(CHAVE_EMAIL) || ""; } catch (e) { return ""; } }
  function guardarSessao(token, email) { try { localStorage.setItem(CHAVE_SESSAO, token); localStorage.setItem(CHAVE_EMAIL, email || ""); } catch (e) { /* sem storage */ } }
  function limparSessao() { try { localStorage.removeItem(CHAVE_SESSAO); localStorage.removeItem(CHAVE_EMAIL); } catch (e) { /* sem storage */ } }
  function guardarVoltar(url) { try { localStorage.setItem(CHAVE_VOLTAR, url || ""); } catch (e) { /* sem storage */ } }
  function lerVoltar() { try { const v = localStorage.getItem(CHAVE_VOLTAR) || ""; localStorage.removeItem(CHAVE_VOLTAR); return v; } catch (e) { return ""; } }
  /* api("/conta") → {ok, status, dados}; nunca lança por HTTP (só por rede). 401 limpa a sessão. */
  async function api(caminho, opcoes) {
    const o = opcoes || {};
    const headers = { "Content-Type": "application/json" };
    const t = sessao();
    if (t) headers.Authorization = "Bearer " + t;
    const resp = await fetch(urlWorker() + caminho, { method: o.method || (o.body ? "POST" : "GET"), headers, body: o.body ? JSON.stringify(o.body) : undefined });
    const dados = await resp.json().catch(() => ({}));
    if (resp.status === 401 && t) limparSessao();
    return { ok: resp.ok, status: resp.status, dados };
  }
  /* Formulário de login (e-mail → link mágico) renderizado dentro de `el`; `voltarPara` é a URL para onde
     o link do e-mail devolve a pessoa depois de entrar. */
  function formularioLogin(el, opcoes) {
    const o = opcoes || {};
    el.innerHTML = `<form class="login" autocomplete="on">
      ${o.titulo ? `<p>${o.titulo}</p>` : ""}
      <label>Seu e-mail <input type="email" name="email" required placeholder="voce@exemplo.com" value="${escapar(emailSessao())}"></label>
      <button type="submit" class="btn primario">Receber link de acesso</button>
      <p class="muted" style="font-size:.8rem;margin:6px 0 0">Sem senha: enviamos um link por e-mail que vale 20 minutos. Ao continuar você aceita os <a href="sobre.html#contas">termos de uso</a>.</p>
      <p class="login-msg" aria-live="polite"></p></form>`;
    const form = el.querySelector("form"), msg = el.querySelector(".login-msg"), btn = el.querySelector("button");
    form.addEventListener("submit", async ev => {
      ev.preventDefault();
      const email = form.email.value.trim().toLowerCase();
      btn.disabled = true; msg.textContent = "Enviando…";
      guardarVoltar(o.voltarPara || location.href);
      const r = await api("/auth/pedir", { body: { email } }).catch(() => ({ ok: false, dados: { erro: "sem conexão com o serviço" } }));
      if (r.ok) {
        evento("login-pedido");
        msg.innerHTML = `<b>Link enviado para ${escapar(email)}.</b> Abra o e-mail e clique no link para continuar (confira o spam).`;
        form.querySelector("label").classList.add("hidden"); btn.classList.add("hidden");
      } else { btn.disabled = false; msg.textContent = "Não deu certo: " + (r.dados.erro || "tente de novo"); }
    });
  }

  global.LT = {
    TRACO, nulo, moeda, numero, pct, area, data, dataHora, simNao, ocupado, texto, cap, escapar, semAcentos,
    diasEntre, hojeIso, nomeFonte, SITES_FONTES, ROTULOS, formatarCampo, carregarJson, carregarImoveis, lerQuery, normalizar, CAMPOS,
    evento, urlWorker, sessao, emailSessao, guardarSessao, limparSessao, guardarVoltar, lerVoltar, api, formularioLogin, markdownParaHtml,
  };
})(window);
