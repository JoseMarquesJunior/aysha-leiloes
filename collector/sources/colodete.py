"""Fonte Colodete Leilões (leiloeiro oficial Mauro Colodete, JUCEES 051/2006) — colodeteleiloes.com.br.

Inspecionado em 2026-10-21: plataforma própria (SOLEON). robots.txt: "User-agent: * / Allow: /" com
Content-Signal search=yes, ai-train=no (bloqueia só robôs de IA nomeados; este coletor é identificado
pelo nome do projeto e usa o conteúdo apenas como referência com link para a origem).
- /leiloes                      -> links /leilao/<id>/lotes
- /leilao/<id>/lotes?page=N     -> cabeçalho (leiloeiro, JUDICIAL/EXTRAJUDICIAL, 1º/2º leilão com datas e
  valores, comitente) e cards de lote (título, Cidade: X/UF, Matrícula, Descrição, Lance Inicial, 2º leilão)
- /item/<id>/detalhes           -> comissão (%), avaliação, datas, documentos (PDF da matrícula), descrição completa
"""

from __future__ import annotations

import html as html_mod
import logging
import re

from ..extract_regex import _num, extrair_tudo
from ..schema import completar, normalizar_tipo, novo_registro, preencher_derivados, titulo

log = logging.getLogger(__name__)

NOME = "leiloeiro-colodete"
SITE = "https://www.colodeteleiloes.com.br/"
LEILOEIRO = "Mauro Colodete (Colodete Leilões, JUCEES 051/2006)"
ultima_info: dict = {}


def _texto(html: str) -> str:
    corpo = re.sub(r"<script.*?</script>|<style.*?</style>", "", html, flags=re.S)
    return re.sub(r"\s+", " ", html_mod.unescape(re.sub(r"<[^>]+>", " ", corpo))).strip()


def links_de_leiloes(html: str) -> list[str]:
    return sorted(set(re.findall(r'href="(https?://[^"]*/leilao/\d+/lotes)"', html)))


def cabecalho_leilao(html: str) -> dict:
    t = _texto(html)
    info = {"judicial": bool(re.search(r"\bJUDICIAL\b", t)) and not re.search(r"\bEXTRAJUDICIAL\b", t[:1500])}
    m = re.search(r"1º Leilão:\s*(\d{2})/(\d{2})/(\d{4})", t)
    info["data1"] = f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None
    m = re.search(r"2º Leilão:\s*(\d{2})/(\d{2})/(\d{4})", t)
    info["data2"] = f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None
    if not info["data1"]:
        m = re.search(r"Data:\s*(\d{2})/(\d{2})/(\d{4})", t)
        info["data1"] = f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None
    m = re.search(r"Comitente:\s*(.+?)\s+(?:Uma|Um|\d|Configura|Lista|Casa|Apart|Terreno|Imóv|Lote)", t)
    info["comitente"] = m.group(1).strip() if m else None
    m = re.search(r"Total\s+(\d+)\s+Lotes", t)
    info["total_lotes"] = int(m.group(1)) if m else None
    return info


def cards_de_lotes(html: str) -> list[dict]:
    saida = []
    for bloco in re.split(r"(?=<h4[^>]*>\s*Lote\s+\d+\s*</h4>)", html)[1:]:
        m = re.search(r"<h4[^>]*>\s*Lote\s+(\d+)\s*</h4>", bloco)
        link = re.search(r'href="(https?://[^"]*/item/(\d+)/detalhes[^"]*)"', bloco)
        if not link:
            continue
        tit = re.search(r"<h5>(.*?)</h5>", bloco, re.S)
        t = _texto(bloco)
        cid = re.search(r"Cidade:\s*(.+?)/([A-Z]{2})\b", t)
        mat = re.search(r"Matrícula:\s*(.+?)\s+Descrição:", t)
        desc = re.search(r"Descrição:\s*(.+?)\s+(?:Lance Inicial|Aguarde|Detalhes)", t)
        lance = re.search(r"Lance Inicial\s*R\$\s*([\d.,]+)", t)
        lance2 = re.search(r"Lance Inicial 2[°º] Leilão:\s*R\$\s*([\d.,]+)", t)
        saida.append({
            "numero": m.group(1) if m else None,
            "url": link.group(1).split("?")[0],
            "item_id": link.group(2),
            "titulo": _texto(tit.group(1)) if tit else None,
            "cidade": cid.group(1).strip() if cid else None,
            "uf": cid.group(2) if cid else None,
            "matricula": mat.group(1).strip() if mat else None,
            "descricao": desc.group(1).strip() if desc else None,
            "lance": _num(lance.group(1)) if lance else None,
            "lance2": _num(lance2.group(1)) if lance2 else None,
        })
    return saida


def parsear_detalhe(html: str) -> dict:
    t = _texto(html)
    info = {}
    m = re.search(r"Comissão \((\d+(?:[.,]\d+)?)%\)", t)
    info["comissao"] = _num(m.group(1)) if m else None
    m = re.search(r"Valor de Avaliação:\s*R\$\s*([\d.,]+)", t)
    info["avaliacao"] = _num(m.group(1)) if m else None
    m = re.search(r"Data 1º Leilão:\s*(\d{2})/(\d{2})/(\d{4})", t)
    info["data1"] = f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None
    m = re.search(r"Data 2º Leilão:\s*(\d{2})/(\d{2})/(\d{4})", t)
    info["data2"] = f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None
    m = re.search(r"Comitente:\s*(.+?)\s+Cidade:", t)
    info["comitente"] = m.group(1).strip() if m else None
    m = re.search(r"Endereço:\s*(.+?)\s+Matrícula:", t)
    info["endereco"] = m.group(1).strip() if m and m.group(1).strip() else None
    m = re.search(r"Descrição:\s*(.+?)\s+Localização do Imóvel", t)
    info["descricao"] = m.group(1).strip() if m else None
    info["judicial"] = bool(re.search(r"LEILÃO JUDICIAL", t))
    info["url_matricula"] = next((u for u in re.findall(r'href="([^"]+\.pdf)"', html, re.I) if "matricula" in u.lower()), None)
    return info


def _primeira_matricula(texto: str | None) -> str | None:
    if not texto:
        return None
    m = re.search(r"\d[\d.]*", texto)
    return m.group(0).replace(".", "") if m else None


def registro(card: dict, cab: dict, det: dict | None) -> dict:
    det = det or {}
    descricao = det.get("descricao") or card.get("descricao") or ""
    r = novo_registro(
        id=f"colodete-{card['item_id']}",
        fonte=NOME,
        url_anuncio=card["url"],
        url_matricula=det.get("url_matricula"),
        leiloeiro=LEILOEIRO,
        tipo=normalizar_tipo(card.get("titulo") or descricao[:60]),
        uf=card.get("uf"),
        cidade=titulo(card["cidade"]) if card.get("cidade") and card["cidade"].isupper() else card.get("cidade"),
        endereco=det.get("endereco"),
        valor_avaliacao=det.get("avaliacao"),
        valor_minimo=card.get("lance"),
        natureza="leilão judicial" if (det.get("judicial") or cab.get("judicial")) else "leilão extrajudicial",
        modalidade="1º leilão" if (det.get("data2") or cab.get("data2")) else "Leilão online",
        data_leilao=det.get("data1") or cab.get("data1"),
        data_segunda_praca=det.get("data2") or cab.get("data2"),
        comissao_leiloeiro_pct=det.get("comissao"),
        matricula=_primeira_matricula(card.get("matricula")),
        comitente=det.get("comitente") or cab.get("comitente"),
        descricao_original=(descricao + (f" | Lance 2º leilão: R$ {card['lance2']:,.2f}" if card.get("lance2") else "")) or None,
    )
    completar(r, preencher_null_com=extrair_tudo(descricao))
    return preencher_derivados(r)


def coletar(config: dict, cliente) -> list[dict]:
    ufs = set(config.get("ufs", []))
    base = SITE.rstrip("/")
    r = cliente.get(f"{base}/leiloes")
    leiloes = links_de_leiloes(r.text)
    ultima_info.clear()
    ultima_info.update({"leiloes": len(leiloes), "lotes_vistos": 0})
    registros: list[dict] = []
    for url in leiloes:
        pagina = 1
        vistos_url: set[str] = set()
        while True:
            pg = cliente.get(url, params={"page": pagina})
            cab = cabecalho_leilao(pg.text)
            cards = cards_de_lotes(pg.text)
            novos = [c for c in cards if c["url"] not in vistos_url]
            if not novos:
                break
            for card in novos:
                vistos_url.add(card["url"])
                ultima_info["lotes_vistos"] += 1
                if ufs and card.get("uf") not in ufs:
                    continue
                det = None
                try:
                    det = parsear_detalhe(cliente.get(card["url"]).text)
                except Exception as e:
                    log.warning("colodete: detalhe %s falhou: %s", card["url"], e)
                registros.append(registro(card, cab, det))
            total = cab.get("total_lotes") or 0
            if len(vistos_url) >= total or len(cards) < 10:
                break
            pagina += 1
    return registros
