"""Fonte HD Leilões (leiloeira pública oficial Hidirlene Duszeiko) — hdleiloes.com.br.

Inspecionado em 2026-10-21: plataforma "Leilões Judiciais Brasil" (vlance). O site é uma SPA jQuery que
consome uma API JSON própria, sem autenticação (sem robots.txt; o mantenedor confirmou o uso por POST):
- POST /core/api/get-lotes  (form: pg, tipo=3 [Imóveis], estado=<UF>, categoria, cidade, valor_min,
  valor_max, palavra_chave) -> {items:[...], totalPages, itemsPerPage=40}; cada item traz lote_id,
  leilao_id, nm_titulo_lote, nm_descricao (HTML), nm_cidade, nm_estado, nm_subcategoria, vl_lanceinicial,
  vl_lanceminimo, vl_lanceinicialsegundoleilao, dt_fechamento, nu_parcelas, vl_percentualentrada,
  nm_statuslote, fotos[], anexos[] (LAUDO DE AVALIAÇÃO, MATRÍCULA, EDITAL...).
- GET /core/api/get-leiloes?pg=N&itens_pagina=40 -> leilões em andamento (datas do 2º leilão,
  nm_statusleilao "Judicial Online"/..., tp_judicial_extrajudicial).
- URL do lote: /leilao/index/leilao_id/<leilao_id>/lote/<lote_id>
Conduz os leilões unificados da JFES (também lidos do PDF pelo módulo `jfes`; a deduplicação junta os dois)
e leilões da Justiça Estadual e extrajudiciais no ES. Nomes de partes não aparecem na API; a descrição
é guardada sem HTML.
"""

from __future__ import annotations

import html as html_mod
import logging
import re

from ..extract_regex import _num, extrair_tudo
from ..schema import completar, normalizar_tipo, novo_registro, preencher_derivados

log = logging.getLogger(__name__)

NOME = "leiloeiro-hd"
SITE = "https://www.hdleiloes.com.br/"
LEILOEIRO = "Hidirlene Duszeiko (HD Leilões)"
ultima_info: dict = {}

_TIPO_IMOVEIS = 3


def _texto(html: str | None) -> str:
    if not html:
        return ""
    t = re.sub(r"</(p|div|li|br|tr)>", "\n", html, flags=re.I)
    t = html_mod.unescape(re.sub(r"<[^>]+>", " ", t))
    return re.sub(r"[ \t]+", " ", re.sub(r"\n\s*\n+", "\n", t)).strip()


def _data(s: str | None) -> str | None:
    if not s:
        return None
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return m.group(0)
    m = re.match(r"(\d{2})/(\d{2})/(\d{4})", s)
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None


def _valor(s) -> float | None:
    if s is None or s == "":
        return None
    if isinstance(s, (int, float)):
        return float(s)
    return _num(re.sub(r"[^\d.,]", "", str(s)))


def indexar_leiloes(itens: list[dict]) -> dict[int, dict]:
    return {it["id"]: it for it in itens if isinstance(it, dict) and "id" in it}


def registro_de_lote(it: dict, leilao: dict | None = None) -> dict:
    leilao = leilao or {}
    descricao = _texto(it.get("nm_descricao"))
    titulo_leilao = it.get("nm_titulo_leilao") or leilao.get("nm") or ""
    status_leilao = (leilao.get("nm_statusleilao") or "")
    judicial = bool(re.search(r"\b(JUSTI[ÇC]A|VARA|TJ|TRT|JUIZADO|JUDICIAL)\b", titulo_leilao + " " + status_leilao, re.I))
    venda_direta = bool(re.search(r"VENDA (DIRETA|P[ÚU]BLICA)", titulo_leilao, re.I))
    natureza = "venda direta" if venda_direta else ("leilão judicial" if judicial else "leilão extrajudicial")
    v1 = _valor(it.get("vl_lanceinicial"))
    v2 = _valor(it.get("vl_lanceinicialsegundoleilao"))
    vmin = _valor(it.get("vl_lanceminimo")) or v1
    anexos = it.get("anexos") or []
    url_edital = url_matricula = url_laudo = None
    for a in anexos:
        nome = (a.get("nm") or "").upper()
        url = a.get("nm_path_completo")
        if "EDITAL" in nome and not url_edital:
            url_edital = url
        elif "MATR" in nome and not url_matricula:
            url_matricula = url
        elif "LAUDO" in nome and not url_laudo:
            url_laudo = url
    fotos = it.get("fotos") or []
    foto = fotos[0].get("nm_path_completo") if fotos and isinstance(fotos[0], dict) else None
    m = re.search(r"Proc(?:esso)?\.?\s*n?[ºo°.]?\s*([\d.\-]{15,30})", descricao, re.I)
    processo = m.group(1) if m else None
    parcelas = it.get("nu_parcelas")
    r = novo_registro(
        id=f"hd-{it.get('lote_id')}",
        fonte=NOME,
        url_anuncio=f"{SITE.rstrip('/')}/leilao/index/leilao_id/{it.get('leilao_id')}/lote/{it.get('lote_id')}",
        url_edital=url_edital,
        url_matricula=url_matricula,
        leiloeiro=it.get("nm_leiloeiro") or LEILOEIRO,
        tipo=normalizar_tipo(it.get("nm_subcategoria") or it.get("nm_titulo_lote")),
        uf=(it.get("nm_estado") or "").upper() or None,
        cidade=it.get("nm_cidade") or None,
        valor_avaliacao=v1 if judicial and v1 else None,  # 1º leilão judicial = 100 % da avaliação
        valor_minimo=vmin,
        natureza=natureza,
        modalidade=(("2º leilão" if (v2 and vmin and vmin <= v2 < (v1 or 0)) else "1º leilão" if v2 else "Leilão online")
                    if not venda_direta else "Venda direta online") + " (HD)",
        data_leilao=_data(it.get("dt_fechamento")),
        data_segunda_praca=_data(leilao.get("dt_segundoleilao_data")) if v2 else None,
        aceita_parcelamento=True if (parcelas and int(parcelas) > 1) else (False if parcelas is not None else None),
        numero_processo=processo,
        comitente=titulo_leilao or None,
        descricao_original=descricao or None,
        url_foto=foto,
    )
    extras = []
    if v2:
        extras.append(f"Lance inicial 2º leilão: R$ {v2:,.2f}".replace(",", "X").replace(".", ",").replace("X", "."))
    if parcelas and int(parcelas) > 1:
        extras.append(f"Parcelamento: entrada {it.get('vl_percentualentrada')}% + {parcelas} parcelas ({it.get('indice_correcao') or 'índice n/i'})")
    if url_laudo:
        extras.append(f"Laudo de avaliação: {url_laudo}")
    if extras:
        r["descricao_original"] = (r["descricao_original"] or "") + " | " + " | ".join(extras)
    completar(r, preencher_null_com=extrair_tudo(descricao))
    return preencher_derivados(r)


def coletar(config: dict, cliente) -> list[dict]:
    ufs = config.get("ufs", [])
    base = SITE.rstrip("/")
    leiloes: dict[int, dict] = {}
    pagina = 1
    while True:
        r = cliente.get(f"{base}/core/api/get-leiloes", params={"pg": pagina, "itens_pagina": 40}, api=True)
        d = r.json()
        leiloes.update(indexar_leiloes(d.get("items") or []))
        if pagina >= int(d.get("totalPages") or 1):
            break
        pagina += 1
    registros: list[dict] = []
    ultima_info.clear()
    ultima_info["leiloes"] = len(leiloes)
    for uf in ufs:
        pagina, total, vistos = 1, 1, 0
        while pagina <= total:
            r = cliente.post(f"{base}/core/api/get-lotes",
                             data={"pg": pagina, "tipo": _TIPO_IMOVEIS, "categoria": "", "estado": uf, "cidade": "",
                                   "valor_min": "", "valor_max": "", "palavra_chave": ""})
            d = r.json()
            total = int(d.get("totalPages") or 1)
            for it in d.get("items") or []:
                vistos += 1
                try:
                    registros.append(registro_de_lote(it, leiloes.get(it.get("leilao_id"))))
                except Exception as e:
                    log.warning("hd: lote %s ignorado: %s", it.get("lote_id"), e)
            pagina += 1
        ultima_info[uf] = vistos
    return registros
