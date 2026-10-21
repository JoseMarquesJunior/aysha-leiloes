"""Fonte Banestes — publicações legais, "Leilão de Bens Imóveis" (banestes.com.br).

Inspecionado em 2026-10-21: a página HTML lista os editais (título, data de publicação, datas do leilão,
PDF do edital, às vezes o site do leiloeiro). O robots.txt do Banestes proíbe todos os PDFs
("Disallow: /*.pdf$"), portanto o edital NÃO é baixado: os lotes do Banestes entram pelo site do
leiloeiro que conduz cada leilão (em 2026: emleilao.com.br, buaizleiloes.com.br e vixleiloes.com.br,
cobertos pelos módulos `suporteleiloes` e `vixleiloes`), onde o comitente aparece como Banestes.
Este módulo devolve zero imóveis e alimenta `docs/data/editais.json` (via ultima_info["editais"]).
"""

from __future__ import annotations

import html as html_mod
import logging
import re

log = logging.getLogger(__name__)

NOME = "banestes"
SITE = "https://www.banestes.com.br/publicacoes_legais/leilao-bem-imovel.html"
ultima_info: dict = {}


def _texto(html: str) -> str:
    return re.sub(r"\s+", " ", html_mod.unescape(re.sub(r"<[^>]+>", " ", html))).strip()


def _iso(d: str) -> str | None:
    m = re.match(r"(\d{2})[./](\d{2})[./](\d{2,4})", d)
    if not m:
        return None
    ano = m.group(3) if len(m.group(3)) == 4 else "20" + m.group(3)
    return f"{ano}-{m.group(2)}-{m.group(1)}"


def parsear_editais(html: str) -> list[dict]:
    """Cada item da lista: titulo, publicado_em, datas de leilão, url do PDF e sites citados."""
    corpo = re.sub(r"<script.*?</script>|<style.*?</style>", "", html, flags=re.S)
    corpo = re.sub(r"<!--.*?-->", "", corpo, flags=re.S)  # editais retirados ficam comentados no HTML
    # cada edital é um <div data-jplist-item class="elemento-accordion"> com <h3 class="titulo-edital">
    blocos = re.split(r'(?=<div[^>]*class="elemento-accordion")', corpo)
    saida = []
    for b in blocos:
        h3 = re.search(r'<h3[^>]*titulo-edital[^>]*>(.*?)</h3>', b, re.S)
        if not h3:
            continue
        pub = re.search(r'<span class="data-publicacao">\s*([\d.]+)\s*</span>', h3.group(1))
        titulo_ = _texto(re.sub(r"<span.*?</span>", "", h3.group(1), flags=re.S))
        m = re.search(r"displayWindow\('([^']+\.pdf)'", b)
        url = m.group(1) if m else None
        if url and url.startswith("//"):
            url = "https:" + url
        t = _texto(b)
        datas = [_iso(d) for d in re.findall(r"\b(\d{2}/\d{2}/\d{4})\b", t)]
        sites = sorted(set(re.findall(r"\b(?:www\.)?([a-z0-9\-]+\.(?:com\.br|lel\.br|com))\b", t)))
        objeto = re.search(r"Objeto:\s*(.+?)\s+(?:Data|ID CIDADES|Início|Local)", t)
        saida.append({
            "fonte": NOME,
            "titulo": titulo_,
            "publicado_em": _iso(pub.group(1)) if pub else None,
            "data_leilao": datas[0] if datas else None,
            "data_segunda_praca": datas[1] if len(datas) > 1 else None,
            "url": url,
            "objeto": objeto.group(1).strip() if objeto else None,
            "sites_leiloeiro": ["https://www." + s for s in sites if "banestes" not in s],
            "imovel": "imóve" in titulo_.lower() or "imove" in (url or "").lower(),
        })
    return saida


def coletar(config: dict, cliente) -> list[dict]:
    r = cliente.get(SITE)
    editais = [e for e in parsear_editais(r.text) if e["imovel"]]
    ultima_info.clear()
    ultima_info.update({"editais": editais, "total_editais_imoveis": len(editais)})
    log.info("banestes: %d editais de imóveis listados (PDFs bloqueados por robots; lotes via leiloeiros)", len(editais))
    return []
