/**
 * Aysha Leilões — Worker (Cloudflare Workers + D1 + KV), plano gratuito.
 *
 * Contas por link mágico (e-mail), créditos, entrega dos relatórios só a quem tem acesso, checkout de
 * créditos no Mercado Pago com confirmação por webhook e recibo por e-mail.
 *
 * Rotas (JSON; CORS restrito às ORIGENS):
 *   POST /auth/pedir        {email}            -> envia o link de login por e-mail
 *   POST /auth/entrar       {token}            -> troca o token do link por um token de sessão
 *   POST /auth/sair                            -> encerra a sessão
 *   GET  /conta                                -> saldo, análises liberadas, compras (autenticado)
 *   POST /analise           {id}               -> libera (grátis ou 1 crédito) e devolve o relatório, ou dispara a geração
 *   GET  /relatorio/:id                        -> relatório, se o usuário tem acesso
 *   GET  /pacotes                              -> tabela de créditos
 *   POST /pagamento/criar   {pacote}           -> cria a preferência no Mercado Pago e devolve a URL do checkout
 *   GET  /pagamento/estado/:pedido             -> status do pedido (página de retorno)
 *   POST /pagamento/webhook                    -> notificação do Mercado Pago (sem CORS)
 *   POST /interno/relatorio                    -> o robô do GitHub grava o relatório gerado (header X-Interno)
 *
 * Segredos (wrangler secret put): GITHUB_TOKEN, INTERNO_SECRET, MP_ACCESS_TOKEN, BREVO_API_KEY
 * Variáveis (wrangler.toml): REPO, SITE, ORIGENS, LIMITE_IP, LIMITE_DIA, EMAIL_REMETENTE, NOME_REMETENTE, PACOTES
 * Bindings: DB (D1), LIMITES (KV)
 */

const ID_OK = /^[\w.\-]{3,80}$/;
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ---------------------------------------------------------------- utilidades ----------
function agora() { return new Date().toISOString(); }
function maisMinutos(min) { return new Date(Date.now() + min * 60000).toISOString(); }
function token(n = 32) {
  const b = new Uint8Array(n); crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, "0")).join("");
}
async function hashIp(ip) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip + "aysha"));
  return [...new Uint8Array(buf)].slice(0, 8).map(b => b.toString(16).padStart(2, "0")).join("");
}
function cors(env, origin) {
  const permitidas = (env.ORIGENS || "").split(",").map(s => s.trim()).filter(Boolean);
  const ok = permitidas.includes(origin) ? origin : permitidas[0] || "*";
  return { "Access-Control-Allow-Origin": ok, "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
           "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Interno", "Vary": "Origin" };
}
function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
}
async function corpo(request) { try { return await request.json(); } catch { return {}; } }
function pacotes(env) {
  try { return JSON.parse(env.PACOTES); } catch { return [{ id: "1", creditos: 1, valor_centavos: 1490, nome: "1 análise" }]; }
}
async function contar(env, chave, ttl) {
  const atual = parseInt((await env.LIMITES.get(chave)) || "0", 10) + 1;
  await env.LIMITES.put(chave, String(atual), { expirationTtl: ttl });
  return atual;
}

// ---------------------------------------------------------------- e-mail (Brevo) ------
async function enviarEmail(env, para, assunto, html) {
  if (!env.BREVO_API_KEY || !env.EMAIL_REMETENTE) throw new Error("envio de e-mail não configurado (BREVO_API_KEY / EMAIL_REMETENTE)");
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ sender: { email: env.EMAIL_REMETENTE, name: env.NOME_REMETENTE || "Aysha Leilões" },
                           to: [{ email: para }], subject: assunto, htmlContent: html }),
  });
  if (!r.ok) throw new Error(`e-mail não enviado (${r.status}): ${(await r.text()).slice(0, 200)}`);
}

// ---------------------------------------------------------------- autenticação --------
async function usuarioDaSessao(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const t = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!/^[0-9a-f]{64}$/.test(t)) return null;
  const s = await env.DB.prepare("SELECT u.id, u.email, u.creditos, u.gratis_usado FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token = ? AND s.expira_em > ?")
    .bind(t, agora()).first();
  return s || null;
}

async function pedirLogin(request, env, h) {
  const { email } = await corpo(request);
  const e = String(email || "").trim().toLowerCase();
  if (!EMAIL_OK.test(e) || e.length > 120) return json({ erro: "e-mail inválido" }, 400, h);
  const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
  if ((await contar(env, `login:${await hashIp(ip)}:${new Date().toISOString().slice(0, 13)}`, 3600)) > 10)
    return json({ erro: "muitos pedidos de login; tente mais tarde" }, 429, h);
  const t = token(24);
  await env.DB.prepare("INSERT INTO links_login (token, email, expira_em) VALUES (?, ?, ?)").bind(t, e, maisMinutos(20)).run();
  const link = `${env.SITE.replace(/\/$/, "")}/conta.html?token=${t}`;
  // modo de teste do mantenedor: com o segredo interno, devolve o link em vez de enviar
  if (request.headers.get("X-Interno") && request.headers.get("X-Interno") === env.INTERNO_SECRET) return json({ ok: true, link }, 200, h);
  await enviarEmail(env, e, "Seu acesso ao Aysha Leilões",
    `<p>Olá! Para entrar no Aysha Leilões, clique no link abaixo (vale por 20 minutos):</p>
     <p><a href="${link}">${link}</a></p>
     <p>Se você não pediu este acesso, ignore este e-mail.</p>`);
  return json({ ok: true }, 200, h);
}

async function entrar(request, env, h) {
  const { token: t } = await corpo(request);
  if (!/^[0-9a-f]{48}$/.test(String(t || ""))) return json({ erro: "link inválido" }, 400, h);
  const l = await env.DB.prepare("SELECT email, expira_em, usado FROM links_login WHERE token = ?").bind(t).first();
  if (!l || l.usado || l.expira_em < agora()) return json({ erro: "link expirado ou já usado; peça um novo" }, 400, h);
  await env.DB.prepare("UPDATE links_login SET usado = 1 WHERE token = ?").bind(t).run();
  let u = await env.DB.prepare("SELECT id FROM usuarios WHERE email = ?").bind(l.email).first();
  let nova = false;
  if (!u) {
    await env.DB.prepare("INSERT INTO usuarios (email, criado_em, ultimo_login) VALUES (?, ?, ?)").bind(l.email, agora(), agora()).run();
    u = await env.DB.prepare("SELECT id FROM usuarios WHERE email = ?").bind(l.email).first();
    nova = true;
  } else {
    await env.DB.prepare("UPDATE usuarios SET ultimo_login = ? WHERE id = ?").bind(agora(), u.id).run();
  }
  const s = token(32);
  await env.DB.prepare("INSERT INTO sessoes (token, usuario_id, criado_em, expira_em) VALUES (?, ?, ?, ?)")
    .bind(s, u.id, agora(), new Date(Date.now() + 90 * 86400000).toISOString()).run();
  return json({ sessao: s, email: l.email, nova_conta: nova }, 200, h);
}

async function sair(request, env, h) {
  const auth = request.headers.get("Authorization") || "";
  const t = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (t) await env.DB.prepare("DELETE FROM sessoes WHERE token = ?").bind(t).run();
  return json({ ok: true }, 200, h);
}

async function conta(usuario, env, h) {
  const analises = (await env.DB.prepare(
    "SELECT a.id_imovel, a.liberado_em, a.origem, r.gerado_em FROM acessos a LEFT JOIN relatorios r ON r.id_imovel = a.id_imovel WHERE a.usuario_id = ? ORDER BY a.liberado_em DESC LIMIT 200")
    .bind(usuario.id).all()).results;
  const compras = (await env.DB.prepare(
    "SELECT id, pacote, creditos, valor_centavos, status, criado_em, pago_em FROM pedidos WHERE usuario_id = ? ORDER BY criado_em DESC LIMIT 100")
    .bind(usuario.id).all()).results;
  return json({ email: usuario.email, creditos: usuario.creditos, gratis_disponivel: !usuario.gratis_usado, analises, compras, pacotes: pacotes(env) }, 200, h);
}

// ---------------------------------------------------------------- relatórios ----------
function relatorioSaida(r) {
  return { id: r.id_imovel, gerado_em: r.gerado_em, modelo: r.modelo, custo_usd: r.custo_usd, documentos_lidos: r.documentos_lidos,
           uso: r.uso_json ? JSON.parse(r.uso_json) : null, campos: r.campos_json ? JSON.parse(r.campos_json) : null, markdown: r.markdown };
}

async function temAcesso(env, usuarioId, id) {
  return !!(await env.DB.prepare("SELECT 1 FROM acessos WHERE usuario_id = ? AND id_imovel = ?").bind(usuarioId, id).first());
}

async function obterRelatorio(usuario, id, env, h) {
  if (!ID_OK.test(id)) return json({ erro: "id inválido" }, 400, h);
  if (!(await temAcesso(env, usuario.id, id))) return json({ erro: "sem acesso a este relatório" }, 403, h);
  const r = await env.DB.prepare("SELECT * FROM relatorios WHERE id_imovel = ?").bind(id).first();
  if (!r) {
    const p = await env.DB.prepare("SELECT pedido_em FROM analises_pendentes WHERE id_imovel = ?").bind(id).first();
    return json({ status: p ? "em_andamento" : "nao_gerado", pedido_em: p ? p.pedido_em : null }, 202, h);
  }
  return json({ status: "pronto", relatorio: relatorioSaida(r) }, 200, h);
}

async function dispararWorkflow(env, id) {
  const r = await fetch(`https://api.github.com/repos/${env.REPO}/actions/workflows/relatorio.yml/dispatches`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.GITHUB_TOKEN}`, "Accept": "application/vnd.github+json",
               "User-Agent": "aysha-leiloes-worker", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
    body: JSON.stringify({ ref: "main", inputs: { ids: id } }),
  });
  if (r.status !== 204) throw new Error(`GitHub respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function analisar(request, usuario, env, h) {
  const { id } = await corpo(request);
  if (!ID_OK.test(String(id || ""))) return json({ erro: "id inválido" }, 400, h);
  // já tem acesso? devolve o que houver
  if (await temAcesso(env, usuario.id, id)) return obterRelatorio(usuario, id, env, h);
  // cobra: análise grátis ou 1 crédito
  let origem;
  if (!usuario.gratis_usado) {
    origem = "gratis";
    await env.DB.prepare("UPDATE usuarios SET gratis_usado = 1 WHERE id = ? AND gratis_usado = 0").bind(usuario.id).run();
  } else if (usuario.creditos > 0) {
    origem = "credito";
    const res = await env.DB.prepare("UPDATE usuarios SET creditos = creditos - 1 WHERE id = ? AND creditos > 0").bind(usuario.id).run();
    if (!res.meta || res.meta.changes === 0) return json({ erro: "sem créditos", precisa_comprar: true }, 402, h);
  } else {
    return json({ erro: "sem créditos", precisa_comprar: true }, 402, h);
  }
  await env.DB.prepare("INSERT OR IGNORE INTO acessos (usuario_id, id_imovel, liberado_em, origem) VALUES (?, ?, ?, ?)").bind(usuario.id, id, agora(), origem).run();
  const existente = await env.DB.prepare("SELECT * FROM relatorios WHERE id_imovel = ?").bind(id).first();
  if (existente) return json({ status: "pronto", origem, relatorio: relatorioSaida(existente) }, 200, h);
  // precisa gerar: limites de geração (custo real) e disparo do robô
  const hoje = new Date().toISOString().slice(0, 10);
  if ((await contar(env, `dia:${hoje}`, 86400)) > Number(env.LIMITE_DIA || 100)) {
    return json({ status: "fila", mensagem: "limite diário de novas análises atingido; sua análise entra na fila de amanhã" }, 202, h);
  }
  const pendente = await env.DB.prepare("SELECT pedido_em FROM analises_pendentes WHERE id_imovel = ?").bind(id).first();
  if (!pendente) {
    try { await dispararWorkflow(env, id); }
    catch (e) { return json({ erro: "não foi possível iniciar a análise agora", detalhe: String(e.message).slice(0, 200) }, 502, h); }
    await env.DB.prepare("INSERT OR REPLACE INTO analises_pendentes (id_imovel, usuario_id, pedido_em) VALUES (?, ?, ?)").bind(id, usuario.id, agora()).run();
  }
  return json({ status: "iniciado", origem, espera_segundos: 240 }, 202, h);
}

async function gravarRelatorioInterno(request, env, h) {
  if (request.headers.get("X-Interno") !== env.INTERNO_SECRET) return json({ erro: "não autorizado" }, 401, h);
  const d = await corpo(request);
  if (!ID_OK.test(String(d.id || "")) || !d.markdown) return json({ erro: "faltam id/markdown" }, 400, h);
  await env.DB.prepare(
    "INSERT OR REPLACE INTO relatorios (id_imovel, gerado_em, modelo, custo_usd, documentos_lidos, uso_json, campos_json, markdown) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(d.id, d.gerado_em || agora(), d.modelo || null, d.custo_usd ?? null, d.documentos_lidos ?? 0,
          JSON.stringify(d.uso || null), JSON.stringify(d.campos || null), d.markdown).run();
  await env.DB.prepare("DELETE FROM analises_pendentes WHERE id_imovel = ?").bind(d.id).run();
  if (d.liberar_para_usuario_id) {
    await env.DB.prepare("INSERT OR IGNORE INTO acessos (usuario_id, id_imovel, liberado_em, origem) VALUES (?, ?, ?, 'cortesia')").bind(d.liberar_para_usuario_id, d.id, agora()).run();
  }
  return json({ ok: true }, 200, h);
}

// ---------------------------------------------------------------- Mercado Pago --------
async function criarPagamento(request, usuario, env, h) {
  if (!env.MP_ACCESS_TOKEN) return json({ erro: "pagamento ainda não configurado" }, 503, h);
  const { pacote } = await corpo(request);
  const p = pacotes(env).find(x => x.id === String(pacote));
  if (!p) return json({ erro: "pacote inválido" }, 400, h);
  const pedidoId = crypto.randomUUID();
  const site = env.SITE.replace(/\/$/, "");
  const pref = {
    items: [{ id: p.id, title: `Aysha Leilões — ${p.nome}`, description: `${p.creditos} crédito(s) de análise com IA`, quantity: 1, currency_id: "BRL", unit_price: p.valor_centavos / 100 }],
    payer: { email: usuario.email },
    external_reference: pedidoId,
    back_urls: { success: `${site}/conta.html?pedido=${pedidoId}`, pending: `${site}/conta.html?pedido=${pedidoId}`, failure: `${site}/conta.html?pedido=${pedidoId}&falha=1` },
    auto_return: "approved",
    notification_url: `${new URL(request.url).origin}/pagamento/webhook`,
    statement_descriptor: "AYSHA LEILOES",
    metadata: { pedido_id: pedidoId, usuario_id: usuario.id },
  };
  const r = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST", headers: { "Authorization": `Bearer ${env.MP_ACCESS_TOKEN}`, "Content-Type": "application/json", "X-Idempotency-Key": pedidoId },
    body: JSON.stringify(pref),
  });
  if (!r.ok) return json({ erro: `Mercado Pago respondeu ${r.status}`, detalhe: (await r.text()).slice(0, 300) }, 502, h);
  const resp = await r.json();
  await env.DB.prepare("INSERT INTO pedidos (id, usuario_id, pacote, creditos, valor_centavos, status, mp_preference_id, criado_em) VALUES (?, ?, ?, ?, ?, 'criado', ?, ?)")
    .bind(pedidoId, usuario.id, p.id, p.creditos, p.valor_centavos, resp.id, agora()).run();
  return json({ pedido: pedidoId, checkout: resp.init_point, sandbox: resp.sandbox_init_point || null }, 200, h);
}

async function confirmarPagamento(env, paymentId) {
  const r = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, { headers: { "Authorization": `Bearer ${env.MP_ACCESS_TOKEN}` } });
  if (!r.ok) return { ok: false, motivo: `consulta ${r.status}` };
  const pg = await r.json();
  const pedidoId = pg.external_reference;
  if (!pedidoId) return { ok: false, motivo: "sem external_reference" };
  const pedido = await env.DB.prepare("SELECT * FROM pedidos WHERE id = ?").bind(pedidoId).first();
  if (!pedido) return { ok: false, motivo: "pedido não encontrado" };
  if (pg.status !== "approved") {
    if (["cancelled", "rejected", "refunded", "charged_back"].includes(pg.status) && pedido.status === "criado")
      await env.DB.prepare("UPDATE pedidos SET status = 'cancelado', mp_payment_id = ? WHERE id = ?").bind(String(pg.id), pedidoId).run();
    return { ok: true, status: pg.status };
  }
  if (pedido.status === "pago") return { ok: true, status: "approved", repetido: true };
  // credita uma única vez (o webhook pode chegar mais de uma vez)
  const upd = await env.DB.prepare("UPDATE pedidos SET status = 'pago', mp_payment_id = ?, pago_em = ? WHERE id = ? AND status = 'criado'").bind(String(pg.id), agora(), pedidoId).run();
  if (upd.meta && upd.meta.changes > 0) {
    await env.DB.prepare("UPDATE usuarios SET creditos = creditos + ? WHERE id = ?").bind(pedido.creditos, pedido.usuario_id).run();
    const u = await env.DB.prepare("SELECT email, creditos FROM usuarios WHERE id = ?").bind(pedido.usuario_id).first();
    try {
      await enviarEmail(env, u.email, "Recibo — créditos de análise Aysha Leilões",
        `<p>Pagamento confirmado. Obrigado!</p><p>${pedido.creditos} crédito(s) adicionados; saldo atual: ${u.creditos}.</p>
         <p>Valor: R$ ${(pedido.valor_centavos / 100).toFixed(2).replace(".", ",")} · Pedido ${pedidoId} · Pagamento Mercado Pago ${pg.id}.</p>
         <p>Use seus créditos em <a href="${env.SITE}">${env.SITE}</a>.</p>`);
    } catch (e) { /* recibo é cortesia; o crédito já está lançado */ }
  }
  return { ok: true, status: "approved" };
}

async function webhook(request, env) {
  // formatos: ?topic=payment&id=123  |  ?type=payment&data.id=123  |  corpo {action:"payment.updated", data:{id}}
  const url = new URL(request.url);
  let paymentId = url.searchParams.get("data.id") || (url.searchParams.get("topic") === "payment" ? url.searchParams.get("id") : null);
  const d = await corpo(request);
  if (!paymentId && d && d.data && d.data.id && String(d.type || d.action || "").includes("payment")) paymentId = String(d.data.id);
  if (!paymentId || !env.MP_ACCESS_TOKEN) return json({ ok: true, ignorado: true });
  const res = await confirmarPagamento(env, paymentId);
  return json(res, 200);
}

async function estadoPedido(usuario, pedidoId, env, h) {
  const p = await env.DB.prepare("SELECT id, status, creditos, valor_centavos, criado_em, pago_em FROM pedidos WHERE id = ? AND usuario_id = ?").bind(pedidoId, usuario.id).first();
  if (!p) return json({ erro: "pedido não encontrado" }, 404, h);
  if (p.status === "criado" && env.MP_ACCESS_TOKEN) {
    // a página de retorno pode chegar antes do webhook: consulta os pagamentos do pedido
    const r = await fetch(`https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(pedidoId)}&sort=date_created&criteria=desc`,
      { headers: { "Authorization": `Bearer ${env.MP_ACCESS_TOKEN}` } });
    if (r.ok) {
      const d = await r.json();
      for (const pg of d.results || []) { if (pg.status === "approved") { await confirmarPagamento(env, pg.id); break; } }
    }
    const p2 = await env.DB.prepare("SELECT id, status, creditos, valor_centavos, criado_em, pago_em FROM pedidos WHERE id = ?").bind(pedidoId).first();
    const u = await env.DB.prepare("SELECT creditos FROM usuarios WHERE id = ?").bind(usuario.id).first();
    return json({ ...p2, saldo: u.creditos }, 200, h);
  }
  const u = await env.DB.prepare("SELECT creditos FROM usuarios WHERE id = ?").bind(usuario.id).first();
  return json({ ...p, saldo: u.creditos }, 200, h);
}

// ---------------------------------------------------------------- roteamento ----------
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const h = cors(env, origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    const url = new URL(request.url);
    const rota = url.pathname.replace(/\/$/, "");
    const m = request.method;
    try {
      if (m === "POST" && rota === "/pagamento/webhook") return webhook(request, env);
      if (m === "POST" && rota === "/interno/relatorio") return gravarRelatorioInterno(request, env, h);
      if (m === "POST" && rota === "/auth/pedir") return pedirLogin(request, env, h);
      if (m === "POST" && rota === "/auth/entrar") return entrar(request, env, h);
      if (m === "POST" && rota === "/auth/sair") return sair(request, env, h);
      if (m === "GET" && rota === "/pacotes") return json({ pacotes: pacotes(env) }, 200, h);

      const usuario = await usuarioDaSessao(request, env);
      if (!usuario) return json({ erro: "faça login", precisa_login: true }, 401, h);
      if (m === "GET" && rota === "/conta") return conta(usuario, env, h);
      if (m === "POST" && rota === "/analise") return analisar(request, usuario, env, h);
      if (m === "GET" && rota.startsWith("/relatorio/")) return obterRelatorio(usuario, decodeURIComponent(rota.slice(11)), env, h);
      if (m === "POST" && rota === "/pagamento/criar") return criarPagamento(request, usuario, env, h);
      if (m === "GET" && rota.startsWith("/pagamento/estado/")) return estadoPedido(usuario, rota.slice(18), env, h);
      return json({ erro: "rota desconhecida" }, 404, h);
    } catch (e) {
      return json({ erro: "falha interna", detalhe: String(e.message || e).slice(0, 300) }, 500, h);
    }
  },
};
