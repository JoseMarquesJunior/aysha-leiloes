/**
 * Aysha Leilões — Worker de "análise com IA" sob demanda (Cloudflare Workers, plano gratuito).
 *
 * O site é estático; este Worker é a ponte entre o clique anônimo e o robô que gera o parecer:
 *   POST /analise  { "id": "<id do imóvel>" }
 *     1. se o relatório já existe no site (data/relatorios/<id>.json), responde {status:"pronto"} — custo zero;
 *     2. aplica limites: por IP (LIMITE_IP por hora) e global (LIMITE_DIA por dia), guardados no KV;
 *     3. se já há um pedido em andamento para o id, responde {status:"em_andamento"};
 *     4. dispara o workflow relatorio.yml no GitHub (workflow_dispatch) com o id e responde {status:"iniciado"}.
 *   A página então espera o arquivo aparecer no site (o workflow gera, commita, e o Pages publica).
 *
 * Segredos (wrangler secret put): GITHUB_TOKEN — token fine-grained do repositório com permissão "Actions: write".
 * Variáveis (wrangler.toml): REPO, SITE, LIMITE_IP, LIMITE_DIA, ORIGENS. KV: LIMITES.
 * A chave da Anthropic NÃO passa por aqui: ela fica só nos segredos do GitHub Actions.
 */

const ID_OK = /^[\w.\-]{3,80}$/;

function cors(env, origin) {
  const permitidas = (env.ORIGENS || "").split(",").map(s => s.trim()).filter(Boolean);
  const ok = permitidas.includes(origin) ? origin : permitidas[0] || "*";
  return { "Access-Control-Allow-Origin": ok, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin" };
}

function resposta(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
}

async function hashIp(ip) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip + "aysha"));
  return [...new Uint8Array(buf)].slice(0, 8).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function contar(env, chave, ttl) {
  const atual = parseInt((await env.LIMITES.get(chave)) || "0", 10) + 1;
  await env.LIMITES.put(chave, String(atual), { expirationTtl: ttl });
  return atual;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const h = cors(env, origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/analise") return resposta({ erro: "use POST /analise" }, 404, h);

    let id;
    try { id = String((await request.json()).id || ""); } catch { return resposta({ erro: "corpo inválido" }, 400, h); }
    if (!ID_OK.test(id)) return resposta({ erro: "id inválido" }, 400, h);

    // 1. já existe?
    const arquivo = `${env.SITE.replace(/\/$/, "")}/data/relatorios/${id.replace(/[^\w.\-]/g, "_")}.json`;
    const existe = await fetch(arquivo, { method: "HEAD", cf: { cacheTtl: 0 } });
    if (existe.ok) return resposta({ status: "pronto", url: arquivo }, 200, h);

    // 2. limites
    const hoje = new Date().toISOString().slice(0, 10);
    const hora = new Date().toISOString().slice(0, 13);
    const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
    const porIp = await contar(env, `ip:${await hashIp(ip)}:${hora}`, 3600);
    if (porIp > Number(env.LIMITE_IP || 3)) return resposta({ erro: "limite por hora atingido; tente mais tarde" }, 429, h);
    const porDia = await contar(env, `dia:${hoje}`, 86400);
    if (porDia > Number(env.LIMITE_DIA || 100)) return resposta({ erro: "limite diário de análises atingido; tente amanhã" }, 429, h);

    // 3. já em andamento?
    const chaveFila = `fila:${id}`;
    if (await env.LIMITES.get(chaveFila)) return resposta({ status: "em_andamento" }, 202, h);

    // 4. dispara o workflow
    const r = await fetch(`https://api.github.com/repos/${env.REPO}/actions/workflows/relatorio.yml/dispatches`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.GITHUB_TOKEN}`, "Accept": "application/vnd.github+json",
                 "User-Agent": "aysha-leiloes-worker", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main", inputs: { ids: id } }),
    });
    if (r.status !== 204) {
      const texto = await r.text();
      return resposta({ erro: `GitHub respondeu ${r.status}`, detalhe: texto.slice(0, 200) }, 502, h);
    }
    await env.LIMITES.put(chaveFila, "1", { expirationTtl: 900 });
    return resposta({ status: "iniciado", url: arquivo, espera_segundos: 240 }, 202, h);
  },
};
