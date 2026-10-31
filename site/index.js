/* Worker do site (arquivos estáticos de docs/ + rotas dinâmicas).
   Hosts antigos  → 301 para o domínio canônico (workers.dev e www; o GitHub Pages redireciona via JS).
   /api/uf        → UF aproximada do visitante pela geolocalização de rede da Cloudflare (o celular carrega só
                    o estado da pessoa na primeira visita; nada é pedido nem guardado).
   /imovel.html   → a página estática com título, descrição, metas Open Graph, um resumo renderizado no
                    servidor (buscadores e prévia de link leem sem JavaScript; o JS da ficha o substitui) e
                    JSON-LD (RealEstateListing + BreadcrumbList). Lê data/og_<UF>.json (gerado na coleta).
                    O resumo inclui comparação por regra (preço/m² e desconto contra o grupo) e links para
                    fichas vizinhas, cidade e UF. Ficha que não está em og_<UF>.json responde 404 (noindex).
                    Chaves do og_<UF>.json: t tipo, b bairro, c cidade, v lance, d desconto, a área, q quartos,
                    n natureza, e endereço, va avaliação, dl/d2 datas, f foto, o ocupado, s fonte. */
const CANONICO = "https://ayshaleiloes.com.br";
const HOSTS_ANTIGOS = new Set(["aysha.leiloes.workers.dev", "www.ayshaleiloes.com.br"]);
const TIPOS = { apartamento: "Apartamento", casa: "Casa", terreno: "Terreno", comercial: "Imóvel comercial", rural: "Imóvel rural", outro: "Imóvel" };
const ID_OK = /^[A-Za-z0-9][\w.\-]{2,79}$/;

function moeda(v) { return v == null ? "" : "R$ " + Math.round(v).toLocaleString("pt-BR"); }
function dataBr(iso) { return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : null; }
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

function ufDoVisitante(request) {
  const cf = request.cf || {};
  const uf = cf.country === "BR" && /^[A-Z]{2}$/.test(cf.regionCode || "") ? cf.regionCode : null;
  return new Response(JSON.stringify({ uf, pais: cf.country || null }), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

const FONTES = { caixa: "Caixa", jfes: "Justiça Federal", bandes: "Bandes", spu: "SPU", banestes: "Banestes" };
const TIPOS_PLURAL = { apartamento: "apartamentos", casa: "casas", terreno: "terrenos", comercial: "imóveis comerciais", rural: "imóveis rurais", outro: "imóveis" };
const MINIMO_CIDADE = 5;      // igual a collector/paginas.py: cidade com menos imóveis não tem página própria
const MINIMO_AMOSTRA = 5;     // imóveis mínimos para comparar preço/m² e desconto com o grupo
const VIZINHOS = 5;

function fonteRotulo(s) { return FONTES[s] || (String(s || "").startsWith("leiloeiro") ? "leiloeiro oficial" : null); }
/* Mesmo slug de collector/paginas.py (NFKD sem acentos, minúsculas, não alfanumérico vira "-"). */
function slug(s) { return String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x"; }
/* Leilão encerrado: tem data e todas já passaram (mesma regra do gerador de páginas). */
function encerrado(r, hoje) {
  const datas = [r.dl, r.d2].filter(Boolean);
  return datas.length > 0 && datas.reduce((m, d) => (d > m ? d : m)) < hoje;
}
function mediana(v) { const s = [...v].sort((a, b) => a - b), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }
function media(v) { return v.reduce((a, b) => a + b, 0) / v.length; }
function pct(v) { return Math.round(v).toLocaleString("pt-BR") + "%"; }

/* Texto único por regra (sem IA): preço/m² e desconto do imóvel contra o grupo de mesmo tipo, na cidade
   (ou no estado, se a cidade tiver poucos). Devolve [] quando não há amostra suficiente. */
function comparacoes(r, uf, og) {
  const mesmoTipo = Object.values(og).filter((x) => x.t === r.t);
  let grupo = r.c ? mesmoTipo.filter((x) => x.c === r.c) : [];
  let onde = "em " + r.c;
  if (grupo.length < MINIMO_AMOSTRA) { grupo = mesmoTipo; onde = "no estado " + uf; }
  const plural = TIPOS_PLURAL[r.t] || "imóveis";
  const frases = [];
  const m2s = grupo.filter((x) => x.v > 0 && x.a > 0).map((x) => x.v / x.a);
  if (r.v > 0 && r.a > 0 && m2s.length >= MINIMO_AMOSTRA) {
    const m2 = r.v / r.a, med = mediana(m2s), dif = ((m2 - med) / med) * 100;
    const rel = Math.abs(dif) < 5 ? "em linha com a" : `${pct(Math.abs(dif))} ${dif < 0 ? "abaixo da" : "acima da"}`;
    frases.push(`O metro quadrado deste imóvel sai a ${moeda(m2)}, ${rel} mediana dos ${plural} em leilão ${onde} (${moeda(med)}/m², ${m2s.length.toLocaleString("pt-BR")} imóveis com área informada).`);
  }
  const ds = grupo.filter((x) => x.d > 0 && x.d <= 90).map((x) => x.d);
  if (r.d > 0 && r.d <= 90 && ds.length >= MINIMO_AMOSTRA) {
    const med = media(ds), dif = r.d - med, pp = Math.round(Math.abs(dif));
    const rel = Math.abs(dif) < 2 ? "em linha com a" : `${pp} ponto${pp === 1 ? "" : "s"} percentua${pp === 1 ? "l" : "is"} ${dif < 0 ? "abaixo da" : "acima da"}`;
    frases.push(`O desconto de ${pct(r.d)} sobre a avaliação está ${rel} média dos ${plural} em leilão ${onde} (${pct(med)}).`);
  }
  return frases;
}

/* Até VIZINHOS fichas da mesma cidade (ou sem cidade, no estado): anel por id, de modo que toda ficha recebe
   links de outras e as páginas se descobrem entre si. Ignora leilões encerrados. */
function vizinhos(id, r, og, hoje) {
  const ids = Object.keys(og).filter((k) => k === id || ((og[k].c || "") === (r.c || "") && !encerrado(og[k], hoje))).sort();
  const i = ids.indexOf(id), saida = [];
  for (let k = 1; k < ids.length && saida.length < VIZINHOS; k++) saida.push(ids[(i + k) % ids.length]);
  return saida;
}

function ondeDe(r, uf) { return ([r.b, r.c].filter(Boolean).join(", ") + (r.c ? "/" + uf : "")) || uf; }
function urlFicha(id, uf) { return `/imovel.html?id=${encodeURIComponent(id)}&uf=${uf}`; }

/* Resumo visível sem JavaScript (o js/detalhe.js troca o conteúdo de <main id="detalhe"> ao carregar). */
function resumoHtml(r, id, uf, tipo, onde, og, hoje) {
  const linhas = [];
  const fonte = fonteRotulo(r.s);
  if (fonte) linhas.push(["Fonte", fonte]);
  if (r.v != null) linhas.push(["Lance mínimo", moeda(r.v)]);
  if (r.va != null) linhas.push(["Avaliação", moeda(r.va)]);
  if (r.d != null) linhas.push(["Desconto", Math.round(r.d) + "% abaixo da avaliação"]);
  const datas = [dataBr(r.dl), r.d2 ? dataBr(r.d2) + " (2ª praça)" : null].filter(Boolean).join(" e ");
  if (datas) linhas.push(["Leilão", datas + (encerrado(r, hoje) ? " (encerrado)" : "")]);
  if (r.a != null) linhas.push(["Área", Math.round(r.a) + " m²"]);
  if (r.q != null) linhas.push(["Quartos", String(r.q)]);
  if (r.e) linhas.push(["Endereço", r.e]);
  if (r.n) linhas.push(["Natureza", r.n]);
  if (r.o != null) linhas.push(["Ocupação", r.o ? "consta como ocupado" : "consta como desocupado"]);
  const frases = comparacoes(r, uf, og);
  const viz = vizinhos(id, r, og, hoje);
  const nCidade = r.c ? Object.values(og).filter((x) => x.c === r.c).length : 0;
  const linkCidade = nCidade >= MINIMO_CIDADE ? `<a href="/leiloes/${esc(uf)}/${slug(r.c)}.html">Todos os imóveis em leilão em ${esc(r.c)}</a> · ` : "";
  const lista = viz.map((k) => {
    const v = og[k];
    const preco = v.v != null ? " — " + moeda(v.v) + (v.d != null ? ` (${Math.round(v.d)}% abaixo da avaliação)` : "") : "";
    return `<li><a href="${esc(urlFicha(k, uf))}">${esc((TIPOS[v.t] || "Imóvel") + " em " + ondeDe(v, uf))}</a>${esc(preco)}</li>`;
  }).join("");
  return `<h1>${esc(tipo)} em leilão em ${esc(onde)}</h1>
<ul>${linhas.map(([k, v]) => `<li><b>${esc(k)}:</b> ${esc(v)}</li>`).join("")}</ul>
${frases.length ? `<p>${frases.map(esc).join(" ")} Comparação automática por regra, com os dados da última coleta; confira o edital.</p>` : ""}
<p>A ficha completa, com mapa, documentos, histórico de preço e análise com IA, abre neste mesmo endereço em navegadores com JavaScript.</p>
${lista ? `<h2>Outros imóveis em leilão${r.c ? " em " + esc(r.c) : ""}</h2><ul>${lista}</ul>` : ""}
<p>${linkCidade}<a href="/leiloes/${esc(uf)}/">Mais imóveis em leilão em ${esc(uf)}</a> · <a href="/leiloes/">Leilões por estado</a> · <a href="/">tabela com filtros</a></p>
<noscript><p>A ficha completa precisa de JavaScript; os dados acima vêm da última coleta.</p></noscript>`;
}

function jsonLd(r, id, uf, tipo, onde, titulo, descricao, canonico, origem, hoje) {
  const ficha = {
    "@context": "https://schema.org", "@type": "RealEstateListing",
    name: `${tipo} em ${onde}`, url: canonico, description: descricao,
    address: { "@type": "PostalAddress", addressLocality: r.c || undefined, addressRegion: uf, addressCountry: "BR", streetAddress: r.e || undefined },
  };
  if (r.f) ficha.image = r.f;
  if (r.v != null) {
    const enc = encerrado(r, hoje);
    ficha.offers = { "@type": "Offer", price: Math.round(r.v), priceCurrency: "BRL", availability: enc ? "https://schema.org/SoldOut" : "https://schema.org/InStock" };
    const fim = [r.dl, r.d2].filter(Boolean).sort().pop();
    if (fim && !enc) ficha.offers.priceValidUntil = fim;
  }
  if (r.a != null) ficha.floorSize = { "@type": "QuantitativeValue", value: Math.round(r.a), unitCode: "MTK" };
  if (r.q != null) ficha.numberOfRooms = r.q;
  const trilha = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Aysha Leilões", item: origem + "/" },
      { "@type": "ListItem", position: 2, name: "Leilões por estado", item: origem + "/leiloes/" },
      { "@type": "ListItem", position: 3, name: uf, item: `${origem}/leiloes/${uf}/` },
      { "@type": "ListItem", position: 4, name: `${tipo} em ${onde}` },
    ],
  };
  return JSON.stringify([ficha, trilha]).replace(/</g, "\\u003c");
}

/* Title e description da ficha: "leilão" e a fonte (é o que a pessoa digita na busca); description ≤ 158 caracteres. */
function titulos(r, uf, tipo, onde) {
  const fonte = fonteRotulo(r.s);
  const titulo = `${tipo} em leilão em ${onde}${fonte ? " (" + fonte + ")" : ""}${r.v != null ? " por " + moeda(r.v) : ""} — Aysha Leilões`;
  const partes = [];
  if (r.v != null) partes.push(`lance mínimo ${moeda(r.v)}`);
  if (r.d != null) partes.push(`${Math.round(r.d)}% abaixo da avaliação`);
  if (r.dl) partes.push(`leilão em ${dataBr(r.dl)}`);
  if (r.a != null) partes.push(`${Math.round(r.a)} m²`);
  if (r.q != null) partes.push(`${r.q} quarto${r.q > 1 ? "s" : ""}`);
  let descricao = `Leilão de ${tipo.toLowerCase()} em ${onde}${fonte ? " (" + fonte + ")" : ""}`;
  let sep = ": ";
  for (const p of partes) {
    if ((descricao + sep + p + ".").length > 158) break;
    descricao += sep + p;
    sep = ", ";
  }
  descricao += ".";
  if ((descricao + " Ficha, mapa e análise com IA.").length <= 158) descricao += " Ficha, mapa e análise com IA.";
  return { titulo, descricao };
}

/* Ficha inexistente ou removida: o shell da página com status 404 (o JS ainda mostra "removido" a quem tiver o link). */
function naoEncontrada(resp) {
  const h = new Headers(resp.headers);
  h.set("X-Robots-Tag", "noindex");
  h.delete("ETag");
  return new Response(resp.body, { status: 404, headers: h });
}

async function fichaComPrevia(request, env, url) {
  const resp = await env.ASSETS.fetch(request);
  if (!url.searchParams.has("id") && !url.searchParams.has("uf")) return resp;     // /imovel.html sem parâmetros: o shell genérico
  const id = url.searchParams.get("id") || "", uf = url.searchParams.get("uf") || "";
  if (!ID_OK.test(id) || !/^[A-Z]{2}$/.test(uf)) return naoEncontrada(resp);
  try {
    const og = await env.ASSETS.fetch(new Request(new URL(`/data/og_${uf}.json`, url.origin).toString()));
    if (og.status === 404) return naoEncontrada(resp);    // UF sem nenhum imóvel ativo
    if (!og.ok) return resp;                              // falha momentânea: não derruba a ficha
    const mapa = await og.json();
    const r = mapa[id];
    if (!r) return naoEncontrada(resp);
    const hoje = new Date().toISOString().slice(0, 10);
    const tipo = TIPOS[r.t] || "Imóvel";
    const onde = ondeDe(r, uf);
    const { titulo, descricao } = titulos(r, uf, tipo, onde);
    const canonico = `${url.origin}/imovel.html?id=${encodeURIComponent(id)}&uf=${uf}`;
    const ld = jsonLd(r, id, uf, tipo, onde, titulo, descricao, canonico, url.origin, hoje);
    return new HTMLRewriter()
      .on("title", { element(e) { e.setInnerContent(titulo); } })
      .on('meta[property="og:title"], meta[name="twitter:title"]', { element(e) { e.setAttribute("content", titulo); } })
      .on('meta[property="og:description"], meta[name="twitter:description"], meta[name="description"]', { element(e) { e.setAttribute("content", descricao); } })
      .on('meta[property="og:url"]', { element(e) { e.setAttribute("content", canonico); } })
      .on('meta[property="og:image"], meta[name="twitter:image"]', { element(e) { if (r.f) e.setAttribute("content", r.f); } })
      .on('link[rel="canonical"]', { element(e) { e.setAttribute("href", canonico); } })
      .on("head", { element(e) { e.append(`<script type="application/ld+json">${ld}</scr` + `ipt>`, { html: true }); } })
      .on("main#detalhe", { element(e) { e.setInnerContent(resumoHtml(r, id, uf, tipo, onde, mapa, hoje), { html: true }); } })
      .transform(resp);
  } catch (e) {
    return resp;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (HOSTS_ANTIGOS.has(url.hostname)) return Response.redirect(CANONICO + url.pathname + url.search, 301);
    if (url.pathname === "/api/uf") return ufDoVisitante(request);
    if (url.pathname === "/imovel.html") return fichaComPrevia(request, env, url);
    if (url.pathname.endsWith("/")) {  // "/" e "/leiloes/ES/" → index.html da pasta
      url.pathname += "index.html";
      return env.ASSETS.fetch(new Request(url.toString(), request));
    }
    if (/^\/leiloes(\/[A-Z]{2})?$/.test(url.pathname)) {  // "/leiloes/ES" → "/leiloes/ES/"
      url.pathname += "/";
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  },
};
