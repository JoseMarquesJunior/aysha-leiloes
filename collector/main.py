"""Orquestrador da coleta: fontes -> regex -> deduplicação -> histórico -> geocodificação -> JSON.

Uso:  python -m collector.main [--fontes caixa,...] [--sem-geo] [--config collector/config.yaml]
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from datetime import date, datetime
from pathlib import Path

import yaml

from . import historico as hist
from . import ia
from .dedupe import deduplicar
from .extract_regex import extrair_tudo
from .geocode import Geocodificador
from .http_client import cliente_do_config
from .schema import CAMPOS, completar, preencher_derivados
from .sources import REGISTRO

log = logging.getLogger("coletor")
RAIZ = Path(__file__).resolve().parent.parent


def carregar_config(caminho: Path) -> dict:
    return yaml.safe_load(caminho.read_text(encoding="utf-8"))


def _ler_json(p: Path, padrao):
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return padrao


def _gravar_json(p: Path, dados, compacto: bool = True) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    if compacto:
        p.write_text(json.dumps(dados, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    else:
        p.write_text(json.dumps(dados, ensure_ascii=False, indent=1), encoding="utf-8")


def carregar_base_anterior(pasta: Path) -> dict[str, dict]:
    """Lê imoveis.json ou os imoveis_<UF>.json (se a base estava dividida)."""
    meta = _ler_json(pasta / "meta.json", {})
    arquivos = meta.get("arquivos") or ["imoveis.json"]
    base: dict[str, dict] = {}
    for nome in arquivos:
        for r in _ler_json(pasta / nome, []):
            completo = {c: None for c in CAMPOS}
            completo["outras_fontes"] = []
            completo.update(r)  # os arquivos são gravados sem os campos null
            base[r["id"]] = completo
    return base


def fontes_produzidas(modulo, config: dict) -> set[str]:
    """Valores de `fonte` que um módulo gera (um módulo pode cobrir vários sites)."""
    f = getattr(modulo, "fontes_produzidas", None)
    if callable(f):
        return set(f(config))
    return {getattr(modulo, "NOME", None)}


def coletar_fontes(config: dict, cliente, apenas: set[str] | None, status: dict,
                   editais: dict[str, list] | None = None, coletadas: set[str] | None = None) -> list[dict]:
    """Executa as fontes ativas; `coletadas` recebe os valores de `fonte` coletados com sucesso nesta execução."""
    hoje = date.today().isoformat()
    registros: list[dict] = []
    for nome, modulo in REGISTRO.items():
        cfg = config["fontes"].get(nome, {})
        st = status.setdefault(nome, {"ultima_coleta_ok": None, "registros": 0, "ultimo_erro": None, "ativa": False})
        st["ativa"] = bool(cfg.get("ativa"))
        st["site"] = getattr(modulo, "SITE", None)
        if not cfg.get("ativa"):
            st["ultimo_erro"] = st.get("ultimo_erro") or "fonte desativada no config"
            continue
        if apenas and nome not in apenas:
            continue
        if cfg.get("bloqueado_no_ci") and os.environ.get("GITHUB_ACTIONS") and not (apenas and nome in apenas):
            st["ultimo_erro"] = st.get("ultimo_erro") or "bloqueia IPs de datacenter: coletada só localmente"
            st["bloqueado_no_ci"] = True
            continue
        inicio = time.monotonic()
        try:
            novos = modulo.coletar(config, cliente)
            registros.extend(novos)
            info = dict(getattr(modulo, "ultima_info", None) or {})
            if editais is not None and info.get("editais"):
                editais[nome] = info.pop("editais")
            elif "editais" in info:
                info["editais"] = len(info["editais"])
            st.update({"ultima_coleta_ok": hoje, "registros": len(novos), "ultimo_erro": None,
                       "duracao_s": round(time.monotonic() - inicio, 1), "info": info or None})
            if coletadas is not None:
                coletadas |= fontes_produzidas(modulo, config)
            log.info("fonte %s: %d registros", nome, len(novos))
        except Exception as e:  # uma fonte que falha não derruba as outras
            st["ultimo_erro"] = f"{hoje}: {type(e).__name__}: {e}"[:500]
            st["ultima_tentativa"] = hoje
            log.exception("fonte %s falhou", nome)
    return registros


def aplicar_regex(registros: list[dict]) -> None:
    for r in registros:
        texto = " ".join(t for t in (r.get("descricao_original"), r.get("modalidade")) if t)
        completar(r, preencher_null_com=extrair_tudo(texto))
        preencher_derivados(r)


def percentual_nulos(registros: list[dict]) -> dict[str, float]:
    ativos = [r for r in registros if r.get("ativo", True)]
    if not ativos:
        return {}
    return {c: round(100 * sum(1 for r in ativos if r.get(c) is None) / len(ativos), 1) for c in CAMPOS
            if c not in ("outras_fontes",)}


def _compacto(r: dict) -> dict:
    """Registro sem campos null e sem outras_fontes vazia: o site repõe os nulos ao carregar
    (common.js, CAMPOS). Reduz o JSON em cerca de 40 % — importa em RJ e SP, com milhares de imóveis."""
    return {k: v for k, v in r.items() if v is not None and not (k == "outras_fontes" and not v)}


def gravar_saida(pasta: Path, registros: list[dict], config: dict, status: dict, hoje: str) -> list[str]:
    registros.sort(key=lambda r: (r.get("uf") or "", r.get("cidade") or "", r.get("id") or ""))
    limite = config["saida"].get("dividir_por_uf_acima_de_mb", 3) * 1024 * 1024
    conteudo = json.dumps([_compacto(r) for r in registros], ensure_ascii=False, separators=(",", ":"))
    arquivos: list[str]
    if len(conteudo.encode("utf-8")) > limite:
        arquivos = []
        for uf in sorted({r.get("uf") or "XX" for r in registros}):
            nome = f"imoveis_{uf}.json"
            _gravar_json(pasta / nome, [_compacto(r) for r in registros if (r.get("uf") or "XX") == uf])
            arquivos.append(nome)
        (pasta / "imoveis.json").unlink(missing_ok=True)
    else:
        (pasta / "imoveis.json").write_text(conteudo, encoding="utf-8")
        arquivos = ["imoveis.json"]
        for p in pasta.glob("imoveis_*.json"):
            p.unlink()
    ativos = [r for r in registros if r.get("ativo", True)]
    meta = {
        "gerado_em": datetime.now().isoformat(timespec="seconds"),
        "data_coleta": hoje,
        "arquivos": arquivos,
        "dividido_por_uf": len(arquivos) > 1 or arquivos[0] != "imoveis.json",
        "ufs": sorted({r.get("uf") for r in registros if r.get("uf")}),
        # lista vazia no config = o site carrega todas as UFs na abertura
        "ufs_padrao": config["saida"].get("ufs_carregadas_por_padrao") or sorted({r.get("uf") for r in registros if r.get("uf")}),
        "total": len(registros),
        "ativos": len(ativos),
        "por_fonte": {f: sum(1 for r in ativos if r.get("fonte") == f) for f in sorted({r.get("fonte") for r in ativos})},
        "por_uf": {u: sum(1 for r in ativos if r.get("uf") == u) for u in sorted({r.get("uf") for r in ativos if r.get("uf")})},
        "percentual_nulos": percentual_nulos(registros),
    }
    _gravar_json(pasta / "meta.json", meta, compacto=False)
    status["_geral"] = {"ultima_execucao": meta["gerado_em"], "data_coleta": hoje}
    _gravar_json(pasta / "status_fontes.json", status, compacto=False)
    return arquivos


def executar(config: dict, apenas: set[str] | None = None, sem_geo: bool = False) -> dict:
    hoje = date.today().isoformat()
    pasta = RAIZ / config["saida"]["pasta"]
    pasta.mkdir(parents=True, exist_ok=True)
    cliente = cliente_do_config(config)
    status = _ler_json(pasta / "status_fontes.json", {})

    # 1. fontes (editais/avisos sem lotes estruturados vão para editais.json)
    editais_por_fonte = {e["fonte"]: [] for e in _ler_json(pasta / "editais.json", {"editais": []})["editais"]}
    for e in _ler_json(pasta / "editais.json", {"editais": []})["editais"]:
        editais_por_fonte[e["fonte"]].append(e)
    fontes_ok: set[str] = set()  # valores de `fonte` coletados com sucesso NESTA execução
    registros = coletar_fontes(config, cliente, apenas, status, editais_por_fonte, fontes_ok)
    lista_editais = [e for f in sorted(editais_por_fonte) for e in editais_por_fonte[f]]
    lista_editais.sort(key=lambda e: (e.get("data_leilao") or e.get("publicado_em") or ""), reverse=True)
    _gravar_json(pasta / "editais.json", {"gerado_em": datetime.now().isoformat(timespec="seconds"), "editais": lista_editais},
                 compacto=False)

    # 2. regex + derivados
    aplicar_regex(registros)

    # 3. deduplicação — o conjunto inclui os registros ativos das fontes que não rodaram nesta execução
    #    (falha ou --fontes), para que um lote novo de leiloeiro ainda case com um imóvel antigo da Caixa
    anteriores = carregar_base_anterior(pasta)
    novos_ids = {r["id"] for r in registros}
    mantidos = []
    for id_, velho in anteriores.items():
        if id_ not in novos_ids and velho.get("fonte") not in fontes_ok and velho.get("ativo", True):
            velho = dict(velho)
            velho["outras_fontes"] = [o for o in velho.get("outras_fontes") or [] if o.get("fonte") not in fontes_ok]
            mantidos.append(velho)
    antes = len(registros) + len(mantidos)
    registros = deduplicar(registros + mantidos, config.get("prioridade_fontes", {}))
    log.info("deduplicação: %d -> %d (%d mantidos de fontes não coletadas)", antes, len(registros), len(mantidos))

    # 4. histórico (compara com a base anterior); um registro absorvido como duplicata de outro
    #    (está em `outras_fontes` de um principal) não é "removido" nem fica como inativo
    atuais = {r["id"]: r for r in registros}
    absorvidos = {o.get("id") for r in registros for o in r.get("outras_fontes") or []}
    anteriores = {k: v for k, v in anteriores.items() if k not in absorvidos}
    eventos = hist.comparar(anteriores, atuais, hoje)
    base = hist.fundir_com_anteriores(anteriores, atuais, hoje, config["saida"].get("dias_retencao_removidos", 90))
    registros = list(base.values())
    h = hist.carregar_historico(pasta / "historico.json")
    hist.gravar_historico(pasta / "historico.json", h, eventos, hoje, config["saida"].get("dias_retencao_eventos", 365))
    log.info("histórico: %d eventos novos (%s)", len(eventos),
             ", ".join(f"{t}={sum(1 for e in eventos if e['tipo'] == t)}" for t in sorted({e["tipo"] for e in eventos})))

    # 5. geocodificação (só novos, com cache)
    gcfg = config.get("geocodificacao", {})
    if gcfg.get("ativa") and not sem_geo:
        geo = Geocodificador(cliente, gcfg["url"], RAIZ / gcfg["cache"], gcfg.get("intervalo_segundos", 1.1),
                             gcfg.get("maximo_por_execucao", 400), gcfg.get("precisao_maxima_por_uf"))
        # ordem: UFs prioritárias do projeto primeiro (ES, MG), depois as demais; dentro de cada UF, fontes
        # com endereço/bairro extraídos (leiloeiros, JFES) antes da Caixa
        prioridade_uf = {u: i for i, u in enumerate(config.get("ufs", []))}

        def ordem(r):
            return (prioridade_uf.get(r.get("uf"), 99), 1 if r.get("fonte") == "caixa" else 0)
        pendentes = sorted((r for r in registros if r.get("ativo", True) and r.get("lat") is None), key=ordem)
        for r in pendentes:
            geo.geocodificar(r)
        # registros que ficaram no nível "cidade" tentam de novo quando há bairro/endereço (vindos do regex)
        # ou candidatos no fim da descrição; consultas repetidas saem do cache e não contam no teto
        for r in sorted((r for r in registros if r.get("ativo", True) and r.get("geo_precisao") == "cidade"), key=ordem):
            if geo.consultas >= geo.maximo:
                break
            if not (r.get("bairro") or r.get("endereco") or r.get("descricao_original")):
                continue
            tentativa = dict(r, lat=None, lng=None, geo_precisao=None)
            geo.geocodificar(tentativa)
            if tentativa.get("geo_precisao") in ("endereco", "bairro"):
                r.update({k: tentativa[k] for k in ("lat", "lng", "geo_precisao", "bairro")})
        geo.salvar()
        com_geo = sum(1 for r in registros if r.get("lat") is not None)
        log.info("geocodificação: %d consultas novas; %d/%d com coordenadas", geo.consultas, com_geo, len(registros))

    # 6. snapshots (delta diário; completo no dia configurado do mês ou quando não há base anterior)
    snap_dir = pasta / "snapshots"
    completo = (not anteriores) or date.today().day == config["saida"].get("snapshot_completo_dia", 1)
    hist.gravar_snapshot(snap_dir, hoje, registros, anteriores, completo=completo)
    hist.compactar_snapshots(snap_dir, hoje, config["saida"].get("dias_snapshots_diarios", 90))

    # 7. IA (Batch API, cache permanente, tetos diários; só roda com chave + ia_habilitada)
    try:
        ia.executar(registros, config.get("ia", {}), pasta, cliente, config)
    except Exception:  # a IA nunca derruba a coleta
        log.exception("etapa de IA falhou")

    # 8. saída
    gravar_saida(pasta, registros, config, status, hoje)
    return {"registros": len(registros), "eventos": len(eventos), "status": status}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Coletor do Aysha Leilões")
    ap.add_argument("--config", default=str(RAIZ / "collector" / "config.yaml"))
    ap.add_argument("--fontes", help="lista separada por vírgula (padrão: todas as ativas)")
    ap.add_argument("--sem-geo", action="store_true", help="pula a geocodificação")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s", stream=sys.stdout)
    config = carregar_config(Path(args.config))
    apenas = set(args.fontes.split(",")) if args.fontes else None
    res = executar(config, apenas, args.sem_geo)
    log.info("fim: %d registros na base", res["registros"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
