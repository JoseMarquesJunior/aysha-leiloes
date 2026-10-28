"""Fonte Frazão Leilões (frazaoleiloes.com.br) — leiloeiros oficiais Carlos Alberto F. S. Frazão
(JUCESP 203), Carlos Eduardo L. C. Frazão (JUCESP 751) e Ana Claudia C. C. Frazão (JUCESP 836).
Leilões de imóveis de bancos (Santander, Itaú, Inter) e judiciais, com lotes no país inteiro.

Inspecionado em 2026-10-28: robots.txt permite tudo exceto /Auction/Index/ e /Comitente/Dashboard e
aponta sitemap.xml, que inclui um sitemap-lotes.xml com um URL por lote ativo (imóveis e bens diversos).
A página "Termos de Uso" não renderiza o texto sem JavaScript; nada visível proíbe coleta, e o sitemap
de lotes é um convite explícito à indexação. Cada página de lote é renderizada no servidor com campos
rotulados (<strong>Rótulo: </strong><span>valor</span>): tipo do imóvel, status da ocupação, áreas,
matrícula, cartório, Valor Avaliado, lance inicial, data do leilão e condições de pagamento. Lotes sem o
campo "Tipo do Imóvel" são bens diversos (descartados). A descrição às vezes traz o número do
contribuinte municipal no formato de CPF: é removido antes de salvar. O edital carrega por JS
(sem URL estática), então url_edital fica vazio.
"""

from __future__ import annotations

import html as html_mod
import logging
import re

from ..extract_regex import _num, extrair_tudo
from ..schema import completar, normalizar_tipo, novo_registro, preencher_derivados, titulo as titulo_prop

log = logging.getLogger(__name__)

NOME = "leiloeiro-frazao"
SITE = "https://www.frazaoleiloes.com.br/"
LEILOEIRO = "Frazão Leilões (JUCESP 203, 751 e 836)"
ultima_info: dict = {}

_CEP = re.compile(r"^\d{5}-?\d{3}$")


def _campo(h: str, rotulo: str) -> str | None:
    m = re.search(rf"<strong>\s*{re.escape(rotulo)}:?\s*</strong>\s*<span>([^<]*)</span>", h, re.I)
    v = (m.group(1).strip() if m else "") or None
    return v


def _texto(html: str) -> str:
    t = re.sub(r"<br\s*/?>", "\n", html, flags=re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    return re.sub(r"[ \t]+", " ", re.sub(r"\n\s*\n+", "\n", t)).strip()


def _sem_cpf(t: str | None) -> str | None:
    """Remove número de contribuinte/CPF ("Contribuinte: 096.623.401-49") da descrição."""
    if not t:
        return t
    t = re.sub(r"[/ ]?Contribuinte:?\s*[\d.\-]+", "", t)
    return re.sub(r"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b", "", t).strip()


def _data(d: str | None) -> str | None:
    m = re.match(r"(\d{2})/(\d{2})/(\d{4})", d or "")
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None


def _endereco(linha: str) -> dict:
    """"RUA 5, S/N, APTO 1012, ..., NORTE, Brasília, DF, 71907-720" -> endereço, bairro, cidade, UF."""
    partes = [p.strip() for p in linha.split(",") if p.strip()]
    if partes and _CEP.match(partes[-1]):
        partes.pop()
    uf = cidade = bairro = None
    if partes and re.fullmatch(r"[A-Z]{2}", partes[-1]):
        uf = partes.pop()
    if partes:
        cidade = partes.pop()
    if len(partes) > 1 and not re.search(r"\d", partes[-1]):
        bairro = titulo_prop(partes.pop())
    return {"endereco": ", ".join(partes) or None, "bairro": bairro, "cidade": cidade, "uf": uf}


def eh_imovel(h: str) -> bool:
    return bool(re.search(r"<strong>\s*Tipo do Im[óo]vel", h, re.I))


def parsear_lote(url: str, html: str) -> dict | None:
    """Registro a partir da página do lote; None para bens diversos e lotes encerrados."""
    h = html_mod.unescape(html)
    if not eh_imovel(h):
        return None
    m = re.search(r'auction-status"[^>]*>\s*([^<]+?)\s*<', h)
    status = m.group(1) if m else ""
    if re.search(r"encerrad|finalizad|vendid|arremat|suspens|cancelad|retirad", status, re.I):
        return None
    m = re.search(r"/lote/(\d+)", url)
    if not m:
        return None
    lote_id = m.group(1)
    m = re.search(r'<a href="/leilao/\d+/[^"]*">\s*([^<]+?)\s*</a>', h)
    titulo_leilao = re.sub(r"\s*\|\s*\d+\s*$", "", m.group(1)).strip() if m else None
    m = re.search(r'<h1 class="[^"]*lot-title"[^>]*>\s*([^<]+?)\s*</h1>', h)
    titulo = m.group(1).strip() if m else None
    m = re.search(r"Endereço Completo\s*</strong>\s*<br\s*/?>\s*([^<]+)", h)
    end = _endereco(m.group(1).strip()) if m else {}
    m = re.search(r"Leilão:\s*(\d{2}/\d{2}/\d{4})\s*às\s*(\d{1,2})h(\d{2})", h)
    data1 = _data(m.group(1)) if m else None
    m = re.search(r"2º\s*Leilão:?\s*(\d{2}/\d{2}/\d{4})", h)
    data2 = _data(m.group(1)) if m else None
    m = re.search(r"Lance inicial:\s*(?:<br\s*/?>\s*)?<strong>\s*R\$\s*([\d.,]+)", h)
    lance = _num(m.group(1)) if m else None
    avaliacao = _num((_campo(h, "Valor Avaliado") or "").replace("R$", ""))
    ocupacao = _campo(h, "Status da Ocupação")
    descricao = _sem_cpf(_campo(h, "Descrição"))
    m = re.search(r"Considerações Importantes\s*</strong>\s*<br\s*/?>(.{0,1800}?)</(?:p|div|span)>", h, re.S)
    consideracoes = _sem_cpf(_texto(m.group(1))) if m else None
    m = re.search(r'property="og:image" content="([^"]+)"', h)
    foto = m.group(1) if m else None
    judicial = bool(re.search(r"judicial|\bvara\b|processo", (titulo_leilao or "") + " " + (status or ""), re.I))
    venda_direta = bool(re.search(r"venda direta", titulo_leilao or "", re.I))
    condicoes = re.search(r"Condições de pagamento \(consulte o edital[^<]*(.{0,900})", h, re.S)
    parcelamento = bool(re.search(r"\bparcelas?\b", _texto(condicoes.group(1)), re.I)) if condicoes else None

    def area(rotulo):
        v = _campo(h, rotulo)
        return _num(v.replace("m²", "").strip()) if v else None

    r = novo_registro(
        id=f"frazao-{lote_id}",
        fonte=NOME,
        url_anuncio=url,
        leiloeiro=LEILOEIRO,
        tipo=normalizar_tipo(_campo(h, "Tipo do Imóvel") or titulo),
        uf=end.get("uf"),
        cidade=end.get("cidade"),
        bairro=end.get("bairro"),
        endereco=end.get("endereco"),
        area_privativa_m2=area("Área Privativa"),
        area_total_m2=area("Área Total") or area("Área Construída"),
        area_terreno_m2=area("Área do Terreno") or area("Área Terreno"),
        valor_avaliacao=avaliacao,
        valor_minimo=lance,
        natureza="venda direta" if venda_direta else ("leilão judicial" if judicial else "leilão extrajudicial"),
        modalidade=("2º leilão" if data2 else "Leilão online") + " (Frazão)",
        data_leilao=data1,
        data_segunda_praca=data2,
        ocupado=True if (ocupacao or "").lower().startswith("ocup") else (False if (ocupacao or "").lower().startswith("desocup") else None),
        aceita_parcelamento=parcelamento,
        matricula=(_campo(h, "Matrícula") or "").replace(".", "") or None,
        comitente=titulo_leilao,
        descricao_original=" | ".join(x for x in (descricao, consideracoes) if x) or titulo,
        url_foto=foto,
    )
    completar(r, preencher_null_com=extrair_tudo(r["descricao_original"] or ""))
    return preencher_derivados(r)


def coletar(config: dict, cliente) -> list[dict]:
    cfg = config["fontes"].get("frazao", {})
    ufs = set(config.get("ufs") or [])
    maximo = cfg.get("maximo_lotes")
    resp = cliente.get(f"{SITE}sitemap-lotes.xml")
    urls = re.findall(r"<loc>([^<]+)</loc>", resp.text)
    ultima_info.clear()
    ultima_info["lotes_no_sitemap"] = len(urls)
    if maximo:
        urls = urls[: int(maximo)]
    registros: list[dict] = []
    pulados = erros = 0
    for url in urls:
        try:
            page = cliente.get(url)
            r = parsear_lote(url, page.content.decode("utf-8", "replace"))
        except Exception as e:
            erros += 1
            log.warning("frazao: lote %s falhou: %s", url, e)
            continue
        if r is None or (ufs and r["uf"] not in ufs):
            pulados += 1
            continue
        registros.append(r)
    ultima_info.update({"imoveis": len(registros), "pulados": pulados, "erros": erros})
    return registros
