"""Fonte JFES — Justiça Federal, Seção Judiciária do Espírito Santo (leilões unificados).

Inspecionado em 2026-10-21: trf2.jus.br/jfes/transparencia/listagem lista, por leilão unificado, os editais
em PDF de cada vara (robots.txt do TRF2 não restringe /system/files/). Cada edital traz blocos
"NN - PROCESSO N.º ... BEM: ... (RE)AVALIAÇÃO: R$ ... LOCALIZAÇÃO DO(S) BEM(NS): ... ÔNUS: ..." e, no fim,
"1º LEILÃO ... dia D de MÊS de AAAA" / "2º LEILÃO, dia ...", a comissão do leiloeiro e o site onde ocorre.
Nomes de pessoas (exequente, executado, depositário) NÃO são guardados: só BEM, avaliação, localização,
ônus e número do processo. Só bens imóveis entram (veículos e outros são descartados por palavra-chave).
O texto extraído de cada PDF é guardado em collector/cache/pdf/<hash da URL>.txt para não baixar de novo.
"""

from __future__ import annotations

import hashlib
import html as html_mod
import io
import logging
import re
from pathlib import Path

from ..extract_regex import _num, extrair_tudo
from ..schema import novo_registro, completar, normalizar_tipo, preencher_derivados, titulo

log = logging.getLogger(__name__)

NOME = "jfes"
SITE = "https://www.trf2.jus.br/jfes/transparencia/listagem"
BASE = "https://www.trf2.jus.br"
ultima_info: dict = {}

MESES = {"janeiro": 1, "fevereiro": 2, "marco": 3, "março": 3, "abril": 4, "maio": 5, "junho": 6, "julho": 7,
         "agosto": 8, "setembro": 9, "outubro": 10, "novembro": 11, "dezembro": 12}
_IMOVEL = re.compile(r"\b(im[óo]vel|terreno|lote|apartamento|casa|sala|loja|galp[ãa]o|pr[ée]dio|edif[íi]c|gleba|fazenda|s[íi]tio|ch[áa]cara|box|garagem|unidade aut[ôo]noma|fra[çc][ãa]o ideal)\b", re.I)
_VEICULO = re.compile(r"\b(autom[óo]vel|ve[íi]culo|motocicleta|caminh[ãa]o|placa|renavam|chassi|trator|embarca[çc][ãa]o)\b", re.I)


def extrair_texto_pdf(conteudo: bytes) -> str:
    from pypdf import PdfReader  # import tardio: só quem usa PDF precisa da dependência
    leitor = PdfReader(io.BytesIO(conteudo))
    return "\n".join((p.extract_text() or "") for p in leitor.pages)


def _limpar(texto: str) -> str:
    # remove o cabeçalho repetido em cada página e junta linhas
    texto = re.sub(r"PODER JUDICI[ÁA]RIO\s+JUSTI[ÇC]A FEDERAL\s+SE[ÇC][ÃA]O JUDICI[ÁA]RIA DO ESP[ÍI]RITO SANTO\s+.*?E-mail:\s*\S+", " ", texto, flags=re.S | re.I)
    return re.sub(r"[ \t]+", " ", texto)


def _data_extenso(s: str) -> str | None:
    m = re.search(r"dia\s+(\d{1,2})\s+de\s+([A-Za-zçÇ]+)\s+de\s+(\d{4})", s, re.I)
    if not m:
        m = re.search(r"(\d{2})/(\d{2})/(\d{4})", s)
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None
    mes = MESES.get(m.group(2).lower())
    return f"{m.group(3)}-{mes:02d}-{int(m.group(1)):02d}" if mes else None


def dados_gerais(texto: str) -> dict:
    t = re.sub(r"\s+", " ", texto)
    info: dict = {}
    m = re.search(r"1º LEIL[ÃA]O[^.]{0,80}?dia\s+\d{1,2}\s+de\s+[A-Za-zçÇ]+\s+de\s+\d{4}", t, re.I)
    info["data1"] = _data_extenso(m.group(0)) if m else None
    m = re.search(r"2º LEIL[ÃA]O[^.]{0,80}?dia\s+\d{1,2}\s+de\s+[A-Za-zçÇ]+\s+de\s+\d{4}", t, re.I)
    info["data2"] = _data_extenso(m.group(0)) if m else None
    m = re.search(r"comiss[ãa]o d[oa] leiloeir[oa] de (\d{1,2}(?:[.,]\d+)?)\s*%", t, re.I)
    info["comissao"] = _num(m.group(1)) if m else None
    m = re.search(r"\b([A-ZÁÉÍÓÚÃÕÇ][A-ZÁÉÍÓÚÃÕÇ ]{6,60}?),\s*Leiloeir[ao] P[úu]blic[ao] Oficial", t)
    info["leiloeiro"] = titulo(m.group(1).strip()) if m else None
    m = re.search(r"site\s+(www\.[a-z0-9.\-]+\.[a-z.]+)", t, re.I)
    info["site_leiloeiro"] = "https://" + m.group(1) if m else None
    m = re.search(r"(\d+ª VARA FEDERAL[A-ZÇÃÕÉÍ ]+?)(?:\s+Avenida|\s+Rua|\s+Av\.)", t)
    info["vara"] = titulo(m.group(1).strip()) if m else None
    m = re.search(r"segundo leil[ãa]o[^.]{0,120}?(\d{1,2})\s*%\s*(?:da|do valor da)\s*avalia", t, re.I)
    info["pct_segundo"] = _num(m.group(1)) if m else None
    return info


def blocos_de_bens(texto: str) -> list[dict]:
    """Um dict por item 'NN - PROCESSO N.º ...' com bem, avaliacao, localizacao, onus, processo."""
    t = _limpar(texto)
    partes = re.split(r"\n?\s*(?=\d{2}\s*-\s*PROCESSO\s+N\.?[ºo°]?\s*[\d.\-]+)", t)
    saida = []
    for p in partes:
        m = re.match(r"\s*(\d{2})\s*-\s*PROCESSO\s+N\.?[ºo°]?\s*([\d.\-]+)", p)
        if not m:
            continue
        p1 = re.sub(r"\s+", " ", p)
        bem = re.search(r"BEM(?:\(NS\))?:\s*(.+?)\s*(?:\(RE\)\s*)?AVALIA[ÇC][ÃA]O", p1, re.I)
        aval = re.search(r"AVALIA[ÇC][ÃA]O:\s*R\$\s*([\d.,]+)", p1, re.I)
        loc = re.search(r"LOCALIZA[ÇC][ÃA]O DO\(S\) BEM\(NS\):\s*(.+?)\s*(?:DEPOSIT[ÁA]RIO|[ÔO]NUS|VALOR DO D[ÉE]BITO|$)", p1, re.I)
        onus = re.search(r"[ÔO]NUS:\s*(.+?)\s*(?:VALOR DO D[ÉE]BITO|$)", p1, re.I)
        saida.append({
            "numero": m.group(1), "processo": m.group(2).strip("."),
            "bem": bem.group(1).strip() if bem else None,
            "avaliacao": _num(aval.group(1)) if aval else None,
            "localizacao": loc.group(1).strip() if loc else None,
            "onus": onus.group(1).strip() if onus else None,
        })
    return saida


def _cidade_uf(texto: str | None) -> tuple[str | None, str | None]:
    if not texto:
        return None, None
    m = re.search(r"([A-ZÁÉÍÓÚÃÕÇ][A-Za-záéíóúãõç ]{2,40}?)\s*/\s*([A-Z]{2})\b", texto)
    if m:
        return titulo(m.group(1).strip()), m.group(2)
    return None, None


def registros_do_edital(texto: str, url_pdf: str, titulo_edital: str | None = None) -> list[dict]:
    geral = dados_gerais(texto)
    saida = []
    for b in blocos_de_bens(texto):
        bem = b.get("bem") or ""
        if not _IMOVEL.search(bem) or (_VEICULO.search(bem[:200]) and not re.search(r"\b(im[óo]vel|terreno|apartamento|casa|lote)\b", bem[:200], re.I)):
            continue
        cidade, uf = _cidade_uf(b.get("localizacao")) if b.get("localizacao") else (None, None)
        if not uf:
            cidade, uf = _cidade_uf(bem)
        endereco = None
        if b.get("localizacao"):
            endereco = re.sub(r"\s*localiza[çc][ãa]o geogr[áa]fica.*$", "", b["localizacao"], flags=re.I).strip()
        descricao = bem + (f" | Ônus: {b['onus']}" if b.get("onus") else "")
        r = novo_registro(
            id=f"jfes-{b['processo']}-{b['numero']}",
            fonte=NOME,
            url_anuncio=geral.get("site_leiloeiro") or url_pdf,
            url_edital=url_pdf,
            leiloeiro=geral.get("leiloeiro"),
            tipo=normalizar_tipo(bem[:80]),
            uf=uf,
            cidade=cidade,
            endereco=endereco,
            valor_avaliacao=b.get("avaliacao"),
            valor_minimo=b.get("avaliacao"),  # 1º leilão: pelo menos 100% da avaliação
            natureza="leilão judicial",
            modalidade=f"Leilão unificado JFES — {geral.get('vara') or titulo_edital or 'edital'}",
            data_leilao=geral.get("data1"),
            data_segunda_praca=geral.get("data2"),
            comissao_leiloeiro_pct=geral.get("comissao"),
            numero_processo=b["processo"],
            comitente="Justiça Federal (JFES)",
            descricao_original=descricao,
        )
        if geral.get("pct_segundo") and b.get("avaliacao"):
            r["descricao_original"] += f" | 2º leilão: mínimo {geral['pct_segundo']:g}% da avaliação"
        completar(r, preencher_null_com=extrair_tudo(bem))
        saida.append(preencher_derivados(r))
    return saida


def _cache_dir(config: dict) -> Path:
    raiz = Path(__file__).resolve().parent.parent
    return raiz / "cache" / "pdf"


def texto_do_pdf(cliente, url: str, config: dict) -> str:
    pasta = _cache_dir(config)
    pasta.mkdir(parents=True, exist_ok=True)
    h = hashlib.sha256(url.encode()).hexdigest()[:20]
    p = pasta / f"{h}.txt"
    if p.exists():
        return p.read_text(encoding="utf-8")
    r = cliente.get(url)
    texto = extrair_texto_pdf(r.content)
    p.write_text(f"# {url}\n" + texto, encoding="utf-8")
    return texto


def coletar(config: dict, cliente) -> list[dict]:
    ufs = set(config.get("ufs", []))
    lista = cliente.get(SITE)
    artigos = sorted(set(re.findall(r'href="(/jfes/artigo/[^"]*leil[^"]*)"', lista.text)))
    # só os leilões mais recentes (os artigos vêm por ordem de publicação; limitamos pela config)
    maximo = config["fontes"]["jfes"].get("maximo_artigos", 4)
    editais: list[dict] = []
    registros: list[dict] = []
    ultima_info.clear()
    for art in artigos[:maximo] if maximo else artigos:
        pg = cliente.get(BASE + art)
        titulo_art = re.search(r"<h1[^>]*>(.*?)</h1>", pg.text, re.S)
        titulo_art = html_mod.unescape(re.sub(r"<[^>]+>", "", titulo_art.group(1))).strip() if titulo_art else art
        for pdf in sorted(set(re.findall(r'href="([^"]+\.pdf)"', pg.text, re.I))):
            url = pdf if pdf.startswith("http") else BASE + pdf
            nome = html_mod.unescape(url.rsplit("/", 1)[-1])
            try:
                texto = texto_do_pdf(cliente, url, config)
            except Exception as e:
                log.warning("jfes: PDF %s falhou: %s", url, e)
                continue
            geral = dados_gerais(texto)
            editais.append({"fonte": NOME, "titulo": f"{titulo_art} — {nome}", "url": url, "data_leilao": geral.get("data1"),
                            "data_segunda_praca": geral.get("data2"), "leiloeiro": geral.get("leiloeiro"),
                            "site_leiloeiro": geral.get("site_leiloeiro")})
            for r in registros_do_edital(texto, url, nome):
                if not ufs or (r.get("uf") in ufs) or (r.get("uf") is None and "ES" in ufs):
                    r["uf"] = r.get("uf") or "ES"
                    registros.append(r)
    ultima_info.update({"artigos": len(artigos), "editais": editais})
    return registros
