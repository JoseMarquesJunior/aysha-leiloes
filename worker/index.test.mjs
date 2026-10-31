// Testes do Worker de contas (cupom de parceiro): node --test worker/index.test.mjs
// Requer Node 22.5+ (node:sqlite). O D1 da Cloudflare é SQLite: um adaptador fino sobre node:sqlite
// reproduz prepare/bind/first/all/run/batch e o schema.sql REAL é aplicado num banco em memória,
// então as consultas exercitadas são as mesmas da produção. E-mails não saem: o fetch global vira um
// stub que só aceita a chamada ao Brevo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const fonte = readFileSync(new URL("./src/index.js", import.meta.url), "utf8");
const mod = await import("data:text/javascript;base64," + Buffer.from(fonte).toString("base64"));
const worker = mod.default;
const { _cupomParaAplicar: cupomParaAplicar, _CUPONS: CUPONS } = mod;

const HOJE = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10); // mesmo cálculo de hojeBrasilia()
// os cupons do código têm valido_ate real: quando todos vencerem, os testes de aplicação avisam em vez de mentir
const CUPOM_ATIVO = CUPONS.find(c => c.valido_ate >= HOJE);

// ---------------------------------------------------------------- D1 e KV falsos ------
class StmtFalso {
  constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
  bind(...a) { this.args = a.map(x => (x === undefined ? null : x)); return this; }
  async first() { return this.db.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args) }; }
  async run() { const i = this.db.prepare(this.sql).run(...this.args); return { meta: { changes: Number(i.changes) } }; }
}
class D1Falso {
  constructor(db) { this.db = db; }
  prepare(sql) { return new StmtFalso(this.db, sql); }
  async batch(lista) { const r = []; for (const s of lista) r.push(await s.run()); return r; }
}
class KvFalso {
  constructor() { this.m = new Map(); }
  async get(k) { return this.m.has(k) ? this.m.get(k) : null; }
  async put(k, v) { this.m.set(k, v); }
}

function criarBanco() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  return db;
}
function criarEnv(db) {
  return {
    DB: new D1Falso(db), LIMITES: new KvFalso(),
    SITE: "https://exemplo.test", ORIGENS: "https://exemplo.test",
    EMAIL_VIA: "brevo", BREVO_API_KEY: "teste", EMAIL_REMETENTE: "robo@exemplo.test",
    ADMIN_EMAILS: "admin@exemplo.test", EMAILS_TESTE: "teste-funil@exemplo.test",
    INTERNO_SECRET: "segredo",
  };
}
globalThis.fetch = async (url) => {
  if (String(url).includes("api.brevo.com")) return new Response("{}", { status: 201 });
  throw new Error("fetch inesperado nos testes: " + url);
};

const api = (env, caminho, corpo, headers) =>
  worker.fetch(new Request("https://api.exemplo.test" + caminho, {
    method: corpo !== undefined ? "POST" : "GET",
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  }), env);

let seq = 0;
function tokenLink() { return (++seq).toString(16).padStart(48, "0"); }
/* Grava o link de login direto no banco (o /auth/pedir é testado à parte) e entra. */
async function entrar(env, db, email, cupom) {
  const t = tokenLink();
  db.prepare("INSERT INTO links_login (token, email, expira_em, cupom) VALUES (?, ?, ?, ?)")
    .run(t, email, new Date(Date.now() + 60000).toISOString(), cupom ?? null);
  const r = await api(env, "/auth/entrar", { token: t });
  return { status: r.status, dados: await r.json() };
}
function usuario(db, email) { return db.prepare("SELECT * FROM usuarios WHERE email = ?").get(email) ?? null; }

// ---------------------------------------------------------------- regras do cupom -----
test("cupomParaAplicar: normaliza, rejeita formato inválido e respeita valido_ate", () => {
  const c = CUPONS[0];
  const antes = c.valido_ate;                       // vale até o último dia, inclusive
  const depois = antes.slice(0, 8) + String(Number(antes.slice(8)) + 1).padStart(2, "0");
  assert.equal(cupomParaAplicar("  " + c.codigo.toLowerCase() + " ", "2026-01-01"), c);
  assert.equal(cupomParaAplicar(c.codigo, antes), c);
  assert.equal(cupomParaAplicar(c.codigo, depois), null, "cupom vencido não se aplica");
  assert.equal(cupomParaAplicar("NAO-EXISTE", "2026-01-01"), null);
  assert.equal(cupomParaAplicar("código com espaço!", "2026-01-01"), null);
  assert.equal(cupomParaAplicar("", "2026-01-01"), null);
});

test("/auth/pedir guarda o cupom normalizado junto do token; formato inválido vira null sem erro", async () => {
  const db = criarBanco(), env = criarEnv(db);
  let r = await api(env, "/auth/pedir", { email: "a@exemplo.test", cupom: "  parceiro1 " });
  assert.equal(r.status, 200);
  assert.equal(db.prepare("SELECT cupom FROM links_login WHERE email = ?").get("a@exemplo.test").cupom, "PARCEIRO1");
  r = await api(env, "/auth/pedir", { email: "b@exemplo.test", cupom: "tem espaço e acento é!" });
  assert.equal(r.status, 200, "cupom malformado não bloqueia o pedido de link");
  assert.equal(db.prepare("SELECT cupom FROM links_login WHERE email = ?").get("b@exemplo.test").cupom, null);
  r = await api(env, "/auth/pedir", { email: "c@exemplo.test" });
  assert.equal(r.status, 200, "sem cupom continua igual");
});

test("cupom válido em conta nova: 1 crédito grátis + extras, cupom gravado e origem no ledger (cortesia)", { skip: !CUPOM_ATIVO && "todos os CUPONS do código venceram; atualize valido_ate" }, async () => {
  const db = criarBanco(), env = criarEnv(db);
  const { status, dados } = await entrar(env, db, "novo@exemplo.test", CUPOM_ATIVO.codigo);
  assert.equal(status, 200);
  assert.equal(dados.nova_conta, true);
  assert.equal(dados.cupom, CUPOM_ATIVO.codigo);
  const u = usuario(db, "novo@exemplo.test");
  assert.equal(u.creditos, 1 + CUPOM_ATIVO.creditos_extra);
  assert.equal(u.cupom, CUPOM_ATIVO.codigo);
  const ledger = db.prepare("SELECT * FROM pedidos WHERE usuario_id = ?").all(u.id);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].status, "cortesia", "créditos extras nunca contam como compra paga");
  assert.equal(ledger[0].creditos, CUPOM_ATIVO.creditos_extra);
  assert.equal(ledger[0].valor_centavos, 0);
  assert.equal(ledger[0].pacote, `cupom: ${CUPOM_ATIVO.codigo}`);
});

test("cupom desconhecido cai no padrão sem erro: conta criada com 1 crédito e cupom null", async () => {
  const db = criarBanco(), env = criarEnv(db);
  const { status, dados } = await entrar(env, db, "novo2@exemplo.test", "NAOEXISTE");
  assert.equal(status, 200);
  assert.equal(dados.nova_conta, true);
  assert.equal(dados.cupom, null);
  const u = usuario(db, "novo2@exemplo.test");
  assert.equal(u.creditos, 1);
  assert.equal(u.cupom, null);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM pedidos").get().n, 0, "sem ledger de cortesia");
});

test("conta existente ignora o cupom (extras só em conta nova; no máximo um cupom por conta)", { skip: !CUPOM_ATIVO && "todos os CUPONS do código venceram; atualize valido_ate" }, async () => {
  const db = criarBanco(), env = criarEnv(db);
  await entrar(env, db, "velho@exemplo.test");                       // conta criada sem cupom
  const { status, dados } = await entrar(env, db, "velho@exemplo.test", CUPOM_ATIVO.codigo);
  assert.equal(status, 200);
  assert.equal(dados.nova_conta, false);
  const u = usuario(db, "velho@exemplo.test");
  assert.equal(u.creditos, 1, "login repetido com cupom não credita nada");
  assert.equal(u.cupom, null);
});

test("max_contas é respeitado com cadastros simultâneos (INSERT condicional atômico)", { skip: !CUPOM_ATIVO && "todos os CUPONS do código venceram; atualize valido_ate" }, async () => {
  const db = criarBanco(), env = criarEnv(db);
  const alem = 5, total = CUPOM_ATIVO.max_contas + alem;
  const resultados = await Promise.all(Array.from({ length: total }, (_, i) => entrar(env, db, `c${i}@exemplo.test`, CUPOM_ATIVO.codigo)));
  assert.ok(resultados.every(r => r.status === 200 && r.dados.nova_conta), "nenhum cadastro é bloqueado");
  const comCupom = db.prepare("SELECT COUNT(*) n FROM usuarios WHERE cupom = ?").get(CUPOM_ATIVO.codigo).n;
  assert.equal(comCupom, CUPOM_ATIVO.max_contas);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM usuarios").get().n, total, "quem chegou depois do teto também tem conta");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM usuarios WHERE cupom IS NULL AND creditos = 1").get().n, alem, "e fica com o 1 crédito padrão");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM pedidos WHERE status = 'cortesia'").get().n, CUPOM_ATIVO.max_contas, "um lançamento de cortesia por conta com cupom");
  assert.equal(resultados.filter(r => r.dados.cupom).length, CUPOM_ATIVO.max_contas);
});

// ---------------------------------------------------------------- rota da admin -------
test("/admin/cupons agrega por cupom, separa grátis de pago e exclui contas de teste do mantenedor", { skip: !CUPOM_ATIVO && "todos os CUPONS do código venceram; atualize valido_ate" }, async () => {
  const db = criarBanco(), env = criarEnv(db);
  const extras = CUPOM_ATIVO.creditos_extra;       // créditos concedidos na criação: 1 + extras
  // contas: A e B com cupom; C sem cupom; D (EMAILS_TESTE) com cupom, fora das contagens
  const a = (await entrar(env, db, "a@exemplo.test", CUPOM_ATIVO.codigo), usuario(db, "a@exemplo.test"));
  const b = (await entrar(env, db, "b@exemplo.test", CUPOM_ATIVO.codigo), usuario(db, "b@exemplo.test"));
  const c = (await entrar(env, db, "c@exemplo.test"), usuario(db, "c@exemplo.test"));
  await entrar(env, db, "teste-funil@exemplo.test", CUPOM_ATIVO.codigo);
  // análises: A consome 1 (grátis); B consome 1+extras+1 (a última é paga); C consome 1 (grátis)
  const acesso = db.prepare("INSERT INTO acessos (usuario_id, id_imovel, liberado_em, origem) VALUES (?, ?, ?, 'credito')");
  acesso.run(a.id, "im-a1", "2026-11-02T10:00:00Z");
  for (let i = 0; i <= extras + 1; i++) acesso.run(b.id, `im-b${i}`, "2026-11-03T10:00:00Z");
  acesso.run(c.id, "im-c1", "2026-11-04T10:00:00Z");
  // compra paga: só B (R$ 59,00)
  db.prepare("INSERT INTO pedidos (id, usuario_id, pacote, creditos, valor_centavos, status, criado_em, pago_em) VALUES ('ped-b', ?, '5', 5, 5900, 'pago', '2026-11-03T09:00:00Z', '2026-11-03T09:01:00Z')").run(b.id);
  // sessão de admin
  db.prepare("INSERT INTO usuarios (email, criado_em, creditos) VALUES ('admin@exemplo.test', '2026-01-01T00:00:00Z', 0)").run();
  const adminId = db.prepare("SELECT id FROM usuarios WHERE email = 'admin@exemplo.test'").get().id;
  const sessaoAdmin = "f".repeat(64);
  db.prepare("INSERT INTO sessoes (token, usuario_id, criado_em, expira_em) VALUES (?, ?, ?, ?)")
    .run(sessaoAdmin, adminId, new Date().toISOString(), new Date(Date.now() + 86400000).toISOString());

  const r = await api(env, "/admin/cupons", undefined, { Authorization: "Bearer " + sessaoAdmin });
  assert.equal(r.status, 200);
  const d = await r.json();
  const linha = d.cupons.find(x => x.codigo === CUPOM_ATIVO.codigo);
  assert.equal(linha.contas, 2, "a conta de EMAILS_TESTE fica fora");
  assert.equal(linha.contas_com_gratis, 2);
  // grátis consumidas: A = min(1, 1+extras) = 1; B = min(2+extras, 1+extras) = 1+extras
  assert.equal(linha.gratis_consumidas, 1 + (1 + extras));
  assert.equal(linha.compras_pagas, 1);
  assert.equal(linha.receita_centavos, 5900);
  assert.equal(linha.ultima_conta, b.criado_em);
  assert.equal(linha.parceiro, CUPOM_ATIVO.parceiro);
  for (const outro of CUPONS.filter(x => x !== CUPOM_ATIVO)) {
    const l = d.cupons.find(x => x.codigo === outro.codigo);
    assert.ok(l && l.contas === 0 && l.compras_pagas === 0, "cupom sem conta aparece zerado");
  }
  // sem cupom: só C (admin é excluído)
  assert.equal(d.sem_cupom.contas, 1);
  assert.equal(d.sem_cupom.gratis_consumidas, 1);
  assert.equal(d.sem_cupom.compras_pagas, 0);

  // sem sessão de admin, a rota não responde
  const negado = await api(env, "/admin/cupons");
  assert.equal(negado.status, 401);
});

// ---------------------------------------------------------------- migração ------------
test("a migração aplica num banco anterior (sem as colunas) e deixa o cupom gravável", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE,
             criado_em TEXT NOT NULL, ultimo_login TEXT, creditos INTEGER NOT NULL DEFAULT 1,
             gratis_usado INTEGER NOT NULL DEFAULT 1);
           CREATE TABLE links_login (token TEXT PRIMARY KEY, email TEXT NOT NULL, expira_em TEXT NOT NULL,
             usado INTEGER NOT NULL DEFAULT 0);`);
  db.prepare("INSERT INTO usuarios (email, criado_em) VALUES ('antigo@exemplo.test', '2026-01-01')").run();
  db.exec(readFileSync(new URL("./migrations/2026-10-31-cupom-parceiro.sql", import.meta.url), "utf8"));
  assert.equal(db.prepare("SELECT cupom FROM usuarios WHERE email = 'antigo@exemplo.test'").get().cupom, null);
  db.prepare("INSERT INTO usuarios (email, criado_em, cupom) VALUES ('novo@exemplo.test', '2026-11-01', 'PARCEIRO1')").run();
  db.prepare("INSERT INTO links_login (token, email, expira_em, cupom) VALUES ('t', 'x@exemplo.test', '2026-11-01', 'PARCEIRO1')").run();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM usuarios WHERE cupom = 'PARCEIRO1'").get().n, 1);
});
