"""Fonte Mega Leilões (megaleiloes.com.br) — leiloeiro oficial Fernando José Cerello Gonçalves Pereira
(JUCESP 844; também JUCEMG 1192 e JUCEMAT 73). Leilões judiciais e extrajudiciais (bancos) no país todo.

Inspecionado em 2026-10-28: robots.txt permite tudo exceto /login; não encontramos página de termos de
uso (só a Política de Privacidade, em PDF no CDN). A listagem de imóveis é renderizada no servidor:
GET /imoveis?pagina=N devolve 48 cards e o total ("Página 1 de 17"). Cada card traz código
(X=extrajudicial / J=judicial + nº), título (tipo, área, cidade-UF, endereço - bairro), preço atual,
natureza, status, datas e valores das praças e o ícone do banco vendedor; só lotes "Aberto para lances"
aparecem. A página do lote (buscada apenas para as UFs em `fontes.megaleiloes.detalhe_ufs`, para não
multiplicar centenas de requisições a 2 s cada) acrescenta edital e matrícula em PDF, comitente e a
descrição completa, de onde saem matrícula, ocupação e áreas por regex. Nomes de partes não aparecem.
"""

from __future__ import annotations

import html as html_mod
import logging
import re

from ..extract_regex import _num, extrair_tudo
from ..schema import completar, normalizar_tipo, novo_registro, preencher_derivados, titulo as titulo_prop

log = logging.getLogger(__name__)

NOME = "leiloeiro-mega"
SITE = "https://www.megaleiloes.com.br/"
LEILOEIRO = "Fernando José Cerello Gonçalves Pereira (Mega Leilões, JUCESP 844)"
ultima_info: dict = {}

_CARD = re.compile(r'<div class="col-sm-6 col-md-4 col-lg-3" data-key="\d+">')
_PRACA = re.compile(
    r'card-(?:first|second)-instance-date">\s*<b>([^<]*)</b>\s*(\d{2}/\d{2}/\d{4})[^<]*</span>\s*'
    r'<span class="card-instance-value">R\$\s*([\d.,]+)', re.S)
_TITULO = re.compile(
    r"^(?P<tipo>.+?)(?:\s+(?P<area>[\d.,]+)\s*m²)?\s*-\s*(?P<cidade>.+?)-(?P<uf>[A-Z]{2})\s*-\s*(?P<resto>.+)$")


def _texto(html: str | None) -> str:
    if not html:
        return ""
    t = re.sub(r"</(p|div|li|br|tr)>|<br\s*/?>", "\n", html, flags=re.I)
    t = html_mod.unescape(re.sub(r"<[^>]+>", " ", t))
    return re.sub(r"[ \t]+", " ", re.sub(r"\n\s*\n+", "\n", t)).strip()


def _valor(s: str | None) -> float | None:
    return _num(s) if s else None


def _data(s: str | None) -> str | None:
    m = re.match(r"(\d{2})/(\d{2})/(\d{4})", s or "")
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None


def total_paginas(html: str) -> int | None:
    m = re.search(r"P[áa]gina <b>\d+</b> de <b>(\d+)</b>", html)
    return int(m.group(1)) if m else None


def cards_da_lista(html: str) -> list[str]:
    partes = _CARD.split(html)
    return partes[1:]  # o primeiro pedaço é o cabeçalho da página


def registro_de_card(card: str) -> dict | None:
    m = re.search(r'<a class="card-title" href="([^"]+)"[^>]*>([^<]+)</a>', card)
    if not m:
        return None
    url = m.group(1).split("?")[0]
    titulo = html_mod.unescape(m.group(2)).strip()
    codigo = (re.search(r'card-number[^>]*">([A-Z]?\d+)<', card) or [None, None])[1]
    if not codigo:
        return None
    status = (re.search(r'card-status">([^<]+)<', card) or [None, ""])[1].strip()
    if re.search(r"finalizad|encerrad|cancelad|suspens", status, re.I):
        return None
    preco = _valor((re.search(r'card-price">R\$\s*([\d.,]+)', card) or [None, None])[1])
    local = (re.search(r'class="card-locality"[^>]*title="([^"]+)"', card) or [None, ""])[1]
    cidade, _, uf_local = [html_mod.unescape(x).strip() for x in local.partition(",")]
    nat_txt = (re.search(r'card-instance-title"><a[^>]*>([^<]+)</a>', card) or [None, ""])[1].strip()
    natureza = {"Extrajudicial": "leilão extrajudicial", "Judicial": "leilão judicial"}.get(
        nat_txt, "venda direta" if "venda direta" in nat_txt.lower() else None)
    banco = (re.search(r"bank_icons/(?:leilao-)?([a-z0-9\-]+)\.", card) or [None, None])[1]
    if banco and "megaleiloes" in banco:  # logo da própria Mega (judiciais) não é comitente
        banco = None
    comitente = titulo_prop(banco.replace("-", " ")) if banco else None

    t = _TITULO.match(titulo)
    tipo = normalizar_tipo(t.group("tipo")) if t else normalizar_tipo(titulo)
    area = _valor(t.group("area")) if t else None
    uf = (t.group("uf") if t else uf_local).upper() or None
    endereco = bairro = None
    if t:
        partes = [x.strip() for x in t.group("resto").split(" - ")]
        if len(partes) > 1 and partes[-1] and not re.search(r"\d", partes[-1]):
            bairro, endereco = partes[-1], " - ".join(partes[:-1])
        else:
            endereco = t.group("resto").strip()

    # praças do card: "Data:" (única) ou "1ª Praça:" e "2ª Praça:", cada uma com data e valor
    d1 = v1 = d2 = v2 = None
    for rotulo, data_br, valor in _PRACA.findall(card):
        if rotulo.strip().startswith("2"):
            d2, v2 = _data(data_br), _valor(valor)
        elif d1 is None:
            d1, v1 = _data(data_br), _valor(valor)
    if d2:
        modalidade = "2ª praça" if (preco is not None and v2 is not None and abs(preco - v2) < 0.01) else "1ª praça"
    else:
        modalidade = "Praça única"

    r = novo_registro(
        id=f"mega-{codigo}",
        fonte=NOME,
        url_anuncio=url,
        leiloeiro=LEILOEIRO,
        tipo=tipo,
        uf=uf,
        cidade=cidade or (t.group("cidade").strip() if t else None),
        bairro=bairro,
        endereco=endereco,
        valor_avaliacao=v1 if d2 else None,  # com 2 praças, a 1ª sai pelo valor de referência/avaliação
        valor_minimo=preco if preco is not None else v1,
        natureza=natureza,
        modalidade=f"{modalidade} (Mega)",
        data_leilao=d1,
        data_segunda_praca=d2,
        comitente=comitente,
        descricao_original=titulo,
    )
    if area:
        if tipo == "terreno":
            r["area_terreno_m2"] = area
        else:
            r["area_total_m2"] = area
    completar(r, preencher_null_com=extrair_tudo(titulo))
    return preencher_derivados(r)


def aplicar_detalhe(r: dict, html: str) -> dict:
    """Preenche o registro com a página do lote: PDFs, comitente e descrição completa."""
    pdfs = re.findall(r'href="(https://cdn1\.megaleiloes\.com\.br/[^"]+\.pdf[^"]*)"', html)
    for u in pdfs:
        nome = u.lower()
        if "edital" in nome and not r["url_edital"]:
            r["url_edital"] = u
        elif "matricula" in nome and not r["url_matricula"]:
            r["url_matricula"] = u
    m = re.search(r'>Comitente</div>\s*<div class="value">\s*([^<]+?)\s*</div>', html)
    if m:
        r["comitente"] = html_mod.unescape(m.group(1)).strip()
    m = re.search(r'id="tab-description"[^>]*>\s*<div class="content">(.*?)</div>', html, re.S)
    if m:
        desc = _texto(m.group(1))
        if desc:
            r["descricao_original"] = desc
            if re.search(r"\bOcupad[oa]\b", desc) and r["ocupado"] is None:
                r["ocupado"] = True
            completar(r, preencher_null_com=extrair_tudo(desc))
    return preencher_derivados(r)


def coletar(config: dict, cliente) -> list[dict]:
    cfg = config["fontes"].get("megaleiloes", {})
    ufs = set(config.get("ufs") or [])
    detalhe_ufs = set(cfg.get("detalhe_ufs") or [])
    max_paginas = int(cfg.get("maximo_paginas") or 40)
    registros: list[dict] = []
    ultima_info.clear()
    pagina, total, vistos = 1, 1, 0
    while pagina <= min(total, max_paginas):
        resp = cliente.get(f"{SITE}imoveis", params={"pagina": pagina})
        html = resp.content.decode("utf-8", "replace")
        total = total_paginas(html) or total
        for card in cards_da_lista(html):
            vistos += 1
            try:
                r = registro_de_card(card)
            except Exception as e:
                log.warning("mega: card ignorado na página %d: %s", pagina, e)
                continue
            if not r or (ufs and r["uf"] not in ufs):
                continue
            registros.append(r)
        pagina += 1
    detalhes = 0
    for r in registros:
        if r["uf"] not in detalhe_ufs:
            continue
        try:
            resp = cliente.get(r["url_anuncio"])
            aplicar_detalhe(r, resp.content.decode("utf-8", "replace"))
            detalhes += 1
        except Exception as e:
            log.warning("mega: detalhe de %s falhou: %s", r["id"], e)
    por_uf: dict[str, int] = {}
    for r in registros:
        por_uf[r["uf"] or "?"] = por_uf.get(r["uf"] or "?", 0) + 1
    ultima_info.update({"paginas": pagina - 1, "cards_vistos": vistos, "detalhes_buscados": detalhes, **por_uf})
    return registros
