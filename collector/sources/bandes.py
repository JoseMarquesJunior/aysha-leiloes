"""Fonte Bandes — Banco de Desenvolvimento do ES, "Imóveis Disponíveis para Venda Direta" (bandes.com.br).

Inspecionado em 2026-10-21: o site derruba conexões com frequência ("Connection was reset") e não devolve
robots.txt. A página /Site/Dinamico/Show/978/Leilao-de-Imoveis lista um PDF por cidade (Alegre, Colatina,
João Neiva, Vila Velha, Rio de Janeiro) em /Site/Download/Download?id=... Cada PDF tem blocos no formato:

    Lote: 10   Lance mínimo: R$ 64.546,00
    BNU Nº: 62
    Localização: Vila Velha/ES
    Situação: Imóvel Ocupado
    Descrição: ...
    Confrontações: ...          (NÃO guardada: cita nomes de vizinhos)
    Registro: ... matrícula 8.162 ...
    Observação: ...
    Endereço: ...
    Coordenadas: 20°28'59.8"S 40°26'10.5"W (às vezes)

O texto de cada PDF fica em collector/cache/pdf/bandes-<hash>.txt e é reaproveitado quando o site não
responde (o módulo só re-baixa quando o arquivo de cache não existe; a página 979, "Leilão de Imóveis",
não respondeu em nenhuma tentativa e fica para inspeção futura).
"""

from __future__ import annotations

import hashlib
import html as html_mod
import logging
import re
from pathlib import Path

from ..extract_regex import _num, extrair_tudo
from ..schema import completar, normalizar_tipo, novo_registro, preencher_derivados, titulo

log = logging.getLogger(__name__)

NOME = "bandes"
SITE = "https://www.bandes.com.br/Site/Dinamico/Show/978/Leilao-de-Imoveis"
BASE = "https://www.bandes.com.br"
ultima_info: dict = {}


def parsear_arquivos(html: str) -> list[dict]:
    saida = []
    for m in re.finditer(r"""previewLinkAjax\('(/Site/Download/Download\?id=[^']+)'[^>]*>\s*([^<]+?)\s*</a>""", html):
        saida.append({"fonte": NOME, "titulo": html_mod.unescape(m.group(2)).strip(), "url": BASE + m.group(1),
                      "tipo": "venda direta"})
    return saida


def _campo(bloco: str, rotulo: str) -> str | None:
    m = re.search(rotulo + r"\s*:?\s*(.+?)(?=\n[A-ZÁÉÍÓÚÇ][A-Za-záéíóúãõç]+(?: \d)?\s*(?:N[ºo°])?\s*:|\Z)", bloco, re.S)
    return re.sub(r"\s+", " ", m.group(1)).strip() if m else None


def _coordenadas(texto: str | None) -> tuple[float | None, float | None]:
    if not texto:
        return None, None
    m = re.search(r"(\d{1,2})°(\d{1,2})'([\d.]+)\"?\s*S\s+(\d{1,3})°(\d{1,2})'([\d.]+)", texto)
    if not m:
        return None, None
    lat = -(int(m.group(1)) + int(m.group(2)) / 60 + float(m.group(3)) / 3600)
    lng = -(int(m.group(4)) + int(m.group(5)) / 60 + float(m.group(6)) / 3600)
    return round(lat, 6), round(lng, 6)


def registros_do_texto(texto: str, url: str) -> list[dict]:
    saida = []
    for bloco in re.split(r"(?=^\s*Lote\s*:\s*\d+)", texto, flags=re.M)[1:]:
        m = re.match(r"\s*Lote\s*:\s*(\d+)\s+Lance\s+m[íi]nimo\s*:\s*R\$\s*([\d.,]+)", bloco, re.I)
        if not m:
            continue
        lote, lance = m.group(1), _num(m.group(2))
        bnu = _campo(bloco, r"BNU\s*N[ºo°]?")
        loc = _campo(bloco, r"Localiza[çc][ãa]o")
        situacao = _campo(bloco, r"Situa[çc][ãa]o") or ""
        descricao = _campo(bloco, r"Descri[çc][ãa]o") or ""
        registro_ = _campo(bloco, r"Registro") or ""
        endereco = _campo(bloco, r"Endere[çc]o")
        coords = _campo(bloco, r"Coordenadas")
        cidade = uf = None
        if loc:
            mm = re.match(r"(.+?)\s*/\s*([A-Z]{2})", loc)
            if mm:
                cidade, uf = mm.group(1).strip(), mm.group(2)
        if cidade and cidade.lower() == "rio de janeiro" and uf == "ES":
            uf = "RJ"  # erro de digitação no arquivo da fonte
        ocupado = True if re.search(r"\bocupad", situacao, re.I) and not re.search(r"\bdesocupad", situacao, re.I) else (
            False if re.search(r"\bdesocupad", situacao, re.I) else None)
        mat = re.search(r"matr[íi]cula\s*(?:n[ºo°.]?\s*)?([\d.]+)(?:\s*,\s*atual\s*([\d.]+))?", registro_, re.I)
        matricula = (mat.group(2) or mat.group(1)).replace(".", "") if mat else None
        lat, lng = _coordenadas(coords or endereco)
        if endereco:
            endereco = re.sub(r"https?://\S+", "", endereco)
            endereco = re.sub(r"\s*\d{1,2}°\d{1,2}'[\d.]+\"?\s*S\s+\d{1,3}°\d{1,2}'[\d.]+\"?\s*W?", "", endereco)
            endereco = re.sub(r"\s*BNU\s*N[ºo°]?\s*:?\s*\d+\s*$", "", endereco)
            endereco = re.sub(r"\s*CEP\s*:?\s*[\d.\-]+\.?\s*$", "", endereco).strip(" .")
        r = novo_registro(
            id=f"bandes-{bnu or lote}",
            fonte=NOME,
            url_anuncio=SITE,
            url_edital=url,
            tipo=normalizar_tipo(descricao[:80]),
            uf=uf,
            cidade=titulo(cidade) if cidade and cidade.isupper() else cidade,
            endereco=endereco,
            lat=lat, lng=lng, geo_precisao="endereco" if lat else None,
            valor_minimo=lance,
            natureza="venda direta",
            modalidade="Venda direta Bandes (proposta)",
            ocupado=ocupado,
            matricula=matricula,
            comitente="Bandes",
            descricao_original=f"{descricao} Situação: {situacao}".strip() if descricao else (situacao or None),
        )
        completar(r, preencher_null_com=extrair_tudo(descricao))
        saida.append(preencher_derivados(r))
    return saida


def coletar(config: dict, cliente) -> list[dict]:
    pasta = Path(__file__).resolve().parent.parent / "cache" / "pdf"
    pasta.mkdir(parents=True, exist_ok=True)
    ultima_info.clear()
    try:
        r = cliente.get(SITE)
        arquivos = parsear_arquivos(r.text)
    except Exception as e:
        # site instável: reaproveita os textos já em cache
        log.warning("bandes: página de venda direta indisponível (%s); usando cache", e)
        arquivos = [{"fonte": NOME, "titulo": p.name, "url": p.read_text(encoding="utf-8").splitlines()[0][2:], "tipo": "venda direta"}
                    for p in sorted(pasta.glob("bandes-*.txt"))]
    registros: list[dict] = []
    com_texto = 0
    for a in arquivos:
        h = hashlib.sha256(a["url"].encode()).hexdigest()[:20]
        p = pasta / f"bandes-{h}.txt"
        texto = None
        if p.exists():
            texto = p.read_text(encoding="utf-8").split("\n", 1)[1]
        else:
            try:
                resp = cliente.get(a["url"])
                if resp.content[:4] == b"%PDF":
                    from .jfes import extrair_texto_pdf
                    texto = extrair_texto_pdf(resp.content)
                    p.write_text(f"# {a['url']}\n" + texto, encoding="utf-8")
                else:
                    log.warning("bandes: %s não é PDF (%s)", a["titulo"], resp.headers.get("Content-Type"))
            except Exception as e:
                log.warning("bandes: download de %s falhou: %s", a["titulo"], e)
        if texto:
            com_texto += 1
            novos = registros_do_texto(texto, a["url"])
            a["lotes"] = len(novos)
            registros.extend(novos)
    ufs = set(config.get("ufs", []))
    registros = [r for r in registros if not ufs or r.get("uf") in ufs]
    ultima_info.update({"editais": arquivos, "arquivos_com_texto": com_texto})
    return registros
