/* Worker do site (arquivos estáticos de docs/ + rotas dinâmicas).
   Hosts antigos  → 301 para o domínio canônico (workers.dev e www; o GitHub Pages redireciona via JS).
   /api/uf        → UF aproximada do visitante pela geolocalização de rede da Cloudflare (o celular carrega só
                    o estado da pessoa na primeira visita; nada é pedido nem guardado).
   /imovel.html   → a página estática com título, descrição, metas Open Graph, um resumo renderizado no
                    servidor (buscadores e prévia de link leem sem JavaScript; o JS da ficha o substitui) e
                    JSON-LD (RealEstateListing + BreadcrumbList). Lê data/og_<UF>.json (gerado na coleta). */
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

/* Resumo visível sem JavaScript (o js/detalhe.js troca o conteúdo de <main id="detalhe"> ao carregar). */
function resumoHtml(r, id, uf, tipo, onde) {
  const linhas = [];
  if (r.v != null) linhas.push(["Lance mínimo", moeda(r.v)]);
  if (r.va != null) linhas.push(["Avaliação", moeda(r.va)]);
  if (r.d != null) linhas.push(["Desconto", Math.round(r.d) + "% abaixo da avaliação"]);
  const datas = [dataBr(r.dl), r.d2 ? dataBr(r.d2) + " (2ª praça)" : null].filter(Boolean).join(" e ");
  if (datas) linhas.push(["Leilão", datas]);
  if (r.a != null) linhas.push(["Área", Math.round(r.a) + " m²"]);
  if (r.q != null) linhas.push(["Quartos", String(r.q)]);
  if (r.e) linhas.push(["Endereço", r.e]);
  if (r.n) linhas.push(["Natureza", r.n]);
  if (r.o != null) linhas.push(["Ocupação", r.o ? "consta como ocupado" : "consta como desocupado"]);
  return `<h2>${esc(tipo)} em ${esc(onde)}</h2>
<ul>${linhas.map(([k, v]) => `<li><b>${esc(k)}:</b> ${esc(v)}</li>`).join("")}</ul>
<p>Ficha completa com mapa, documentos, histórico de preço e análise com IA — carregando…</p>
<p><a href="/leiloes/${esc(uf)}/">Mais imóveis em leilão em ${esc(uf)}</a> · <a href="/">tabela com filtros</a></p>
<noscript><p>A ficha completa precisa de JavaScript; os dados acima vêm da última coleta.</p></noscript>`;
}

function jsonLd(r, id, uf, tipo, onde, titulo, descricao, canonico, origem) {
  const ficha = {
    "@context": "https://schema.org", "@type": "RealEstateListing",
    name: `${tipo} em ${onde}`, url: canonico, description: descricao,
    address: { "@type": "PostalAddress", addressLocality: r.c || undefined, addressRegion: uf, addressCountry: "BR", streetAddress: r.e || undefined },
  };
  if (r.f) ficha.image = r.f;
  if (r.v != null) ficha.offers = { "@type": "Offer", price: Math.round(r.v), priceCurrency: "BRL", availability: "https://schema.org/InStock" };
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

async function fichaComPrevia(request, env, url) {
  const resp = await env.ASSETS.fetch(request);
  const id = url.searchParams.get("id") || "", uf = url.searchParams.get("uf") || "";
  if (!ID_OK.test(id) || !/^[A-Z]{2}$/.test(uf)) return resp;
  try {
    const og = await env.ASSETS.fetch(new Request(new URL(`/data/og_${uf}.json`, url.origin).toString()));
    if (!og.ok) return resp;
    const r = (await og.json())[id];
    if (!r) return resp;
    const tipo = TIPOS[r.t] || "Imóvel";
    const onde = [r.b, r.c].filter(Boolean).join(", ") + (r.c ? "/" + uf : "");
    const titulo = `${tipo} em ${onde}${r.v != null ? " por " + moeda(r.v) : ""} — Aysha Leilões`;
    const partes = [];
    if (r.v != null) partes.push(`Lance mínimo ${moeda(r.v)}`);
    if (r.d != null) partes.push(`${Math.round(r.d)}% abaixo da avaliação`);
    if (r.dl) partes.push(`leilão em ${dataBr(r.dl)}`);
    if (r.a != null) partes.push(`${Math.round(r.a)} m²`);
    if (r.q != null) partes.push(`${r.q} quarto${r.q > 1 ? "s" : ""}`);
    if (r.n) partes.push(r.n);
    const descricao = partes.join(" · ") + ". Ficha completa, histórico de preço, mapa e análise com IA.";
    const canonico = `${url.origin}/imovel.html?id=${encodeURIComponent(id)}&uf=${uf}`;
    const ld = jsonLd(r, id, uf, tipo, onde, titulo, descricao, canonico, url.origin);
    return new HTMLRewriter()
      .on("title", { element(e) { e.setInnerContent(titulo); } })
      .on('meta[property="og:title"], meta[name="twitter:title"]', { element(e) { e.setAttribute("content", titulo); } })
      .on('meta[property="og:description"], meta[name="twitter:description"], meta[name="description"]', { element(e) { e.setAttribute("content", descricao); } })
      .on('meta[property="og:url"]', { element(e) { e.setAttribute("content", canonico); } })
      .on('meta[property="og:image"], meta[name="twitter:image"]', { element(e) { if (r.f) e.setAttribute("content", r.f); } })
      .on('link[rel="canonical"]', { element(e) { e.setAttribute("href", canonico); } })
      .on("head", { element(e) { e.append(`<script type="application/ld+json">${ld}</scr` + `ipt>`, { html: true }); } })
      .on("main#detalhe", { element(e) { e.setInnerContent(resumoHtml(r, id, uf, tipo, onde), { html: true }); } })
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
