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
    suporteleiloes: "Leiloeiros (Em Leilão, Buaiz, ES Leilões, Sued Peter)", vixleiloes: "VIX Leilões", colodete: "Colodete Leilões", hdleiloes: "HD Leilões",
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

  /* Contagem de visitas (GoatCounter), só quando configurada. Envia o caminho sem a query string
     (os filtros da busca não saem do navegador); a ficha do imóvel conta como /imovel/<id>, o que
     mostra no painel quais imóveis são mais abertos. Sem cookies e sem identificador persistente. */
  function iniciarContagem() {
    const cfg = global.LT_CONFIG || {};
    const codigo = (cfg.goatcounter || "").trim();
    if (!codigo || /^[a-z0-9-]+$/i.test(codigo) === false) return;
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") return;
    let caminho = location.pathname.replace(/index\.html$/, "");
    if (/imovel\.html$/.test(location.pathname)) {
      const id = new URLSearchParams(location.search).get("id");
      caminho = "/imovel/" + (id ? id.replace(/[^\w.-]/g, "_") : "sem-id");
    }
    global.goatcounter = { path: caminho, no_onload: false, allow_local: false };
    const s = document.createElement("script");
    s.async = true;
    s.src = "https://gc.zgo.at/count.js";
    s.setAttribute("data-goatcounter", `https://${codigo}.goatcounter.com/count`);
    document.head.appendChild(s);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciarContagem);
  else iniciarContagem();

  global.LT = {
    TRACO, nulo, moeda, numero, pct, area, data, dataHora, simNao, ocupado, texto, cap, escapar, semAcentos,
    diasEntre, hojeIso, nomeFonte, SITES_FONTES, ROTULOS, formatarCampo, carregarJson, carregarImoveis, lerQuery, normalizar, CAMPOS,
  };
})(window);
