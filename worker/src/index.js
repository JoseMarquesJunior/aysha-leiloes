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
 *   GET  /agenda | POST /agenda {id, uf, titulo, datas, hora, lembretes} | POST /agenda/remover {id}
 *   GET  /alertas | POST /alertas {uf, cidade, tipo, desconto_min, valor_max} | POST /alertas/remover {id}
 *   GET  /alertas/descadastrar?chave=...        -> remove o alerta pelo link do e-mail (sem login)
 *   POST /geo               {id, uf}           -> geocodifica o endereço na 1ª visita à ficha (guarda no D1)
 *   GET  /interno/geo                          -> a coleta puxa as localizações descobertas (header X-Interno)
 *   GET  /interno/metricas?desde=&ate=         -> agregados da leitura L0/L1 do baseline, sem dados pessoais (header X-Interno)
 *   cron diário (08:00 Brasília): lembretes por e-mail dos leilões da agenda e alertas de imóveis novos;
 *     POST /interno/lembretes e POST /interno/alertas forçam o envio
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
 *   e-mail: BREVO_API_KEY (quando EMAIL_VIA = "brevo") ou GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET + GMAIL_REFRESH_TOKEN
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
  // EMAIL_VIA = "brevo" força o Brevo mesmo com os secrets do Gmail presentes (remetente no domínio próprio)
  if (env.EMAIL_VIA !== "brevo" && env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN) return enviarGmail(env, para, assunto, html);
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

// ---------------------------------------------------------------- agenda de leilões ---
const DATA_OK = /^\d{4}-\d{2}-\d{2}$/;
const HORA_OK = /^([01]\d|2[0-3]):[0-5]\d$/;
function hojeBrasilia() { return new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10); }
function somarDias(iso, dias) { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + dias); return d.toISOString().slice(0, 10); }
function dataBr(iso) { return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : ""; }
function lembretesValidos(v) {
  const lista = Array.isArray(v) ? v : [7, 1, 0];
  return [...new Set(lista.filter(x => Number.isInteger(x) && x >= 0 && x <= 60))].sort((a, b) => b - a);
}
function itemAgenda(a) {
  return { id: a.id_imovel, uf: a.uf, titulo: a.titulo, data_leilao: a.data_leilao, data_segunda_praca: a.data_segunda_praca, hora: a.hora,
           lembretes: JSON.parse(a.lembretes || "[7,1,0]"), enviados: JSON.parse(a.enviados || "[]"), criado_em: a.criado_em, atualizado_em: a.atualizado_em };
}
async function agendaListar(usuario, env, h) {
  const rows = (await env.DB.prepare("SELECT * FROM agenda WHERE usuario_id = ? ORDER BY COALESCE(data_leilao, data_segunda_praca, '9999') ASC").bind(usuario.id).all()).results;
  return json({ itens: rows.map(itemAgenda) }, 200, h);
}
/* Cria ou atualiza um item. Os dados do imóvel (título, datas) vêm do site, que tem a base; a página da
   agenda reenvia quando a coleta muda as datas. */
async function agendaSalvar(request, usuario, env, h) {
  const d = await corpo(request);
  const id = String(d.id || "");
  if (!ID_OK.test(id)) return json({ erro: "id inválido" }, 400, h);
  const dl = DATA_OK.test(d.data_leilao || "") ? d.data_leilao : null;
  const d2 = DATA_OK.test(d.data_segunda_praca || "") ? d.data_segunda_praca : null;
  const hora = HORA_OK.test(d.hora || "") ? d.hora : null;
  const uf = /^[A-Z]{2}$/.test(d.uf || "") ? d.uf : null;
  const titulo = String(d.titulo || id).slice(0, 160);
  const atual = await env.DB.prepare("SELECT lembretes, hora FROM agenda WHERE usuario_id = ? AND id_imovel = ?").bind(usuario.id, id).first();
  const lembretes = JSON.stringify(d.lembretes !== undefined ? lembretesValidos(d.lembretes) : (atual ? JSON.parse(atual.lembretes) : [7, 1, 0]));
  const horaFinal = d.hora !== undefined ? hora : (atual ? atual.hora : null);
  await env.DB.prepare(
    `INSERT INTO agenda (usuario_id, id_imovel, uf, titulo, data_leilao, data_segunda_praca, hora, lembretes, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(usuario_id, id_imovel) DO UPDATE SET uf = excluded.uf, titulo = excluded.titulo, data_leilao = excluded.data_leilao,
       data_segunda_praca = excluded.data_segunda_praca, hora = excluded.hora, lembretes = excluded.lembretes, atualizado_em = excluded.atualizado_em`)
    .bind(usuario.id, id, uf, titulo, dl, d2, horaFinal, lembretes, agora(), agora()).run();
  const row = await env.DB.prepare("SELECT * FROM agenda WHERE usuario_id = ? AND id_imovel = ?").bind(usuario.id, id).first();
  return json({ ok: true, item: itemAgenda(row) }, 200, h);
}
async function agendaRemover(request, usuario, env, h) {
  const d = await corpo(request);
  if (!ID_OK.test(String(d.id || ""))) return json({ erro: "id inválido" }, 400, h);
  await env.DB.prepare("DELETE FROM agenda WHERE usuario_id = ? AND id_imovel = ?").bind(usuario.id, d.id).run();
  return json({ ok: true }, 200, h);
}
/* Gatilho diário (cron em wrangler.toml, 08:00 de Brasília): envia por e-mail os lembretes do dia.
   Para cada item e cada praça, um lembrete N dias antes quando N está em `lembretes` e ainda não foi enviado. */
async function enviarLembretes(env) {
  const hoje = hojeBrasilia();
  const rows = (await env.DB.prepare(
    `SELECT a.*, u.email FROM agenda a JOIN usuarios u ON u.id = a.usuario_id
     WHERE (a.data_leilao IS NOT NULL AND a.data_leilao >= ?) OR (a.data_segunda_praca IS NOT NULL AND a.data_segunda_praca >= ?)`).bind(hoje, hoje).all()).results;
  let enviados = 0;
  const site = (env.SITE || "").replace(/\/$/, "");
  for (const a of rows) {
    const lembretes = JSON.parse(a.lembretes || "[]"), feitos = JSON.parse(a.enviados || "[]");
    const novos = [];
    for (const [rotulo, data] of [["1ª praça", a.data_leilao], ["2ª praça", a.data_segunda_praca]]) {
      if (!data || data < hoje) continue;
      for (const n of lembretes) {
        const chave = `${data}:${n}`;
        if (somarDias(data, -n) !== hoje || feitos.includes(chave)) continue;
        const quando = n === 0 ? "é hoje" : n === 1 ? "é amanhã" : `é em ${n} dias`;
        const hora = a.hora ? ` às ${a.hora}` : "";
        try {
          await enviarEmail(env, a.email, `Leilão ${quando}: ${a.titulo}`,
            `<div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#1b1f24;max-width:560px">
             <p style="font-size:18px;font-weight:700;margin:0 0 12px">Aysha Leilões · lembrete</p>
             <p>O leilão de <b>${a.titulo.replace(/</g, "&lt;")}</b> (${rotulo}) ${quando}: <b>${dataBr(data)}${hora}</b>.</p>
             <p style="margin:18px 0"><a href="${site}/imovel.html?id=${encodeURIComponent(a.id_imovel)}&uf=${a.uf || ""}" style="background:#0b5fff;color:#fff;text-decoration:none;padding:11px 20px;border-radius:6px;font-weight:600;display:inline-block">Abrir a ficha do imóvel</a></p>
             <p style="font-size:13px;color:#5f6b76">Confira a data e o horário no edital: a fonte pode alterar o leilão. Para parar os lembretes, remova o imóvel da sua <a href="${site}/agenda.html">agenda</a>.</p>
             </div>`);
          novos.push(chave); enviados++;
        } catch (e) { /* tenta de novo amanhã se ainda couber */ }
      }
    }
    if (novos.length) await env.DB.prepare("UPDATE agenda SET enviados = ? WHERE usuario_id = ? AND id_imovel = ?").bind(JSON.stringify(feitos.concat(novos)), a.usuario_id, a.id_imovel).run();
  }
  return enviados;
}

// ---------------------------------------------------------------- alertas de imóveis --
/* "Me avise de imóveis novos em [UF/cidade] com desconto acima de X%". O cron diário cruza os eventos
   `novo` e `mudou_preco` (só quedas) que o site publica em data/historico.json com os filtros de cada
   alerta, busca os detalhes em data/og_<UF>.json e envia um resumo por e-mail. A base continua no site:
   o Worker não guarda imóveis, só os filtros. */
const UFS = new Set("AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO".split(" "));
const TIPOS_IMOVEL = new Set(["apartamento", "casa", "terreno", "comercial", "rural", "outro"]);
const MAX_ALERTAS = 5;
function semAcento(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim(); }
function capitalizar(s) { return s ? s[0].toUpperCase() + s.slice(1) : ""; }
function escHtml(s) { return String(s ?? "").replace(/</g, "&lt;"); }
function reaisInteiro(v) { return "R$ " + Math.round(v).toLocaleString("pt-BR"); }
function itemAlerta(a) {
  return { id: a.id, uf: a.uf, cidade: a.cidade, tipo: a.tipo, desconto_min: a.desconto_min, valor_max: a.valor_max, criado_em: a.criado_em };
}
async function alertasListar(usuario, env, h) {
  const rows = (await env.DB.prepare("SELECT * FROM alertas WHERE usuario_id = ? ORDER BY id").bind(usuario.id).all()).results;
  return json({ alertas: rows.map(itemAlerta), maximo: MAX_ALERTAS }, 200, h);
}
async function alertaCriar(request, usuario, env, h) {
  const d = await corpo(request);
  const uf = String(d.uf || "").toUpperCase();
  if (!UFS.has(uf)) return json({ erro: "escolha o estado" }, 400, h);
  const cidade = String(d.cidade || "").trim().slice(0, 80) || null;
  const tipo = TIPOS_IMOVEL.has(String(d.tipo || "")) ? String(d.tipo) : null;
  const descontoMin = Number.isInteger(d.desconto_min) && d.desconto_min >= 1 && d.desconto_min <= 95 ? d.desconto_min : null;
  const valorMax = Number.isInteger(d.valor_max) && d.valor_max >= 10000 && d.valor_max <= 100000000 ? d.valor_max : null;
  const n = (await env.DB.prepare("SELECT COUNT(*) n FROM alertas WHERE usuario_id = ?").bind(usuario.id).first()).n;
  if (n >= MAX_ALERTAS) return json({ erro: `máximo de ${MAX_ALERTAS} alertas por conta; remova um para criar outro` }, 400, h);
  await env.DB.prepare("INSERT INTO alertas (usuario_id, uf, cidade, tipo, desconto_min, valor_max, chave, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(usuario.id, uf, cidade, tipo, descontoMin, valorMax, token(16), agora()).run();
  return alertasListar(usuario, env, h);
}
async function alertaRemover(request, usuario, env, h) {
  const d = await corpo(request);
  await env.DB.prepare("DELETE FROM alertas WHERE usuario_id = ? AND id = ?").bind(usuario.id, parseInt(d.id, 10) || 0).run();
  return alertasListar(usuario, env, h);
}
/* Descadastro de 1 clique (LGPD): o link do e-mail remove o alerta sem exigir login. */
async function alertaDescadastrar(url, env) {
  const chave = url.searchParams.get("chave") || "";
  const site = (env.SITE || "").replace(/\/$/, "");
  const pagina = (msg) => new Response(
    `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Aysha Leilões</title>
     <body style="font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:480px;margin:80px auto;padding:0 16px;text-align:center;color:#1b1f24">
     <p style="font-size:18px;font-weight:700">Aysha Leilões</p><p>${msg}</p>
     <p><a href="${site}/conta.html#alertas" style="color:#0b5fff">gerenciar meus alertas</a> · <a href="${site}" style="color:#0b5fff">voltar ao site</a></p></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } });
  if (!/^[0-9a-f]{32}$/.test(chave)) return pagina("Link de descadastro inválido.");
  const res = await env.DB.prepare("DELETE FROM alertas WHERE chave = ?").bind(chave).run();
  return pagina(res.meta && res.meta.changes ? "Pronto: você não vai mais receber este alerta." : "Este alerta já tinha sido removido.");
}
/* Gatilho diário: para cada alerta, os eventos ainda não cobertos (data > ultimo_envio) que casam com os
   filtros viram um e-mail com até 12 imóveis, ordenados por desconto. `ultimo_envio` guarda a última data
   de evento processada, então nada sai duas vezes mesmo se o cron rodar de novo. */
async function enviarAlertasImoveis(env) {
  const alertas = (await env.DB.prepare("SELECT a.*, u.email FROM alertas a JOIN usuarios u ON u.id = a.usuario_id ORDER BY a.id").all()).results;
  if (!alertas.length) return 0;
  const site = (env.SITE || "").replace(/\/$/, "");
  const api = (env.URL_API || "").replace(/\/$/, "");
  let eventos;
  try {
    const r = await fetch(`${site}/data/historico.json`);
    if (!r.ok) return 0;
    eventos = (await r.json()).eventos || [];
  } catch { return 0; }
  const maxData = eventos.reduce((m, e) => (e.data > m ? e.data : m), "");
  if (!maxData) return 0;
  const ogPorUf = {};
  const og = async (uf) => {
    if (!(uf in ogPorUf)) {
      try { const r = await fetch(`${site}/data/og_${uf}.json`); ogPorUf[uf] = r.ok ? await r.json() : {}; }
      catch { ogPorUf[uf] = {}; }
    }
    return ogPorUf[uf];
  };
  let enviados = 0;
  for (const a of alertas) {
    // primeiro envio cobre só o último dia de eventos, para não despejar o histórico inteiro
    const desde = a.ultimo_envio || somarDias(maxData, -1);
    if (maxData <= desde) continue;
    const mapa = await og(a.uf);
    const vistos = new Set(), itens = [];
    for (const e of eventos) {
      if (e.data <= desde || vistos.has(e.id)) continue;
      const queda = e.tipo === "mudou_preco" && e.de > 0 && e.para > 0 && e.para < e.de;
      if (e.tipo !== "novo" && !queda) continue;
      const r = mapa[e.id];
      if (!r) continue;  // de outra UF, ou já inativo
      if (a.cidade && semAcento(r.c) !== semAcento(a.cidade)) continue;
      if (a.tipo && (r.t || "") !== a.tipo) continue;
      if (a.desconto_min != null && !(r.d >= a.desconto_min)) continue;
      if (a.valor_max != null && !(r.v > 0 && r.v <= a.valor_max)) continue;
      vistos.add(e.id);
      itens.push({ id: e.id, r, queda, de: e.de });
    }
    const cobrir = () => env.DB.prepare("UPDATE alertas SET ultimo_envio = ? WHERE id = ?").bind(maxData, a.id).run();
    if (!itens.length) { await cobrir(); continue; }
    if (enviados >= 40) continue;  // teto por execução (o plano gratuito limita os fetch()); sem cobrir(): sai amanhã
    itens.sort((x, y) => (y.r.d || 0) - (x.r.d || 0));
    const onde = a.cidade ? `${a.cidade}/${a.uf}` : a.uf;
    const filtros = [a.tipo ? `${capitalizar(a.tipo)}s` : "Imóveis", `em ${onde}`];
    if (a.desconto_min) filtros.push(`desconto de ${a.desconto_min}% ou mais`);
    if (a.valor_max) filtros.push(`até ${reaisInteiro(a.valor_max)}`);
    const linhas = itens.slice(0, 12).map(({ id, r, queda, de }) => {
      const nome = [capitalizar(r.t) || "Imóvel", r.b, a.cidade ? "" : r.c].filter(Boolean).join(" · ");
      const detalhes = [r.v > 0 ? reaisInteiro(r.v) : "", r.d > 0 ? `${Math.round(r.d)}% abaixo da avaliação` : "",
                        queda ? `baixou de ${reaisInteiro(de)}` : "novo no site", r.dl ? `leilão ${dataBr(r.dl)}` : ""].filter(Boolean).join(" · ");
      return `<li style="margin:0 0 10px"><a href="${site}/imovel.html?id=${encodeURIComponent(id)}&uf=${a.uf}" style="color:#0b5fff;font-weight:600">${escHtml(nome)}</a><br><span style="color:#5f6b76">${escHtml(detalhes)}</span></li>`;
    }).join("");
    const mais = itens.length > 12 ? `<p>…e mais ${itens.length - 12}. <a href="${site}/leiloes/${a.uf}/" style="color:#0b5fff">Veja todos em ${a.uf}</a>.</p>` : "";
    try {
      await enviarEmail(env, a.email, `${itens.length} novidade${itens.length > 1 ? "s" : ""} em ${onde} — imóveis em leilão`,
        `<div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#1b1f24;max-width:560px">
         <p style="font-size:18px;font-weight:700;margin:0 0 12px">Aysha Leilões · seu alerta</p>
         <p>${escHtml(filtros.join(", "))}:</p>
         <ul style="padding-left:18px;margin:14px 0">${linhas}</ul>${mais}
         <p style="font-size:13px;color:#5f6b76;margin-top:20px">Confira sempre o edital: a fonte pode alterar valores e datas.
         <a href="${site}/conta.html#alertas" style="color:#5f6b76">Gerenciar meus alertas</a> ·
         <a href="${api}/alertas/descadastrar?chave=${a.chave}" style="color:#5f6b76">não quero mais este alerta</a></p>
         </div>`);
      enviados++;
      await cobrir();
    } catch (e) { /* envio falhou e ultimo_envio não avançou: os mesmos itens tentam de novo amanhã */ }
  }
  return enviados;
}

// ---------------------------------------------------------------- geocodificação sob demanda --
/* A ficha chama POST /geo na primeira visita de um imóvel com endereço e localização aproximada.
   O Worker lê o endereço na base publicada do site (nunca no corpo do pedido, para ninguém envenenar o
   mapa), geocodifica no Nominatim com as mesmas validações do coletor (collector/geocode.py) e guarda o
   ponto no D1; a coleta diária incorpora os pontos à base (GET /interno/geo). Falhas definitivas também
   ficam guardadas, para não repetir a consulta a cada visita. */
const GEO_TIPOS_LARGOS = new Set([  // resultado que é só o bairro/cidade: não vale como precisão "endereco"
  "suburb", "neighbourhood", "quarter", "hamlet", "village", "locality", "borough", "city_district",
  "city", "town", "municipality", "administrative", "county",
]);
const GEO_PALAVRAS_VIA = new Set(["rua", "avenida", "av", "r", "alameda", "travessa", "praca", "estrada", "rodovia", "ladeira", "beco", "largo"]);
/* Mantém logradouro e número; descarta lote/quadra/bloco/apto, que o Nominatim não entende. */
function limparEndereco(endereco) {
  if (!endereco) return null;
  let t = String(endereco).trim();
  t = t.replace(/\b(n|nº|n°|num|numero)\.?\s*(sn|s\/n)\b.*$/i, "");
  t = t.replace(/,?\s*\b(lt|lote|qd|quadra|bl|bloco|ap|apto|apt|apartamento|cs|casa|sl|sala|lj|loja|cj|conj|conjunto|ed|edif|edificio)\b.*$/i, "");
  t = t.replace(/\b(n|nº|n°|num|numero)\.?\s*(\d+)/gi, "$2");
  t = t.replace(/\s+/g, " ").replace(/^[\s,.\-]+|[\s,.\-]+$/g, "");
  return t || null;
}
/* Confere se alguma palavra significativa do logradouro aparece no resultado (evita rua trocada). */
function ruaBate(endereco, nomeResultado) {
  const palavras = (semAcento(endereco).match(/[a-z]{3,}/g) || []).filter(p => !GEO_PALAVRAS_VIA.has(p));
  const alvo = semAcento(nomeResultado);
  return palavras.length ? palavras.some(p => alvo.includes(p)) : true;
}
function guardarGeo(env, id, lat, lng, consulta, precisao) {
  return env.DB.prepare("INSERT OR REPLACE INTO geo_imovel (id, lat, lng, precisao, consulta, criado_em) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, lat, lng, precisao || null, consulta || null, agora()).run();
}
async function geoDescobrir(request, env, h) {
  const d = await corpo(request);
  const id = String(d.id || ""), uf = String(d.uf || "").toUpperCase();
  if (!ID_OK.test(id) || !UFS.has(uf)) return json({ erro: "id ou uf inválidos" }, 400, h);
  const guardado = await env.DB.prepare("SELECT lat, lng, precisao FROM geo_imovel WHERE id = ?").bind(id).first();
  if (guardado) return json({ lat: guardado.lat, lng: guardado.lng, precisao: guardado.precisao }, 200, h);
  // tetos diários: por IP (abuso) e global (a política do Nominatim pede uso leve)
  const dia = agora().slice(0, 10);
  const ip = await hashIp(request.headers.get("CF-Connecting-IP") || "");
  if ((await contar(env, `geo:${ip}:${dia}`, 86400)) > 20) return json({ erro: "limite diário" }, 429, h);
  if ((await contar(env, `geo:dia:${dia}`, 86400)) > 200) return json({ precisao: null, tentar_depois: true }, 200, h);
  const site = (env.SITE || "").replace(/\/$/, "");
  let r = null;
  try {
    const resp = await fetch(`${site}/data/imoveis_${uf}.json`, { cf: { cacheEverything: true, cacheTtl: 3600 } });
    if (resp.ok) r = ((await resp.json()) || []).find(x => x.id === id);
  } catch { /* site fora do ar: tenta na próxima visita */ }
  if (!r || !r.endereco || !r.cidade) return json({ precisao: null }, 200, h);
  if (r.geo_precisao === "endereco") return json({ lat: r.lat, lng: r.lng, precisao: "endereco" }, 200, h);
  const endereco = limparEndereco(r.endereco);
  if (!endereco) { await guardarGeo(env, id, null, null, null); return json({ precisao: null }, 200, h); }
  const consulta = [endereco, r.bairro, r.cidade, uf, "Brasil"].filter(Boolean).join(", ");
  let dados;
  try {
    const n = await fetch(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q: consulta, format: "jsonv2", limit: "1", countrycodes: "br" })}`,
      { headers: { "User-Agent": "aysha-leiloes/1.0 (https://ayshaleiloes.com.br; contato@ayshaleiloes.com.br)" } });
    if (!n.ok) return json({ precisao: null, tentar_depois: true }, 200, h);  // 429/5xx: nada guardado, tenta depois
    dados = await n.json();
  } catch { return json({ precisao: null, tentar_depois: true }, 200, h); }
  const res = Array.isArray(dados) ? dados[0] : null;
  const tipo = res ? String(res.addresstype || res.type || "") : "";
  if (!res || GEO_TIPOS_LARGOS.has(tipo) || !ruaBate(endereco, res.display_name || "")) {
    await guardarGeo(env, id, null, null, consulta);  // sem resultado confiável: não repete a consulta
    return json({ precisao: null }, 200, h);
  }
  const lat = parseFloat(res.lat), lng = parseFloat(res.lon);
  await guardarGeo(env, id, lat, lng, consulta, "endereco");
  return json({ lat, lng, precisao: "endereco" }, 200, h);
}
async function geoInterno(request, env, h) {
  if (request.headers.get("X-Interno") !== env.INTERNO_SECRET) return json({ erro: "não autorizado" }, 401, h);
  const rows = (await env.DB.prepare("SELECT id, lat, lng, precisao, criado_em FROM geo_imovel WHERE precisao = 'endereco' ORDER BY criado_em").all()).results;
  return json({ pontos: rows }, 200, h);
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

// ---------------------------------------------------------------- métricas internas ---
/* GET /interno/metricas?desde=ISO&ate=ISO (header X-Interno): os agregados que a leitura L0/L1 do
   baseline pede (docs/business/baseline-ciclo-01.md, seção 2), consumidos por scripts/coleta_metricas.py.
   Devolve só contagens e valores — nenhum e-mail ou nome. As contas de ADMIN_EMAILS e EMAILS_TESTE
   (contas do mantenedor só para testar o funil, sem acesso de admin) saem das contagens — as compras
   delas viram "teste_do_mantenedor"; pedidos 'cortesia' nunca entram. A taxa real de cada
   compra vem da consulta ao pagamento no Mercado Pago (bruto − net_received_amount), com o token que já
   é segredo do Worker — nenhum segredo novo fora daqui. */
async function metricasInternas(request, url, env, h) {
  if (request.headers.get("X-Interno") !== env.INTERNO_SECRET) return json({ erro: "não autorizado" }, 401, h);
  const desde = url.searchParams.get("desde") || "1970-01-01T00:00:00.000Z";
  const ate = url.searchParams.get("ate") || agora();
  const admins = `${env.ADMIN_EMAILS || ""},${env.EMAILS_TESTE || ""}`.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const marcas = admins.length ? admins.map(() => "?").join(", ") : "''";
  const naoAdmin = `LOWER(u.email) NOT IN (${marcas})`;
  const um = (sql, ...binds) => env.DB.prepare(sql).bind(...binds).first();

  const [contasTotal, contasNovas, gratisConsumidos, gratisEmAberto, analisesPeriodo, custo, alertas, agendas, pendentes] = await Promise.all([
    um(`SELECT COUNT(*) n FROM usuarios u WHERE ${naoAdmin}`, ...admins),
    um(`SELECT COUNT(*) n FROM usuarios u WHERE ${naoAdmin} AND u.criado_em >= ? AND u.criado_em <= ?`, ...admins, desde, ate),
    // limitação 1 do baseline: acessos.origem é sempre 'credito', então "crédito grátis consumido" =
    // conta nova do período (nasce com 1 crédito) com pelo menos 1 análise liberada
    um(`SELECT COUNT(*) n FROM usuarios u WHERE ${naoAdmin} AND u.criado_em >= ? AND u.criado_em <= ?
        AND EXISTS (SELECT 1 FROM acessos a WHERE a.usuario_id = u.id)`, ...admins, desde, ate),
    um(`SELECT COUNT(*) n FROM usuarios u WHERE ${naoAdmin} AND u.criado_em >= ? AND u.criado_em <= ? AND u.creditos = 1
        AND NOT EXISTS (SELECT 1 FROM pedidos p WHERE p.usuario_id = u.id AND p.status = 'pago')`, ...admins, desde, ate),
    um(`SELECT COUNT(*) n FROM acessos a JOIN usuarios u ON u.id = a.usuario_id
        WHERE ${naoAdmin} AND a.liberado_em >= ? AND a.liberado_em <= ?`, ...admins, desde, ate),
    um("SELECT COUNT(*) n, COALESCE(SUM(custo_usd), 0) usd FROM relatorios WHERE gerado_em >= ? AND gerado_em <= ?", desde, ate),
    um(`SELECT COUNT(*) n FROM alertas al JOIN usuarios u ON u.id = al.usuario_id
        WHERE ${naoAdmin} AND al.criado_em >= ? AND al.criado_em <= ?`, ...admins, desde, ate),
    um(`SELECT COUNT(*) n FROM agenda ag JOIN usuarios u ON u.id = ag.usuario_id
        WHERE ${naoAdmin} AND ag.criado_em >= ? AND ag.criado_em <= ?`, ...admins, desde, ate),
    um("SELECT COUNT(*) n FROM analises_pendentes"),
  ]);

  const pagos = (await env.DB.prepare(
    `SELECT p.pacote, p.creditos, p.valor_centavos, p.pago_em, p.mp_payment_id, (LOWER(u.email) IN (${marcas})) teste_do_mantenedor
     FROM pedidos p JOIN usuarios u ON u.id = p.usuario_id
     WHERE p.status = 'pago' AND p.pago_em >= ? AND p.pago_em <= ? ORDER BY p.pago_em LIMIT 100`)
    .bind(...admins, desde, ate).all()).results;
  if (env.MP_ACCESS_TOKEN) {
    for (const c of pagos) {
      if (!c.mp_payment_id) continue;
      const r = await fetch(`https://api.mercadopago.com/v1/payments/${c.mp_payment_id}`, { headers: { "Authorization": `Bearer ${env.MP_ACCESS_TOKEN}` } });
      if (!r.ok) continue;
      const pg = await r.json();
      c.meio = pg.payment_type_id || null;  // ex.: bank_transfer (Pix), credit_card, account_money
      const liquido = pg.transaction_details && pg.transaction_details.net_received_amount;
      if (typeof liquido === "number") c.taxa_mp_centavos = Math.round((pg.transaction_amount - liquido) * 100);
    }
  }
  const clientes = pagos.filter(p => !p.teste_do_mantenedor);
  return json({
    periodo: { desde, ate },
    contas: { total: contasTotal.n, novas_no_periodo: contasNovas.n },
    creditos_gratis: { consumidos: gratisConsumidos.n, em_aberto: gratisEmAberto.n },
    analises_liberadas_no_periodo: analisesPeriodo.n,
    compras_pagas: {
      de_clientes: clientes.length,
      valor_bruto_centavos: clientes.reduce((s, c) => s + c.valor_centavos, 0),
      de_teste_do_mantenedor: pagos.length - clientes.length,
      itens: pagos.map(c => ({ ...c, teste_do_mantenedor: !!c.teste_do_mantenedor })),
    },
    relatorios: { n: custo.n, custo_usd: custo.usd },
    alertas_criados: alertas.n,
    agendas_salvas: agendas.n,
    analises_pendentes: pendentes.n,
  }, 200, h);
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
    // sem payer.email: quando o e-mail pré-preenchido é o da própria conta vendedora (ou de uma conta
    // Mercado Pago que não está logada), o checkout abre com os botões desabilitados. O Mercado Pago
    // pede o e-mail na hora; o pedido é casado pelo external_reference, não pelo e-mail.
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
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => { await enviarLembretes(env); await enviarAlertasImoveis(env); })());
  },
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
      if (m === "POST" && rota === "/interno/lembretes") {
        if (request.headers.get("X-Interno") !== env.INTERNO_SECRET) return json({ erro: "não autorizado" }, 401, h);
        return json({ enviados: await enviarLembretes(env) }, 200, h);
      }
      if (m === "POST" && rota === "/interno/alertas") {
        if (request.headers.get("X-Interno") !== env.INTERNO_SECRET) return json({ erro: "não autorizado" }, 401, h);
        return json({ enviados: await enviarAlertasImoveis(env) }, 200, h);
      }
      if (m === "GET" && rota === "/alertas/descadastrar") return alertaDescadastrar(url, env);
      if (m === "POST" && rota === "/geo") return geoDescobrir(request, env, h);
      if (m === "GET" && rota === "/interno/geo") return geoInterno(request, env, h);
      if (m === "GET" && rota === "/interno/metricas") return metricasInternas(request, url, env, h);
      if (m === "GET" && rota === "/pacotes") return json({ pacotes: pacotes(env) }, 200, h);

      const usuario = await usuarioDaSessao(request, env);
      if (!usuario) return json({ erro: "faça login", precisa_login: true }, 401, h);
      if (m === "GET" && rota === "/conta") return conta(usuario, env, h);
      if (m === "POST" && rota === "/auth/sair_todos") return sairDeTodos(usuario, env, h);
      if (m === "GET" && rota === "/agenda") return agendaListar(usuario, env, h);
      if (m === "POST" && rota === "/agenda") return agendaSalvar(request, usuario, env, h);
      if (m === "POST" && rota === "/agenda/remover") return agendaRemover(request, usuario, env, h);
      if (m === "GET" && rota === "/alertas") return alertasListar(usuario, env, h);
      if (m === "POST" && rota === "/alertas") return alertaCriar(request, usuario, env, h);
      if (m === "POST" && rota === "/alertas/remover") return alertaRemover(request, usuario, env, h);
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
