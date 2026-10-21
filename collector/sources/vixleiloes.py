"""Fonte VIX Leilões (leiloeiro oficial Gabriel Fardin Pereira, JUCEES 055/2013) — vixleiloes.com.br.

Inspecionado em 2026-10-21: plataforma Suporte Leilões (layout novo). robots.txt permite tudo exceto /api/ e
/login, então só páginas HTML são lidas:
- /leiloes?status=ao-vivo | em-breve | encerrando  -> cards de leilão com categoria ("Imóveis", "Público"...)
- /leiloes/<id>-<slug>                              -> lista de lotes, links /lote/<id>-<slug>, PDF do edital
- /lote/<id>-<slug>                                 -> JSON-LD schema.org/Product (nome, descrição, preço,
  endereço com cidade/UF) + texto com "Valor de avaliação", "Comitente", data/hora do encerramento.
Conduz leilões judiciais do TJES e extrajudiciais (Banestes aparece como comitente quando é o caso).
"""

from __future__ import annotations

import html as html_mod
import json
import logging
import re

from ..extract_regex import _num, extrair_tudo
from ..schema import completar, normalizar_tipo, novo_registro, preencher_derivados, titulo

log = logging.getLogger(__name__)

NOME = "leiloeiro-vix"
SITE = "https://www.vixleiloes.com.br/"
LEILOEIRO = "Gabriel Fardin Pereira (VIX Leilões, JUCEES 055/2013)"
ultima_info: dict = {}

_STATUS = ("ao-vivo", "em-breve", "encerrando")


def _texto(html: str) -> str:
    corpo = re.sub(r"<script.*?</script>|<style.*?</style>", "", html, flags=re.S)
    return re.sub(r"\s+", " ", html_mod.unescape(re.sub(r"<[^>]+>", " ", corpo))).strip()


def links_de_leiloes(html: str) -> list[str]:
    return sorted(set(re.findall(r'href="(/leiloes/\d+-[^"]+)"', html)))


def links_de_lotes(html: str) -> list[str]:
    return sorted(set(re.findall(r'href="(/lote/\d+-[^"]+)"', html)))


def _ld_json(html: str) -> dict | None:
    for bloco in re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S):
        try:
            d = json.loads(bloco)
        except json.JSONDecodeError:
            continue
        if isinstance(d, dict) and d.get("@type") == "Product":
            return d
    return None


def _campo(texto: str, rotulo: str, parada: str = r"(?=\s[A-ZÁÉÍÓÚÇ][a-záéíóúç]+(?:/UF)?\s|$)") -> str | None:
    m = re.search(re.escape(rotulo) + r"\s*(.+?)" + parada, texto)
    return m.group(1).strip() if m else None


def parsear_lote(html: str, url: str, url_edital: str | None = None) -> dict | None:
    ld = _ld_json(html)
    texto = _texto(html)
    if not ld:
        return None
    rel = ld.get("isRelatedTo") or {}
    end = rel.get("address") or {}
    uf = (end.get("addressRegion") or "").upper() or None
    cidade = end.get("addressLocality") or None
    oferta = ld.get("offers") or {}
    categoria = (ld.get("category") or "")
    if "im" not in categoria.lower():  # só imóveis
        return None
    m_id = re.search(r"/lote/(\d+)", url)
    descricao = ld.get("description") or ""
    m_desc = re.search(r"Descrição do lote\s*(.+?)\s*Especificações", texto)
    if m_desc:
        descricao = m_desc.group(1).strip()
    aval = None
    m = re.search(r"Valor de avaliação\s*R\$\s*([\d.,]+)", texto)
    if m:
        aval = _num(m.group(1))
    lance = oferta.get("price")
    if lance is None:
        m = re.search(r"Lance inicial\s*R\$\s*([\d.,]+)", texto)
        lance = _num(m.group(1)) if m else None
    data = None
    m = re.search(r"\b(\d{2})/(\d{2})/(\d{4}),?\s*\d{2}:\d{2}", texto)
    if m:
        data = f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    comitente = _campo(texto, "Comitente:", r"(?=\s\d|\s[A-Z][a-z]|$)")
    m = re.search(r"\bTipo\s+([A-Za-zçãõéíáú]+)\s+Identificador", texto)
    tipo_fonte = m.group(1) if m else None
    bairro = None
    espec = texto[texto.find("Especificações"):] if "Especificações" in texto else ""
    m = re.search(r".*\bBairro\s+(.+?)\s+Cidade/UF", espec)  # último "Bairro" antes de Cidade/UF
    if m:
        bairro = m.group(1).strip()
    judicial = bool(re.search(r"\b(TJES|TRT|JUSTI[ÇC]A|VARA|JUIZ)", (comitente or "") + " " + (url_edital or ""), re.I)) \
        or bool(re.search(r"\bvara\b|\bprocesso\b|\bexequente\b", descricao, re.I))
    matricula = None
    m = re.search(r"Identificador\s+([\d.]+)", texto)
    if m:
        matricula = m.group(1).replace(".", "")
    fotos = ld.get("image") or []
    r = novo_registro(
        id=f"vix-{m_id.group(1) if m_id else url}",
        fonte=NOME,
        url_anuncio=url,
        url_edital=url_edital,
        leiloeiro=LEILOEIRO,
        tipo=normalizar_tipo(tipo_fonte or ld.get("name")),
        uf=uf,
        cidade=titulo(cidade) if cidade and cidade.isupper() else cidade,
        bairro=bairro,
        endereco=end.get("streetAddress") or None,
        valor_avaliacao=aval,
        valor_minimo=float(lance) if lance is not None else None,
        natureza="leilão judicial" if judicial else "leilão extrajudicial",
        modalidade="Leilão online (VIX)",
        data_leilao=data,
        matricula=matricula,
        descricao_original=descricao or None,
        url_foto=fotos[0] if fotos else None,
        comitente=comitente,
    )
    completar(r, preencher_null_com=extrair_tudo(descricao))
    return preencher_derivados(r)


def coletar(config: dict, cliente) -> list[dict]:
    ufs = set(config.get("ufs", []))
    base = SITE.rstrip("/")
    leiloes: set[str] = set()
    for st in _STATUS:
        r = cliente.get(f"{base}/leiloes", params={"status": st})
        leiloes.update(links_de_leiloes(r.text))
    # "Aberto para lances" não aparece em nenhum filtro de status: lê também as primeiras páginas da lista geral
    for pagina in range(1, config["fontes"]["vixleiloes"].get("paginas_lista", 3) + 1):
        r = cliente.get(f"{base}/leiloes", params={"page": pagina})
        leiloes.update(links_de_leiloes(r.text))
    registros: list[dict] = []
    ultima_info.clear()
    ultima_info.update({"leiloes_abertos": len(leiloes), "lotes_vistos": 0})
    for caminho in sorted(leiloes):
        pagina = cliente.get(base + caminho)
        txt = _texto(pagina.text)
        if "Imóve" not in txt:
            continue
        cab = txt[:800]
        if "Encerrado" in cab and "Aberto" not in cab and "Em breve" not in cab and "Encerrando" not in cab:
            continue
        m = re.search(r'href="([^"]+\.pdf)"', pagina.text, re.I)
        url_edital = m.group(1) if m else None
        if url_edital and url_edital.startswith("/"):
            url_edital = base + url_edital
        for lote in links_de_lotes(pagina.text):
            ultima_info["lotes_vistos"] += 1
            pl = cliente.get(base + lote)
            try:
                reg = parsear_lote(pl.text, base + lote, url_edital)
            except Exception as e:  # um lote ruim não derruba a fonte
                log.warning("vix: lote %s ignorado: %s", lote, e)
                continue
            if reg and (not ufs or reg.get("uf") in ufs):
                registros.append(reg)
    return registros
