"""Histórico entre coletas: eventos por id, snapshots diários e compactação mensal.

- historico.json: {"eventos": [{"id", "data", "tipo", "de", "para"}], "gerado_em"}
  tipos: novo, mudou_preco, mudou_modalidade, mudou_data_leilao, removido, reativado
- snapshots/AAAA-MM-DD.json: lista com os campos essenciais de cada imóvel ativo naquele dia
- snapshots/mensal/AAAA-MM.json: resumo por id (primeiro/último valor, mín/máx) dos dias compactados
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta
from pathlib import Path

from .schema import CAMPOS_SNAPSHOT

log = logging.getLogger(__name__)


def comparar(anteriores: dict[str, dict], atuais: dict[str, dict], hoje: str) -> list[dict]:
    """Eventos entre a base anterior (id -> registro) e a atual."""
    eventos: list[dict] = []
    for id_, novo in atuais.items():
        velho = anteriores.get(id_)
        if velho is None:
            eventos.append({"id": id_, "data": hoje, "tipo": "novo", "de": None, "para": novo.get("valor_minimo")})
            continue
        if not velho.get("ativo", True) and novo.get("ativo", True):
            eventos.append({"id": id_, "data": hoje, "tipo": "reativado", "de": None, "para": novo.get("valor_minimo")})
        if velho.get("valor_minimo") != novo.get("valor_minimo"):
            eventos.append({"id": id_, "data": hoje, "tipo": "mudou_preco",
                            "de": velho.get("valor_minimo"), "para": novo.get("valor_minimo")})
        if (velho.get("modalidade") or None) != (novo.get("modalidade") or None):
            eventos.append({"id": id_, "data": hoje, "tipo": "mudou_modalidade",
                            "de": velho.get("modalidade"), "para": novo.get("modalidade")})
        if (velho.get("data_leilao") or None) != (novo.get("data_leilao") or None):
            eventos.append({"id": id_, "data": hoje, "tipo": "mudou_data_leilao",
                            "de": velho.get("data_leilao"), "para": novo.get("data_leilao")})
    for id_, velho in anteriores.items():
        if id_ not in atuais and velho.get("ativo", True):
            eventos.append({"id": id_, "data": hoje, "tipo": "removido", "de": velho.get("valor_minimo"), "para": None})
    return eventos


def fundir_com_anteriores(anteriores: dict[str, dict], atuais: dict[str, dict], hoje: str,
                          dias_retencao: int) -> dict[str, dict]:
    """Mantém `primeira_vez_visto`, marca removidos como inativos e descarta os inativos há mais de N dias."""
    limite = (date.fromisoformat(hoje) - timedelta(days=dias_retencao)).isoformat()
    saida: dict[str, dict] = {}
    for id_, r in atuais.items():
        velho = anteriores.get(id_)
        r["primeira_vez_visto"] = (velho or {}).get("primeira_vez_visto") or hoje
        r["ultima_vez_visto"] = hoje
        r["ativo"] = True
        if velho:
            # preserva o que só existia na base anterior (geocodificação, extração IA)
            for k in ("lat", "lng", "geo_precisao", "extracao_ia"):
                if r.get(k) is None and velho.get(k) is not None:
                    r[k] = velho[k]
        saida[id_] = r
    for id_, velho in anteriores.items():
        if id_ in saida:
            continue
        ultima = velho.get("ultima_vez_visto") or hoje
        if ultima >= limite:
            velho = dict(velho)
            velho["ativo"] = False
            saida[id_] = velho
    return saida


def gravar_snapshot(pasta: Path, hoje: str, registros: list[dict], anteriores: dict[str, dict] | None = None,
                    completo: bool = False) -> Path:
    """Snapshot do dia. Por padrão só com os imóveis novos ou cujos campos essenciais mudaram desde a
    base anterior (delta); `completo=True` grava todos (feito no 1º dia do mês). Com bases de dezenas de
    milhares de registros, o snapshot completo diário encheria o repositório."""
    pasta.mkdir(parents=True, exist_ok=True)
    dados = []
    for r in registros:
        if not r.get("ativo", True):
            continue
        atual = {c: r.get(c) for c in CAMPOS_SNAPSHOT}
        if completo or anteriores is None:
            dados.append(atual)
            continue
        velho = anteriores.get(r["id"])
        if velho is None or any(velho.get(c) != atual[c] for c in CAMPOS_SNAPSHOT if c != "id"):
            dados.append(atual)
    caminho = pasta / f"{hoje}.json"
    caminho.write_text(json.dumps(dados, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return caminho


def compactar_snapshots(pasta: Path, hoje: str, dias: int = 90) -> int:
    """Snapshots diários com mais de `dias` viram resumo mensal em pasta/mensal/AAAA-MM.json."""
    limite = date.fromisoformat(hoje) - timedelta(days=dias)
    compactados = 0
    mensal_dir = pasta / "mensal"
    por_mes: dict[str, list[Path]] = {}
    for p in sorted(pasta.glob("????-??-??.json")):
        try:
            d = date.fromisoformat(p.stem)
        except ValueError:
            continue
        if d < limite:
            por_mes.setdefault(p.stem[:7], []).append(p)
    for mes, arquivos in por_mes.items():
        mensal_dir.mkdir(parents=True, exist_ok=True)
        destino = mensal_dir / f"{mes}.json"
        resumo: dict[str, dict] = json.loads(destino.read_text(encoding="utf-8")) if destino.exists() else {}
        for p in arquivos:
            for item in json.loads(p.read_text(encoding="utf-8")):
                v = item.get("valor_minimo")
                e = resumo.setdefault(item["id"], {"primeiro_dia": p.stem, "ultimo_dia": p.stem, "valor_min": v,
                                                   "valor_max": v, "valor_primeiro": v, "valor_ultimo": v,
                                                   "modalidade_ultima": item.get("modalidade"), "dias": 0})
                e["dias"] += 1
                e["ultimo_dia"] = max(e["ultimo_dia"], p.stem)
                e["primeiro_dia"] = min(e["primeiro_dia"], p.stem)
                e["valor_ultimo"] = v
                e["modalidade_ultima"] = item.get("modalidade")
                if v is not None:
                    e["valor_min"] = v if e["valor_min"] is None else min(e["valor_min"], v)
                    e["valor_max"] = v if e["valor_max"] is None else max(e["valor_max"], v)
            p.unlink()
            compactados += 1
        destino.write_text(json.dumps(resumo, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return compactados


def carregar_historico(caminho: Path) -> dict:
    if caminho.exists():
        return json.loads(caminho.read_text(encoding="utf-8"))
    return {"eventos": [], "gerado_em": None}


def gravar_historico(caminho: Path, historico: dict, novos_eventos: list[dict], hoje: str,
                     dias_retencao_eventos: int = 365) -> dict:
    limite = (date.fromisoformat(hoje) - timedelta(days=dias_retencao_eventos)).isoformat()
    eventos = [e for e in historico.get("eventos", []) if e.get("data", "") >= limite]
    eventos.extend(novos_eventos)
    historico = {"gerado_em": datetime.now().isoformat(timespec="seconds"), "eventos": eventos}
    caminho.parent.mkdir(parents=True, exist_ok=True)
    caminho.write_text(json.dumps(historico, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return historico
