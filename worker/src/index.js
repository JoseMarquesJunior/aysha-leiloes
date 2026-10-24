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
 *   POST /auth/sair_todos                      -> encerra todas as sessões do usuário
 *   POST /conta/apagar                         -> apaga a conta (LGPD)
 *   POST /interno/alerta    {assunto, texto}   -> o robô avisa o mantenedor por e-mail (header X-Interno)
 *   GET  /admin/resumo|usuarios|pedidos|relatorios, POST /admin/creditos -> só para ADMIN_EMAILS (sessão normal)
 *   GET  /conta                                -> saldo, análises liberadas, compras (autenticado)
 *   POST /analise           {id}               -> libera (grátis ou 1 crédito) e devolve o relatório, ou dispara a geração
 *   GET  /relatorio/:id                        -> relatório, se o usuário tem acesso
 *   GET  /pacotes                              -> tabela de créditos
 *   POST /pagamento/criar   {pacote}           -> cria a preferência no Mercado Pago e devolve a URL do checkout
 *   GET  /pagamento/estado/:pedido             -> status do pedido (página de retorno)
 *   POST /pagamento/webhook                    -> notificação do Mercado Pago (sem CORS)
 *   POST /interno/relatorio                    -> o robô do GitHub grava o relatório gerado (header X-Interno)
 *   GET  /interno/relatorio/:id                -> o robô relê um relatório guardado (header X-Interno)
 *
 * Segredos (wrangler secret put): GITHUB_TOKEN, INTERNO_SECRET, MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET,
 *   e-mail: GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET + GMAIL_REFRESH_TOKEN (preferido) ou BREVO_API_KEY
 * Variáveis (wrangler.toml): REPO, SITE, ORIGENS, LIMITE_IP, LIMITE_DIA, EMAIL_REMETENTE, NOME_REMETENTE, PACOTES
 * Bindings: DB (D1), LIMITES (KV)
 */

// id de imóvel: começa com letra ou dígito (nunca com "-", para não virar opção de linha de comando no robô)
const ID_OK = /^[A-Za-z0-9][\w.\-]{2,79}$/;
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SESSAO_DIAS_INATIVIDADE = 30;

// Domínios de e-mail descartável mais usados: cada conta nova ganha 1 crédito que custa dinheiro de verdade.
const DOMINIOS_DESCARTAVEIS = new Set(("10minutemail.com 10minutemail.net 10minemail.com 20minutemail.com 33mail.com guerrillamail.com guerrillamail.net guerrillamail.org guerrillamail.biz guerrillamail.de guerrillamailblock.com grr.la sharklasers.com spam4.me mailinator.com mailinator.net mailinator2.com maildrop.cc yopmail.com yopmail.fr yopmail.net cool.fr.nf jetable.fr.nf nospam.ze.tc nomail.xl.cx mega.zik.dj speed.1s.fr courriel.fr.nf moncourrier.fr.nf monemail.fr.nf monmail.fr.nf temp-mail.org temp-mail.io tempmail.com tempmail.net tempmail.dev tempmailo.com tempail.com tempr.email discard.email discardmail.com discardmail.de spamgourmet.com trashmail.com trashmail.net trashmail.me trashmail.at trashmail.io trash-mail.com trash-mail.at throwawaymail.com throwam.com fakeinbox.com fakemail.net getnada.com nada.email getairmail.com airmail.cc dispostable.com mintemail.com mytemp.email mohmal.com emailondeck.com burnermail.io mailnesia.com mailcatch.com mailexpire.com spambog.com spambog.de spambog.ru spamherelots.com harakirimail.com incognitomail.org mailnull.com e4ward.com tempinbox.com tmpmail.net tmpmail.org tmpeml.com tmail.ws tmails.net emailfake.com crazymailing.com inboxkitten.com mailsac.com mail-temp.com moakt.com moakt.cc tempmailaddress.com anonbox.net anonymbox.com wegwerfmail.de wegwerfmail.net wegwerfmail.org wegwerfemail.de einrot.com luxusmail.org mailtemp.net owlymail.com cuvox.de dayrep.com fleckens.hu gustr.com jourrapide.com rhyta.com superrito.com teleworm.us armyspy.com mailpoof.com tempmails.net emailtemporario.com.br emailtemporario.net tempmail.com.br temporario.email mailtemporario.com.br mailtemp.com.br descartavel.email emailtemp.com.br tempmail.ninja mailimate.com 1secmail.com 1secmail.net 1secmail.org dropmail.me minuteinbox.com internxt.com firemail.cc tempmailer.com tempmailer.de emailnax.com cmail.club mailhub.pro").split(" "));

function emailDescartavel(email) {
  const dominio = email.split("@")[1] || "";
  if (DOMINIOS_DESCARTAVEIS.has(dominio)) return true;
  return [...DOMINIOS_DESCARTAVEIS].some(d => dominio.endsWith("." + d));
}

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

// ---------------------------------------------------------------- e-mail --------------
/* Dois caminhos: Gmail API (os servidores do Google assinam a mensagem como gmail.com, então ela passa nas
   verificações de autenticidade mesmo sem domínio próprio; limite ~500/dia) quando GMAIL_CLIENT_ID,
   GMAIL_CLIENT_SECRET e GMAIL_REFRESH_TOKEN existem (scripts/gmail_token.py); senão, Brevo. */
function b64utf8(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return btoa(bin);
}
async function tokenGmail(env) {
  const guardado = await env.LIMITES.get("gmail:token");
  if (guardado) return guardado;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GMAIL_CLIENT_ID, client_secret: env.GMAIL_CLIENT_SECRET, refresh_token: env.GMAIL_REFRESH_TOKEN, grant_type: "refresh_token" }),
  });
  if (!r.ok) throw new Error(`Google OAuth ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  await env.LIMITES.put("gmail:token", d.access_token, { expirationTtl: Math.max(60, (d.expires_in || 3600) - 300) });
  return d.access_token;
}
/* Versão em texto simples do HTML (os filtros de spam esperam multipart/alternative; um e-mail só-HTML
   com um link é o perfil clássico de phishing). */
function textoDoHtml(html) {
  return html.replace(/<a [^>]*href="([^"]+)"[^>]*>[^<]*<\/a>/gi, "$1").replace(/<\/p>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\n{3,}/g, "\n\n").trim();
}
async function enviarGmail(env, para, assunto, html) {
  const token = await tokenGmail(env);
  const limite = "=_aysha_" + token.slice(-12).replace(/[^A-Za-z0-9]/g, "x");
  const mime = [
    `From: =?UTF-8?B?${b64utf8(env.NOME_REMETENTE || "Aysha Leilões")}?= <${env.EMAIL_REMETENTE}>`,
    `To: ${para}`,
    `Reply-To: ${env.EMAIL_REMETENTE}`,
    `Subject: =?UTF-8?B?${b64utf8(assunto)}?=`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${limite}"`,
    "",
    `--${limite}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64utf8(textoDoHtml(html)),
    `--${limite}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64utf8(html),
    `--${limite}--`,
  ].join("\r\n");
  const raw = b64utf8(mime).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST", headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ raw }),
  });
  if (!r.ok) throw new Error(`Gmail não enviou (${r.status}): ${(await r.text()).slice(0, 200)}`);
}
async function enviarEmail(env, para, assunto, html) {
  if (!env.EMAIL_REMETENTE) throw new Error("EMAIL_REMETENTE não configurado");
  if (env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN) return enviarGmail(env, para, assunto, html);
  if (!env.BREVO_API_KEY) throw new Error("envio de e-mail não configurado (Gmail ou BREVO_API_KEY)");
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ sender: { email: env.EMAIL_REMETENTE, name: env.NOME_REMETENTE || "Aysha Leilões" },
                           to: [{ email: para }], subject: assunto, htmlContent: html, textContent: textoDoHtml(html) }),
  });
  if (!r.ok) throw new Error(`e-mail não enviado (${r.status}): ${(await r.text()).slice(0, 200)}`);
}

// ---------------------------------------------------------------- autenticação --------
async function usuarioDaSessao(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const t = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!/^[0-9a-f]{64}$/.test(t)) return null;
  const s = await env.DB.prepare("SELECT u.id, u.email, u.creditos, s.expira_em FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token = ? AND s.expira_em > ?")
    .bind(t, agora()).first();
  if (!s) return null;
  // expiração por inatividade: cada uso empurra o vencimento (no máximo uma gravação por dia)
  const novaExp = new Date(Date.now() + SESSAO_DIAS_INATIVIDADE * 86400000).toISOString();
  if (Date.parse(novaExp) - Date.parse(s.expira_em) > 86400000) await env.DB.prepare("UPDATE sessoes SET expira_em = ? WHERE token = ?").bind(novaExp, t).run();
  return s;
}

async function pedirLogin(request, env, h) {
  const { email } = await corpo(request);
  const e = String(email || "").trim().toLowerCase();
  if (!EMAIL_OK.test(e) || e.length > 120) return json({ erro: "e-mail inválido" }, 400, h);
  if (emailDescartavel(e)) return json({ erro: "e-mails temporários não são aceitos; use um e-mail permanente" }, 400, h);
  const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
  if ((await contar(env, `login:${await hashIp(ip)}:${new Date().toISOString().slice(0, 13)}`, 3600)) > 10)
    return json({ erro: "muitos pedidos de login; tente mais tarde" }, 429, h);
  const t = token(24);
  await env.DB.prepare("INSERT INTO links_login (token, email, expira_em) VALUES (?, ?, ?)").bind(t, e, maisMinutos(20)).run();
  // o token vai no fragmento (#): não é enviado ao servidor do site nem fica em logs de acesso
  const link = `${env.SITE.replace(/\/$/, "")}/conta.html#token=${t}`;
  const site = env.SITE.replace(/\/$/, "");
  await enviarEmail(env, e, "Seu acesso ao Aysha Leilões",
    `<div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#1b1f24;max-width:560px">
     <p style="font-size:18px;font-weight:700;margin:0 0 12px">Aysha Leilões</p>
     <p>Olá! Você pediu acesso ao Aysha Leilões, a tabela de imóveis em leilão, licitação e venda direta de todo o Brasil, com análise do edital e da matrícula por IA.</p>
     <p>Para entrar, use o botão abaixo. O link vale por 20 minutos e só funciona uma vez.</p>
     <p style="margin:18px 0"><a href="${link}" style="background:#0b5fff;color:#fff;text-decoration:none;padding:11px 20px;border-radius:6px;font-weight:600;display:inline-block">Entrar no Aysha Leilões</a></p>
     <p style="font-size:13px;color:#5f6b76">Se o botão não abrir, copie este endereço no navegador:<br><a href="${link}" style="color:#0b5fff;word-break:break-all">${link}</a></p>
     <p style="font-size:13px;color:#5f6b76">Se você não pediu este acesso, ignore esta mensagem: ninguém entra na sua conta sem o link. Dúvidas: responda a este e-mail.</p>
     <p style="font-size:12px;color:#8a949e;margin-top:20px">Aysha Leilões · <a href="${site}" style="color:#8a949e">${site.replace(/^https?:\/\//, "")}</a> · <a href="${site}/sobre.html#contas" style="color:#8a949e">termos e privacidade</a></p>
     </div>`);
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
    // conta nova já nasce com 1 crédito: é a primeira análise grátis
    await env.DB.prepare("INSERT INTO usuarios (email, criado_em, ultimo_login, creditos, gratis_usado) VALUES (?, ?, ?, 1, 1)").bind(l.email, agora(), agora()).run();
    u = await env.DB.prepare("SELECT id FROM usuarios WHERE email = ?").bind(l.email).first();
    nova = true;
  } else {
    await env.DB.prepare("UPDATE usuarios SET ultimo_login = ? WHERE id = ?").bind(agora(), u.id).run();
  }
  const s = token(32);
  await env.DB.prepare("INSERT INTO sessoes (token, usuario_id, criado_em, expira_em) VALUES (?, ?, ?, ?)")
    .bind(s, u.id, agora(), new Date(Date.now() + SESSAO_DIAS_INATIVIDADE * 86400000).toISOString()).run();
  return json({ sessao: s, email: l.email, nova_conta: nova }, 200, h);
}

async function sair(request, env, h) {
  const auth = request.headers.get("Authorization") || "";
  const t = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (t) await env.DB.prepare("DELETE FROM sessoes WHERE token = ?").bind(t).run();
  return json({ ok: true }, 200, h);
}

async function sairDeTodos(usuario, env, h) {
  await env.DB.prepare("DELETE FROM sessoes WHERE usuario_id = ?").bind(usuario.id).run();
  return json({ ok: true }, 200, h);
}

/* Exclusão da conta (LGPD, art. 18): apaga e-mail, sessões, links e acessos. Os pedidos pagos ficam sem
   vínculo com o e-mail (só o id numérico), porque registros de venda precisam ser guardados. */
async function apagarConta(usuario, env, h) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessoes WHERE usuario_id = ?").bind(usuario.id),
    env.DB.prepare("DELETE FROM acessos WHERE usuario_id = ?").bind(usuario.id),
    env.DB.prepare("DELETE FROM analises_pendentes WHERE usuario_id = ?").bind(usuario.id),
    env.DB.prepare("DELETE FROM links_login WHERE email = ?").bind(usuario.email),
    env.DB.prepare("DELETE FROM usuarios WHERE id = ?").bind(usuario.id),
  ]);
  return json({ ok: true }, 200, h);
}

/* Diagnóstico: o robô testa se uma URL de documento responde a partir da rede da Cloudflare (fontes que
   bloqueiam datacenters, como a Caixa). Só com o segredo interno; devolve status, tipo e tamanho, nunca o conteúdo. */
async function sondaInterna(request, env, h, url) {
  if (request.headers.get("X-Interno") !== env.INTERNO_SECRET) return json({ erro: "não autorizado" }, 401, h);
  const alvo = url.searchParams.get("url") || "";
  if (!/^https:\/\/[\w.\-]+\.(gov\.br|com\.br|leilao\.br|org\.br|com)\//.test(alvo)) return json({ erro: "url inválida" }, 400, h);
  try {
    const r = await fetch(alvo, { headers: { "User-Agent": "aysha-leiloes/0.1 (+https://github.com/JoseMarquesJunior/aysha-leiloes)" }, redirect: "follow" });
    const corpo = await r.arrayBuffer();
    const inicio = new TextDecoder().decode(corpo.slice(0, 8));
    return json({ status: r.status, tipo: r.headers.get("content-type"), bytes: corpo.byteLength, inicio }, 200, h);
  } catch (e) { return json({ erro: String(e.message).slice(0, 200) }, 502, h); }
}

/* Aviso ao mantenedor (custo do dia acima do teto etc.), enviado pelo robô com o segredo interno. */
async function alertaInterno(request, env, h) {
  if (request.headers.get("X-Interno") !== env.INTERNO_SECRET) return json({ erro: "não autorizado" }, 401, h);
  const d = await corpo(request);
  if (!d.assunto || !d.texto) return json({ erro: "faltam assunto/texto" }, 400, h);
  await enviarEmail(env, env.ALERTA_EMAIL || env.EMAIL_REMETENTE, `[Aysha Leilões] ${String(d.assunto).slice(0, 120)}`, `<pre>${String(d.texto).slice(0, 5000).replace(/</g, "&lt;")}</pre>`);
  return json({ ok: true }, 200, h);
}

async function conta(usuario, env, h) {
  const analises = (await env.DB.prepare(
    "SELECT a.id_imovel, a.liberado_em, a.origem, r.gerado_em FROM acessos a LEFT JOIN relatorios r ON r.id_imovel = a.id_imovel WHERE a.usuario_id = ? ORDER BY a.liberado_em DESC LIMIT 200")
    .bind(usuario.id).all()).results;
  const compras = (await env.DB.prepare(
    "SELECT id, pacote, creditos, valor_centavos, status, criado_em, pago_em FROM pedidos WHERE usuario_id = ? ORDER BY criado_em DESC LIMIT 100")
    .bind(usuario.id).all()).results;
  return json({ email: usuario.email, creditos: usuario.creditos, analises, compras, pacotes: pacotes(env) }, 200, h);
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
  // cobra 1 crédito (toda conta nova nasce com 1: a primeira análise é grátis)
  const origem = "credito";
  const res = await env.DB.prepare("UPDATE usuarios SET creditos = creditos - 1 WHERE id = ? AND creditos > 0").bind(usuario.id).run();
  if (!res.meta || res.meta.changes === 0) return json({ erro: "sem créditos", precisa_comprar: true }, 402, h);
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

async function lerRelatorioInterno(request, id, env, h) {
  if (request.headers.get("X-Interno") !== env.INTERNO_SECRET) return json({ erro: "não autorizado" }, 401, h);
  if (!ID_OK.test(id)) return json({ erro: "id inválido" }, 400, h);
  const r = await env.DB.prepare("SELECT * FROM relatorios WHERE id_imovel = ?").bind(id).first();
  return r ? json(relatorioSaida(r), 200, h) : json({ erro: "não existe" }, 404, h);
}

// ---------------------------------------------------------------- administração -------
function ehAdmin(usuario, env) {
  return (env.ADMIN_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean).includes(usuario.email.toLowerCase());
}
async function adminResumo(env, h) {
  const um = sql => env.DB.prepare(sql).first();
  const semana = new Date(Date.now() - 7 * 86400000).toISOString();
  const [u, u7, p, r, a, a7, pend] = await Promise.all([
    um("SELECT COUNT(*) n, COALESCE(SUM(creditos), 0) c FROM usuarios"),
    env.DB.prepare("SELECT COUNT(*) n FROM usuarios WHERE criado_em >= ?").bind(semana).first(),
    um("SELECT COUNT(*) n, COALESCE(SUM(valor_centavos), 0) t FROM pedidos WHERE status = 'pago'"),
    um("SELECT COUNT(*) n, COALESCE(SUM(custo_usd), 0) c FROM relatorios"),
    um("SELECT COUNT(*) n FROM acessos"),
    env.DB.prepare("SELECT COUNT(*) n FROM acessos WHERE liberado_em >= ?").bind(semana).first(),
    um("SELECT COUNT(*) n FROM analises_pendentes"),
  ]);
  return json({ usuarios: u.n, usuarios_7d: u7.n, creditos_em_circulacao: u.c, pedidos_pagos: p.n, receita_centavos: p.t,
                relatorios: r.n, custo_usd: r.c, acessos: a.n, acessos_7d: a7.n, pendentes: pend.n }, 200, h);
}
async function adminUsuarios(url, env, h) {
  const q = (url.searchParams.get("q") || "").slice(0, 80);
  const total = (await env.DB.prepare("SELECT COUNT(*) n FROM usuarios WHERE email LIKE ?").bind(`%${q}%`).first()).n;
  const rows = (await env.DB.prepare(
    `SELECT u.id, u.email, u.criado_em, u.ultimo_login, u.creditos,
            (SELECT COUNT(*) FROM acessos a WHERE a.usuario_id = u.id) analises,
            (SELECT COUNT(*) FROM pedidos p WHERE p.usuario_id = u.id AND p.status = 'pago') compras,
            (SELECT COALESCE(SUM(valor_centavos), 0) FROM pedidos p WHERE p.usuario_id = u.id AND p.status = 'pago') pago
     FROM usuarios u WHERE u.email LIKE ? ORDER BY u.criado_em DESC LIMIT 300`).bind(`%${q}%`).all()).results;
  return json({ total, usuarios: rows }, 200, h);
}
async function adminPedidos(env, h) {
  const rows = (await env.DB.prepare(
    "SELECT p.id, p.pacote, p.creditos, p.valor_centavos, p.status, p.mp_payment_id, p.criado_em, p.pago_em, u.email FROM pedidos p LEFT JOIN usuarios u ON u.id = p.usuario_id ORDER BY p.criado_em DESC LIMIT 300").all()).results;
  return json({ pedidos: rows }, 200, h);
}
async function adminRelatorios(env, h) {
  const rows = (await env.DB.prepare(
    "SELECT r.id_imovel, r.gerado_em, r.modelo, r.custo_usd, r.documentos_lidos, (SELECT COUNT(*) FROM acessos a WHERE a.id_imovel = r.id_imovel) acessos FROM relatorios r ORDER BY r.gerado_em DESC LIMIT 300").all()).results;
  const pendentes = (await env.DB.prepare(
    "SELECT p.id_imovel, p.pedido_em, u.email FROM analises_pendentes p LEFT JOIN usuarios u ON u.id = p.usuario_id ORDER BY p.pedido_em DESC").all()).results;
  return json({ relatorios: rows, pendentes }, 200, h);
}
/* Ajuste manual de créditos (cortesia, reembolso, teste). Fica registrado como pedido com status 'cortesia'. */
async function adminCreditos(request, admin, env, h) {
  const d = await corpo(request);
  const email = String(d.email || "").trim().toLowerCase();
  const delta = Number.isInteger(d.delta) ? d.delta : parseInt(d.delta, 10);
  if (!EMAIL_OK.test(email) || !Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 1000) return json({ erro: "e-mail ou quantidade inválidos" }, 400, h);
  const u = await env.DB.prepare("SELECT id, creditos FROM usuarios WHERE email = ?").bind(email).first();
  if (!u) return json({ erro: "usuário não encontrado" }, 404, h);
  await env.DB.batch([
    env.DB.prepare("UPDATE usuarios SET creditos = MAX(0, creditos + ?) WHERE id = ?").bind(delta, u.id),
    env.DB.prepare("INSERT INTO pedidos (id, usuario_id, pacote, creditos, valor_centavos, status, mp_preference_id, criado_em, pago_em) VALUES (?, ?, ?, ?, 0, 'cortesia', ?, ?, ?)")
      .bind(crypto.randomUUID(), u.id, `ajuste: ${String(d.motivo || "").slice(0, 80) || "sem motivo"} (${admin.email})`, delta, null, agora(), agora()),
  ]);
  const novo = await env.DB.prepare("SELECT creditos FROM usuarios WHERE id = ?").bind(u.id).first();
  return json({ ok: true, creditos: novo.creditos }, 200, h);
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

/* Assinatura do Mercado Pago: header x-signature "ts=<ts>,v1=<hmac>", com HMAC-SHA256(segredo) sobre o
   manifesto "id:<data.id em minúsculas>;request-id:<x-request-id>;ts:<ts>;" (as partes sem valor são omitidas).
   Com MP_WEBHOOK_SECRET configurado, notificações sem assinatura válida são recusadas. */
async function assinaturaValida(request, env, url) {
  if (!env.MP_WEBHOOK_SECRET) return false;  // sem segredo configurado, nenhuma notificação é aceita
  const sig = request.headers.get("x-signature") || "";
  const partes = Object.fromEntries(sig.split(",").map(p => p.trim().split("=").map(s => s.trim())).filter(p => p.length === 2));
  if (!partes.ts || !partes.v1) return false;
  const dataId = url.searchParams.get("data.id") || "";
  const requestId = request.headers.get("x-request-id") || "";
  let manifesto = "";
  if (dataId) manifesto += `id:${/^[a-zA-Z0-9]+$/.test(dataId) ? dataId.toLowerCase() : dataId};`;
  if (requestId) manifesto += `request-id:${requestId};`;
  manifesto += `ts:${partes.ts};`;
  const chave = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.MP_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(manifesto));
  const esperado = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, "0")).join("");
  if (esperado.length !== partes.v1.length) return false;
  let dif = 0;
  for (let i = 0; i < esperado.length; i++) dif |= esperado.charCodeAt(i) ^ partes.v1.charCodeAt(i);
  return dif === 0;
}

async function webhook(request, env) {
  // formatos: ?topic=payment&id=123  |  ?type=payment&data.id=123  |  corpo {action:"payment.updated", data:{id}}
  const url = new URL(request.url);
  if (!(await assinaturaValida(request, env, url))) return json({ erro: "assinatura inválida" }, 401);
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
      if (m === "GET" && rota.startsWith("/interno/relatorio/")) return lerRelatorioInterno(request, decodeURIComponent(rota.slice(19)), env, h);
      if (m === "POST" && rota === "/auth/pedir") return pedirLogin(request, env, h);
      if (m === "POST" && rota === "/auth/entrar") return entrar(request, env, h);
      if (m === "POST" && rota === "/auth/sair") return sair(request, env, h);
      if (m === "POST" && rota === "/interno/alerta") return alertaInterno(request, env, h);
      if (m === "GET" && rota === "/interno/sonda") return sondaInterna(request, env, h, url);
      if (m === "GET" && rota === "/pacotes") return json({ pacotes: pacotes(env) }, 200, h);

      const usuario = await usuarioDaSessao(request, env);
      if (!usuario) return json({ erro: "faça login", precisa_login: true }, 401, h);
      if (m === "GET" && rota === "/conta") return conta(usuario, env, h);
      if (m === "POST" && rota === "/auth/sair_todos") return sairDeTodos(usuario, env, h);
      if (m === "POST" && rota === "/conta/apagar") return apagarConta(usuario, env, h);
      if (m === "POST" && rota === "/analise") return analisar(request, usuario, env, h);
      if (m === "GET" && rota.startsWith("/relatorio/")) return obterRelatorio(usuario, decodeURIComponent(rota.slice(11)), env, h);
      if (m === "POST" && rota === "/pagamento/criar") return criarPagamento(request, usuario, env, h);
      if (rota.startsWith("/admin/")) {
        if (!ehAdmin(usuario, env)) return json({ erro: "sem acesso" }, 403, h);
        if (m === "GET" && rota === "/admin/resumo") return adminResumo(env, h);
        if (m === "GET" && rota === "/admin/usuarios") return adminUsuarios(url, env, h);
        if (m === "GET" && rota === "/admin/pedidos") return adminPedidos(env, h);
        if (m === "GET" && rota === "/admin/relatorios") return adminRelatorios(env, h);
        if (m === "POST" && rota === "/admin/creditos") return adminCreditos(request, usuario, env, h);
      }
      if (m === "GET" && rota.startsWith("/pagamento/estado/")) return estadoPedido(usuario, rota.slice(18), env, h);
      return json({ erro: "rota desconhecida" }, 404, h);
    } catch (e) {
      return json({ erro: "falha interna", detalhe: String(e.message || e).slice(0, 300) }, 500, h);
    }
  },
};
