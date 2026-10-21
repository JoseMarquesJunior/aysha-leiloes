"""Orquestrador da coleta: fontes -> regex -> deduplicação -> histórico -> geocodificação -> JSON.

Uso:  python -m collector.main [--fontes caixa,...] [--sem-geo] [--config collector/config.yaml]
"""

from __future__ import annotations

import argparse
import json
import logging
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
            base[r["id"]] = r
    return base


def coletar_fontes(config: dict, cliente, apenas: set[str] | None, status: dict) -> list[dict]:
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
        inicio = time.monotonic()
        try:
            novos = modulo.coletar(config, cliente)
            registros.extend(novos)
            st.update({"ultima_coleta_ok": hoje, "registros": len(novos), "ultimo_erro": None,
                       "duracao_s": round(time.monotonic() - inicio, 1),
                       "info": getattr(modulo, "ultima_info", None) or None})
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


def gravar_saida(pasta: Path, registros: list[dict], config: dict, status: dict, hoje: str) -> list[str]:
    registros.sort(key=lambda r: (r.get("uf") or "", r.get("cidade") or "", r.get("id") or ""))
    limite = config["saida"].get("dividir_por_uf_acima_de_mb", 3) * 1024 * 1024
    conteudo = json.dumps(registros, ensure_ascii=False, separators=(",", ":"))
    arquivos: list[str]
    if len(conteudo.encode("utf-8")) > limite:
        arquivos = []
        for uf in sorted({r.get("uf") or "XX" for r in registros}):
            nome = f"imoveis_{uf}.json"
            _gravar_json(pasta / nome, [r for r in registros if (r.get("uf") or "XX") == uf])
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

    # 1. fontes
    registros = coletar_fontes(config, cliente, apenas, status)
    fontes_ok = {n for n, s in status.items() if not n.startswith("_") and s.get("ultima_coleta_ok") == hoje}

    # 2. regex + derivados
    aplicar_regex(registros)

    # 3. deduplicação
    antes = len(registros)
    registros = deduplicar(registros, config.get("prioridade_fontes", {}))
    log.info("deduplicação: %d -> %d", antes, len(registros))

    # 4. histórico (compara com a base anterior; fontes que falharam hoje mantêm seus registros antigos)
    anteriores = carregar_base_anterior(pasta)
    atuais = {r["id"]: r for r in registros}
    for id_, velho in anteriores.items():
        if id_ not in atuais and velho.get("fonte") not in fontes_ok and velho.get("ativo", True):
            atuais[id_] = velho  # fonte não coletada hoje: não marcar como removido
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
                             gcfg.get("maximo_por_execucao", 400))
        pendentes = [r for r in registros if r.get("ativo", True) and r.get("lat") is None]
        for r in pendentes:
            geo.geocodificar(r)
        geo.salvar()
        com_geo = sum(1 for r in registros if r.get("lat") is not None)
        log.info("geocodificação: %d consultas novas; %d/%d com coordenadas", geo.consultas, com_geo, len(registros))

    # 6. snapshots
    snap_dir = pasta / "snapshots"
    hist.gravar_snapshot(snap_dir, hoje, registros)
    hist.compactar_snapshots(snap_dir, hoje, config["saida"].get("dias_snapshots_diarios", 90))

    # 7. IA (só estimativa; a chamada à API aguarda aprovação)
    ia.executar(registros, config.get("ia", {}), pasta)

    # 8. saída
    gravar_saida(pasta, registros, config, status, hoje)
    return {"registros": len(registros), "eventos": len(eventos), "status": status}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Coletor do Leilões em Tabela")
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
