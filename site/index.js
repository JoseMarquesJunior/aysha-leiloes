/* Worker do site (arquivos estáticos de docs/ + duas rotas dinâmicas).
   /api/uf       → UF aproximada do visitante pela geolocalização de rede da Cloudflare (o celular carrega só
                   o estado da pessoa na primeira visita; nada é pedido nem guardado).
   /imovel.html  → a página estática com título, descrição e metas Open Graph do imóvel pedido, para o link
                   colado no WhatsApp mostrar o que é. Lê data/og_<UF>.json (gerado na coleta). */
const TIPOS = { apartamento: "Apartamento", casa: "Casa", terreno: "Terreno", comercial: "Imóvel comercial", rural: "Imóvel rural", outro: "Imóvel" };
const ID_OK = /^[A-Za-z0-9][\w.\-]{2,79}$/;

function moeda(v) { return v == null ? "" : "R$ " + Math.round(v).toLocaleString("pt-BR"); }

function ufDoVisitante(request) {
  const cf = request.cf || {};
  const uf = cf.country === "BR" && /^[A-Z]{2}$/.test(cf.regionCode || "") ? cf.regionCode : null;
  return new Response(JSON.stringify({ uf, pais: cf.country || null }), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
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
    if (r.a != null) partes.push(`${Math.round(r.a)} m²`);
    if (r.q != null) partes.push(`${r.q} quarto${r.q > 1 ? "s" : ""}`);
    if (r.n) partes.push(r.n);
    const descricao = partes.join(" · ") + ". Ficha completa, histórico de preço, mapa e análise com IA.";
    const canonico = `${url.origin}/imovel.html?id=${encodeURIComponent(id)}&uf=${uf}`;
    return new HTMLRewriter()
      .on("title", { element(e) { e.setInnerContent(titulo); } })
      .on('meta[property="og:title"], meta[name="twitter:title"]', { element(e) { e.setAttribute("content", titulo); } })
      .on('meta[property="og:description"], meta[name="twitter:description"], meta[name="description"]', { element(e) { e.setAttribute("content", descricao); } })
      .on('meta[property="og:url"]', { element(e) { e.setAttribute("content", canonico); } })
      .on('link[rel="canonical"]', { element(e) { e.setAttribute("href", canonico); } })
      .transform(resp);
  } catch (e) {
    return resp;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
