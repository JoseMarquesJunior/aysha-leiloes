// Testes do Worker do site (sem dependências): node --test site/index.test.mjs
// O HTMLRewriter da Cloudflare não existe no Node; aqui um substituto registra os manipuladores e os aplica
// a elementos falsos, o bastante para conferir título, description, canonical, JSON-LD e o resumo da ficha.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

class HTMLRewriterFalso {
  constructor() { this.regras = []; }
  on(seletor, h) { this.regras.push([seletor, h]); return this; }
  transform(resp) { resp.regras = this.regras; return resp; }
}
globalThis.HTMLRewriter = HTMLRewriterFalso;

const fonte = readFileSync(new URL("./index.js", import.meta.url), "utf8");
const worker = (await import("data:text/javascript;base64," + Buffer.from(fonte).toString("base64"))).default;

const HOJE = new Date().toISOString().slice(0, 10);
const FUTURO = "2999-01-01", PASSADO = "2000-01-01";
const og = {
  "caixa-1": { t: "apartamento", b: "Centro", c: "Vila Velha", v: 100000, va: 200000, d: 50, a: 50, q: 2, dl: FUTURO, s: "caixa", n: "venda direta" },
  "caixa-2": { t: "apartamento", c: "Vila Velha", v: 150000, d: 30, a: 50, s: "caixa" },
  "caixa-3": { t: "apartamento", c: "Vila Velha", v: 200000, d: 20, a: 50, s: "caixa" },
  "caixa-4": { t: "apartamento", c: "Vila Velha", v: 250000, d: 20, a: 50, s: "caixa" },
  "caixa-5": { t: "apartamento", c: "Vila Velha", v: 300000, d: 10, a: 50, s: "caixa" },
  "caixa-6": { t: "apartamento", c: "Vila Velha", v: 90000, d: 40, a: 50, s: "caixa", dl: PASSADO },
  "caixa-7": { t: "casa", c: "Anchieta", v: 90000, d: 40, a: 50, s: "caixa" },
};

function env(mapa, statusOg = 200) {
  return {
    ASSETS: {
      async fetch(req) {
        const u = new URL(typeof req === "string" ? req : req.url);
        if (u.pathname.startsWith("/data/og_")) return statusOg === 200 ? new Response(JSON.stringify(mapa)) : new Response("", { status: statusOg });
        return new Response("<html><title>Imóvel</title></html>", { headers: { "Content-Type": "text/html" } });
      },
    },
  };
}
const pedir = (q, e = env(og)) => worker.fetch(new Request("https://ayshaleiloes.com.br/imovel.html" + q), e);

function aplicar(resp) {
  const el = { attrs: {}, conteudo: null, anexo: [] };
  const e = { setInnerContent(c) { el.conteudo = c; }, setAttribute(k, v) { el.attrs[k] = v; }, append(c) { el.anexo.push(c); } };
  const saida = {};
  for (const [seletor, h] of resp.regras) {
    el.attrs = {}; el.conteudo = null; el.anexo = [];
    h.element(e);
    saida[seletor] = { attrs: { ...el.attrs }, conteudo: el.conteudo, anexo: [...el.anexo] };
  }
  return saida;
}

test("ficha inexistente responde 404 com noindex", async () => {
  const r = await pedir("?id=naoexiste-999&uf=ES");
  assert.equal(r.status, 404);
  assert.equal(r.headers.get("X-Robots-Tag"), "noindex");
});

test("parâmetros inválidos e UF sem og respondem 404; sem parâmetros mantém o shell 200", async () => {
  assert.equal((await pedir("?id=../x&uf=ES")).status, 404);
  assert.equal((await pedir("?id=caixa-1&uf=es")).status, 404);
  assert.equal((await pedir("?id=caixa-1&uf=AC", env(og, 404))).status, 404);
  assert.equal((await pedir("")).status, 200);
});

test("falha momentânea ao ler o og não vira 404", async () => {
  assert.equal((await pedir("?id=caixa-1&uf=ES", env(og, 500))).status, 200);
});

test("ficha existente: 200, title e description com leilão e fonte", async () => {
  const r = await pedir("?id=caixa-1&uf=ES");
  assert.equal(r.status, 200);
  const s = aplicar(r);
  const titulo = s["title"].conteudo;
  assert.match(titulo, /^Apartamento em leilão em Centro, Vila Velha\/ES \(Caixa\) por R\$ 100\.000/);
  const desc = s['meta[property="og:description"], meta[name="twitter:description"], meta[name="description"]'].attrs.content;
  assert.match(desc, /^Leilão de apartamento em Centro, Vila Velha\/ES \(Caixa\): lance mínimo R\$ 100\.000/);
  assert.ok(desc.length <= 158, `description com ${desc.length} caracteres`);
  assert.equal(s['link[rel="canonical"]'].attrs.href, "https://ayshaleiloes.com.br/imovel.html?id=caixa-1&uf=ES");
});

test("resumo: h1, comparação por regra, vizinhos sem encerrados, links para cidade e UF, sem 'carregando'", async () => {
  const s = aplicar(await pedir("?id=caixa-1&uf=ES"));
  const html = s["main#detalhe"].conteudo;
  assert.match(html, /^<h1>Apartamento em leilão em Centro, Vila Velha\/ES<\/h1>/);
  assert.match(html, /O metro quadrado deste imóvel sai a R\$ 2\.000, 43% abaixo da mediana dos apartamentos em leilão em Vila Velha/);
  assert.match(html, /O desconto de 50% sobre a avaliação está \d+ pontos percentuais acima da média/);
  assert.ok(!html.includes("carregando"));
  assert.ok(html.includes("id=caixa-2&amp;uf=ES") && html.includes("id=caixa-5&amp;uf=ES"));
  assert.ok(!html.includes("id=caixa-6"), "ficha encerrada não deve ser sugerida");
  assert.ok(html.includes('href="/leiloes/ES/vila-velha.html"') && html.includes('href="/leiloes/ES/"'));
});

test("JSON-LD: encerrado vira SoldOut, aberto InStock com priceValidUntil", async () => {
  const aberto = aplicar(await pedir("?id=caixa-1&uf=ES"))["head"].anexo[0];
  assert.match(aberto, /schema\.org\/InStock/);
  assert.match(aberto, /"priceValidUntil":"2999-01-01"/);
  const enc = aplicar(await pedir("?id=caixa-6&uf=ES"))["head"].anexo[0];
  assert.match(enc, /schema\.org\/SoldOut/);
  assert.ok(!enc.includes("priceValidUntil"));
});

test("cidade pequena e sem amostra: sem comparação e sem link de cidade", async () => {
  const html = aplicar(await pedir("?id=caixa-7&uf=ES"))["main#detalhe"].conteudo;
  assert.ok(!html.includes("mediana"));
  assert.ok(!html.includes("/leiloes/ES/anchieta.html"));
});

test("slug igual ao do coletor", async () => {
  const fichas = { ...og, "x-1": { t: "casa", c: "São José dos Campos", v: 1, s: "caixa" } };
  for (let i = 0; i < 5; i++) fichas["x-" + (i + 2)] = { t: "casa", c: "São José dos Campos", v: 1, s: "caixa" };
  const html = aplicar(await pedir("?id=x-1&uf=SP", env(fichas)))["main#detalhe"].conteudo;
  assert.ok(html.includes("/leiloes/SP/sao-jose-dos-campos.html"));
});
