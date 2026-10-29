"""Coleta automática da leitura L0/L1 do baseline (docs/business/baseline-ciclo-01.md, seção 2).

Junta numa leitura só o que antes era copiado à mão de três painéis:
  - Umami Cloud, pelo link de compartilhamento (Settings → Share; o plano grátis não tem chave de API):
    o script troca o link pelo token somente-leitura que a própria página pública usa e consulta
    visitantes, pageviews, referrers, países e eventos do funil;
  - Worker: contas, créditos grátis consumidos/em aberto, compras pagas, custo real das análises
    (relatorios.custo_usd), alertas e agendas. Dois caminhos:
      1. com INTERNO_SECRET no ambiente, chama GET /interno/metricas (inclui a taxa real de cada
         compra, que o Worker consulta no Mercado Pago com o token que já é segredo dele);
      2. sem o segredo, consulta o D1 direto pelo wrangler autenticado (npx wrangler d1 execute) —
         mesmos números, só fica de fora a taxa real do MP;
  - câmbio: FIXO em R$ 5,00 por US$ 1,00 (decisão do mantenedor, 2026-10-29) — sem consulta externa.

Fica manual só o Google Search Console (exige OAuth do Google): copiar cliques e impressões do painel
(Desempenho → Resultados da pesquisa) e colar na leitura gerada.

Configuração (nada de segredo no repositório):
  link do Umami   Settings → Share (ex.: https://cloud.umami.is/share/abc123). Ordem de busca:
                  --share-url, variável UMAMI_SHARE_URL, arquivo scripts/.umami_share_url (uma linha,
                  fora do git: o link dá leitura pública das estatísticas a quem o tiver).
  INTERNO_SECRET  opcional (ver caminho 1 acima); o mesmo valor do segredo do Worker.

Uso (datas em horário de Brasília; aceita AAAA-MM-DD ou AAAA-MM-DDTHH:MM):
  python scripts/coleta_metricas.py --rotulo L0                        # do Umami ligado (29/10 09:33) até agora
  python scripts/coleta_metricas.py --rotulo L1 --ate 2026-11-10T23:59

Saída: docs/business/leituras/leitura-<rotulo>-<data>.md e .json (dados crus). `docs/business/` está
fora do site publicado (docs/.assetsignore); lembre que push em docs/ dispara o publicar.yml.

Agendar as duas leituras no Windows (opcional, PowerShell do usuário, com as variáveis de ambiente do usuário):
  $acao = New-ScheduledTaskAction -Execute "python" -Argument "scripts/coleta_metricas.py --rotulo L0" -WorkingDirectory "C:\\caminho\\aysha-leiloes"
  $gatilho = New-ScheduledTaskTrigger -Once -At "2026-11-01 23:50"
  Register-ScheduledTask -TaskName "aysha leitura L0" -Action $acao -Trigger $gatilho
  (idem para L1 em 2026-11-10 23:50)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

RAIZ = Path(__file__).resolve().parent.parent
BRT = timezone(timedelta(hours=-3), "America/Sao_Paulo")

# Câmbio fixo decidido pelo mantenedor em 2026-10-29 (ver decision-log); não consultar cotação.
CAMBIO = 5.00

# Umami ligado em 2026-10-29 09:33 (Brasília) — início padrão de toda leitura (baseline, seção 2)
INICIO_PADRAO = datetime(2026, 10, 29, 9, 33, tzinfo=BRT)
# primeira semana fechada possível do Umami (baseline, seção 2): 30/10 a 05/11
SEMANA_FECHADA = (datetime(2026, 10, 30, 0, 0, tzinfo=BRT), datetime(2026, 11, 6, 0, 0, tzinfo=BRT))

# eventos do funil, na ordem do baseline (principais primeiro, depois secundários)
EVENTOS = ["login-pedido", "conta-nova", "login-ok", "analise-credito", "compra-iniciada", "compra-paga",
           "agenda-salva", "agenda-ics", "alerta-criado"]


def url_worker() -> str:
    """Lê a URL do Worker de docs/js/config.js (fonte única, sem duplicar aqui)."""
    texto = (RAIZ / "docs" / "js" / "config.js").read_text(encoding="utf-8")
    m = re.search(r'urlWorker:\s*"(https://[^"]+)"', texto)
    if not m:
        raise SystemExit("urlWorker não encontrado em docs/js/config.js")
    return m.group(1).rstrip("/")


def data_brt(texto: str, fim_do_dia: bool = False) -> datetime:
    d = datetime.fromisoformat(texto)
    if d.tzinfo is None:
        d = d.replace(tzinfo=BRT)
    if fim_do_dia and len(texto) == 10:  # só a data: "até" inclui o dia inteiro
        d = d.replace(hour=23, minute=59, second=59)
    return d


def iso_js(d: datetime, fim: bool = False) -> str:
    """No formato que o Worker grava (toISOString, milissegundos + Z), para a comparação de texto do SQLite."""
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S") + (".999Z" if fim else ".000Z")


def valor(x):
    """O /stats do Umami já devolveu tanto {"value": n} quanto n puro, conforme a versão."""
    return x.get("value") if isinstance(x, dict) else x


# ---------------------------------------------------------------------- Umami (Share URL)
def sessao_share(share_url: str) -> tuple[str, str, dict]:
    """Troca o link público pelo (base da API de dados, id do site, headers somente-leitura).

    No Umami Cloud a página pública busca o token em <origem>/analytics/<região>/api/share/<slug> e
    consulta os dados em https://gateway-<região>.umami.is/api com DOIS headers: x-umami-share-token
    (o JWT devolvido) e x-umami-share-context (o slug do link). No Umami auto-hospedado é /api/share
    na própria origem (o header de contexto extra não atrapalha)."""
    m = re.match(r"(https://[^/]+)/share/([^/]+)", share_url.strip())
    if not m:
        raise ValueError(f"link de compartilhamento inesperado: {share_url!r} (esperado .../share/<slug>)")
    origem, slug = m.group(1), m.group(2)
    candidatos = [(f"{origem}/analytics/us/api", "https://gateway-us.umami.is/api"),
                  (f"{origem}/analytics/eu/api", "https://gateway-eu.umami.is/api"),
                  (f"{origem}/api", f"{origem}/api")]
    ultimo = None
    for base_share, base_dados in candidatos:
        try:
            r = requests.get(f"{base_share}/share/{slug}", headers={"Accept": "application/json"}, timeout=30)
            r.raise_for_status()
            d = r.json()
            site = d.get("websiteId") or d.get("id")
            if not site or "token" not in d:
                raise ValueError(f"resposta sem websiteId/token: {str(d)[:120]}")
            return base_dados, site, {"Accept": "application/json",
                                      "x-umami-share-token": d["token"], "x-umami-share-context": slug}
        except Exception as e:  # noqa: BLE001 — tenta o próximo candidato
            ultimo = e
    raise RuntimeError(f"não consegui trocar o link de compartilhamento pelo token: {ultimo}")


def coleta_umami(share_url: str, desde: datetime, ate: datetime) -> dict:
    base, site, h = sessao_share(share_url)
    ms = {"startAt": int(desde.timestamp() * 1000), "endAt": int(ate.timestamp() * 1000)}

    def api(caminho: str, **params) -> object:
        r = requests.get(f"{base}/websites/{site}/{caminho}", headers=h, params={**ms, **params}, timeout=30)
        r.raise_for_status()
        return r.json()

    stats = api("stats")
    dados = {
        "visitantes": valor(stats.get("visitors")),
        "pageviews": valor(stats.get("pageviews")),
        "referrers": [(m["x"] or "(direto)", m["y"]) for m in api("metrics", type="referrer")[:10]],
        "paises": [(m["x"] or "?", m["y"]) for m in api("metrics", type="country")[:10]],
    }
    contagens = {m["x"]: m["y"] for m in api("metrics", type="event")}
    dados["eventos"] = {nome: contagens.get(nome, 0) for nome in EVENTOS}
    dados["eventos_inesperados"] = {n: v for n, v in contagens.items() if n not in EVENTOS}

    # semana fechada 30/10–05/11: só existe depois de 06/11 (baseline, seção 2)
    if datetime.now(BRT) >= SEMANA_FECHADA[1]:
        ms_semana = {"startAt": int(SEMANA_FECHADA[0].timestamp() * 1000), "endAt": int(SEMANA_FECHADA[1].timestamp() * 1000)}
        r = requests.get(f"{base}/websites/{site}/stats", headers=h, params=ms_semana, timeout=30)
        r.raise_for_status()
        s = r.json()
        dados["semana_fechada_30_10_a_05_11"] = {"visitantes": valor(s.get("visitors")), "pageviews": valor(s.get("pageviews"))}
    return dados


# ------------------------------------------------------------------------------- Worker
def coleta_worker(url: str, segredo: str, desde: datetime, ate: datetime) -> dict:
    r = requests.get(f"{url}/interno/metricas", headers={"X-Interno": segredo},
                     params={"desde": iso_js(desde), "ate": iso_js(ate, fim=True)}, timeout=60)
    r.raise_for_status()
    return r.json()


def coleta_wrangler(desde: datetime, ate: datetime) -> dict:
    """Sem INTERNO_SECRET: os mesmos números de /interno/metricas, consultando o D1 pelo wrangler
    autenticado (npx wrangler d1 execute --remote). Só não traz a taxa real do Mercado Pago."""
    toml = (RAIZ / "worker" / "wrangler.toml").read_text(encoding="utf-8")
    # mesmas exclusões da rota /interno/metricas: contas de admin e contas de teste do mantenedor
    brutos = [re.search(rf'{var}\s*=\s*"([^"]*)"', toml) for var in ("ADMIN_EMAILS", "EMAILS_TESTE")]
    admins = [e.strip().lower() for m in brutos if m for e in m.group(1).split(",") if e.strip()]
    lista = ", ".join("'" + a.replace("'", "''") + "'" for a in admins) or "''"
    na = f"LOWER(u.email) NOT IN ({lista})"
    d0, d1 = iso_js(desde), iso_js(ate, fim=True)

    npx = shutil.which("npx") or shutil.which("npx.cmd") or r"C:\Program Files\nodejs\npx.cmd"

    def d1_sql(sql: str) -> list[dict]:
        sql = " ".join(sql.split())
        r = subprocess.run([npx, "wrangler", "d1", "execute", "aysha-contas", "--remote", "--json", "--command", sql],
                           cwd=RAIZ / "worker", capture_output=True, text=True, encoding="utf-8", timeout=180)
        if r.returncode != 0:
            raise RuntimeError(f"wrangler d1 execute falhou: {(r.stderr or r.stdout)[-400:]}")
        return json.loads(r.stdout)[0]["results"]

    g = d1_sql(f"""SELECT
      (SELECT COUNT(*) FROM usuarios u WHERE {na}) contas_total,
      (SELECT COUNT(*) FROM usuarios u WHERE {na} AND u.criado_em >= '{d0}' AND u.criado_em <= '{d1}') contas_novas,
      (SELECT COUNT(*) FROM usuarios u WHERE {na} AND u.criado_em >= '{d0}' AND u.criado_em <= '{d1}'
        AND EXISTS (SELECT 1 FROM acessos a WHERE a.usuario_id = u.id)) gratis_consumidos,
      (SELECT COUNT(*) FROM usuarios u WHERE {na} AND u.criado_em >= '{d0}' AND u.criado_em <= '{d1}' AND u.creditos = 1
        AND NOT EXISTS (SELECT 1 FROM pedidos p WHERE p.usuario_id = u.id AND p.status = 'pago')) gratis_em_aberto,
      (SELECT COUNT(*) FROM acessos a JOIN usuarios u ON u.id = a.usuario_id
        WHERE {na} AND a.liberado_em >= '{d0}' AND a.liberado_em <= '{d1}') analises,
      (SELECT COUNT(*) FROM relatorios WHERE gerado_em >= '{d0}' AND gerado_em <= '{d1}') rel_n,
      (SELECT COALESCE(SUM(custo_usd), 0) FROM relatorios WHERE gerado_em >= '{d0}' AND gerado_em <= '{d1}') rel_usd,
      (SELECT COUNT(*) FROM alertas al JOIN usuarios u ON u.id = al.usuario_id
        WHERE {na} AND al.criado_em >= '{d0}' AND al.criado_em <= '{d1}') alertas,
      (SELECT COUNT(*) FROM agenda ag JOIN usuarios u ON u.id = ag.usuario_id
        WHERE {na} AND ag.criado_em >= '{d0}' AND ag.criado_em <= '{d1}') agendas,
      (SELECT COUNT(*) FROM analises_pendentes) pendentes""")[0]
    pagos = d1_sql(f"""SELECT p.pacote, p.creditos, p.valor_centavos, p.pago_em, p.mp_payment_id,
        (LOWER(u.email) IN ({lista})) teste_do_mantenedor
      FROM pedidos p JOIN usuarios u ON u.id = p.usuario_id
      WHERE p.status = 'pago' AND p.pago_em >= '{d0}' AND p.pago_em <= '{d1}' ORDER BY p.pago_em LIMIT 100""")
    clientes = [p for p in pagos if not p["teste_do_mantenedor"]]
    return {
        "via": "wrangler d1 (sem a taxa real do MP; para a taxa, rode com INTERNO_SECRET)",
        "contas": {"total": g["contas_total"], "novas_no_periodo": g["contas_novas"]},
        "creditos_gratis": {"consumidos": g["gratis_consumidos"], "em_aberto": g["gratis_em_aberto"]},
        "analises_liberadas_no_periodo": g["analises"],
        "compras_pagas": {"de_clientes": len(clientes), "valor_bruto_centavos": sum(c["valor_centavos"] for c in clientes),
                          "de_teste_do_mantenedor": len(pagos) - len(clientes),
                          "itens": [{**p, "teste_do_mantenedor": bool(p["teste_do_mantenedor"])} for p in pagos]},
        "relatorios": {"n": g["rel_n"], "custo_usd": g["rel_usd"]},
        "alertas_criados": g["alertas"], "agendas_salvas": g["agendas"], "analises_pendentes": g["pendentes"],
    }


# ------------------------------------------------------------------------------- saída
def reais(centavos: int) -> str:
    return f"R$ {centavos / 100:.2f}".replace(".", ",")


def monta_markdown(rotulo: str, desde: datetime, ate: datetime, umami, worker, erros: list[str]) -> str:
    agora = datetime.now(BRT)
    li = [f"# Leitura {rotulo} — métricas do baseline (ciclo 01)", "",
          f"Gerada por `scripts/coleta_metricas.py` em {agora:%Y-%m-%d %H:%M} (Brasília).",
          f"Período: {desde:%Y-%m-%d %H:%M} a {ate:%Y-%m-%d %H:%M} (Brasília).",
          f"Câmbio: **{reais(round(CAMBIO * 100))} por US$ 1,00, fixado pelo mantenedor em 2026-10-29** (decision-log); não é cotação do dia.",
          "", "| Campo | Valor | Fonte |", "|---|---|---|"]

    def linha(campo, valor_, fonte):
        li.append(f"| {campo} | {valor_} | {fonte} |")

    if umami:
        linha("Visitantes únicos", umami["visitantes"], "Umami (share)")
        linha("Pageviews", umami["pageviews"], "Umami (share)")
        sem = umami.get("semana_fechada_30_10_a_05_11")
        linha("Semana fechada 30/10–05/11 (visitantes / pageviews)",
              f"{sem['visitantes']} / {sem['pageviews']}" if sem else "ainda não existe (só a partir de 2026-11-06)", "Umami (share)")
        linha("Top referrers", "; ".join(f"{n}: {v}" for n, v in umami["referrers"]) or "(nenhum)", "Umami (share)")
        linha("Top países", "; ".join(f"{n}: {v}" for n, v in umami["paises"]) or "(nenhum)", "Umami (share)")
        for nome in EVENTOS:
            linha(f"Evento `{nome}`", umami["eventos"][nome], "Umami (share)")
        if umami["eventos_inesperados"]:
            linha("Eventos fora da lista do baseline", "; ".join(f"{n}: {v}" for n, v in umami["eventos_inesperados"].items()), "Umami (share)")
    else:
        linha("Umami (visitantes, pageviews, referrers, eventos)", "PENDENTE — informe UMAMI_SHARE_URL (Settings → Share) e rode de novo", "—")

    if worker:
        fonte_w = "Worker `/interno/metricas`" if "via" not in worker else "D1 via wrangler"
        c, g, co = worker["contas"], worker["creditos_gratis"], worker["compras_pagas"]
        linha("Contas totais / novas no período (sem as do mantenedor)", f"{c['total']} / {c['novas_no_periodo']}", fonte_w)
        linha("Créditos grátis consumidos (contas novas com ≥ 1 análise)", g["consumidos"], f"{fonte_w} (limitação 1 do baseline)")
        linha("Créditos grátis em aberto (contas novas, crédito parado, sem compra)", g["em_aberto"], fonte_w)
        linha("Análises liberadas no período (sem as do mantenedor)", worker["analises_liberadas_no_periodo"], f"{fonte_w} (`acessos`)")
        linha("Compras pagas de clientes: nº / valor bruto", f"{co['de_clientes']} / {reais(co['valor_bruto_centavos'])}", f"{fonte_w} (`pedidos`, sem cortesia nem mantenedor)")
        linha("Compras de teste do mantenedor no período", co["de_teste_do_mantenedor"], fonte_w)
        for i, item in enumerate(co["itens"], 1):
            taxa = reais(item["taxa_mp_centavos"]) if item.get("taxa_mp_centavos") is not None else "? (rodar com INTERNO_SECRET ou ver no painel do MP)"
            quem = "TESTE do mantenedor" if item["teste_do_mantenedor"] else "cliente"
            linha(f"Compra {i} ({quem})",
                  f"pacote {item['pacote']}, {reais(item['valor_centavos'])}, taxa MP {taxa}, meio {item.get('meio', '?')}, pago em {item['pago_em']}",
                  f"{fonte_w} + API do Mercado Pago" if item.get("meio") else fonte_w)
        usd = worker["relatorios"]["custo_usd"]
        linha("Custo real das análises no período (`relatorios.custo_usd`)",
              f"US$ {usd:.4f} = {reais(round(usd * CAMBIO * 100))} ({worker['relatorios']['n']} relatórios)", fonte_w)
        linha("Alertas criados / agendas salvas no período", f"{worker['alertas_criados']} / {worker['agendas_salvas']}", fonte_w)
        linha("Análises pendentes agora", worker["analises_pendentes"], fonte_w)
    else:
        linha("Worker (contas, créditos, compras, custo, alertas)", "PENDENTE — defina INTERNO_SECRET ou autentique o wrangler e rode de novo", "—")

    linha("Google Search Console: cliques / impressões", "PENDENTE — **manual**: copiar do painel (Desempenho → Resultados da pesquisa, período personalizado) e colar aqui", "GSC (sem API configurada)")

    if erros:
        li += ["", "## Falhas desta coleta", ""] + [f"- {e}" for e in erros]
    li += ["", "Dados crus no `.json` ao lado. Próximo passo: colar o valor do GSC e usar esta leitura no baseline (seção 2).", ""]
    return "\n".join(li)


def main() -> int:
    p = argparse.ArgumentParser(description="Coleta as métricas pendentes do baseline (Umami + Worker/D1 + Mercado Pago).")
    p.add_argument("--rotulo", default="leitura", help="L0, L1 ou outro rótulo para o nome do arquivo")
    p.add_argument("--desde", help="início do período (Brasília); padrão: 2026-10-29T09:33 (Umami ligado)")
    p.add_argument("--ate", help="fim do período (Brasília); padrão: agora")
    p.add_argument("--share-url", help="link público do Umami (Settings → Share); padrão: variável UMAMI_SHARE_URL")
    args = p.parse_args()

    desde = data_brt(args.desde) if args.desde else INICIO_PADRAO
    ate = data_brt(args.ate, fim_do_dia=True) if args.ate else datetime.now(BRT)
    erros: list[str] = []

    umami = worker = None
    arquivo_share = RAIZ / "scripts" / ".umami_share_url"
    share = args.share_url or os.environ.get("UMAMI_SHARE_URL") or \
        (arquivo_share.read_text(encoding="utf-8").strip() if arquivo_share.exists() else None)
    if share:
        try:
            umami = coleta_umami(share, desde, ate)
        except Exception as e:  # noqa: BLE001 — uma fonte falhar não derruba a leitura
            erros.append(f"Umami: {e}")
    else:
        erros.append("Umami pulado: informe --share-url, a variável UMAMI_SHARE_URL ou o arquivo scripts/.umami_share_url (Settings → Share)")

    segredo = os.environ.get("INTERNO_SECRET")
    try:
        worker = coleta_worker(url_worker(), segredo, desde, ate) if segredo else coleta_wrangler(desde, ate)
    except Exception as e:  # noqa: BLE001
        erros.append(f"Worker: {e}")

    pasta = RAIZ / "docs" / "business" / "leituras"
    pasta.mkdir(parents=True, exist_ok=True)
    nome = f"leitura-{args.rotulo}-{datetime.now(BRT):%Y-%m-%d-%H%M}"
    (pasta / f"{nome}.json").write_text(json.dumps({
        "rotulo": args.rotulo, "periodo_brt": [desde.isoformat(), ate.isoformat()], "cambio_fixo": CAMBIO,
        "umami": umami, "worker": worker, "erros": erros,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    (pasta / f"{nome}.md").write_text(monta_markdown(args.rotulo, desde, ate, umami, worker, erros), encoding="utf-8")

    print(f"Leitura gravada em docs/business/leituras/{nome}.md")
    for e in erros:
        print(f"  aviso: {e}")
    return 1 if (umami is None and worker is None) else 0


if __name__ == "__main__":
    sys.exit(main())
