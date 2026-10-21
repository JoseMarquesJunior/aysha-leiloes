"""Adaptador genérico para sites de leiloeiros na plataforma Suporte Leilões (layout "eventos/buscador").

Sites configurados em config.yaml -> fontes.suporteleiloes.sites (inspecionados em 2026-10-21):
- emleilao.com.br   Ayrton de Souza Porto Filho (JUCEES 058/2014) — leilões da Caixa e do Banestes (2026)
- buaizleiloes.com.br  Alexandre Buaiz Neto — hoje só veículos, mas já conduziu imóveis do Banestes
- esleiloes.com.br  Sérgio de Paula Pereira (JUCEES 008/1984)

Como funciona (sem API: robots dos sites não restringem HTML; /api/ é evitado):
- GET /buscador?uf=<UF>&page=<n>  -> cards <article class="lote-main"> com link do lote, título, descrição,
  cidade/UF, "Valor 1º praça" e status; "Exibindo 1 a 12 de N itens" dá a paginação.
- GET <lote>                      -> a página embute `var lote = {...}` (valorInicial, valorInicial2,
  valorAvaliacao, leilao{data1,data2,praca,judicial,permitirParcelamento,documentos,leiloeiro}) e
  `var item = {...}` (uf, cidade, bairro, matrícula, imovel{ocupado}); mais campos rotulados no HTML
  (Comitente, Tipo Judicial/Extrajudicial) e links de PDF (edital, matrícula).
"""

from __future__ import annotations

import html as html_mod
import json
import logging
import re
from urllib.parse import urljoin

from ..extract_regex import _num, extrair_tudo
from ..schema import completar, normalizar_tipo, novo_registro, preencher_derivados, titulo

log = logging.getLogger(__name__)

NOME = "suporteleiloes"
SITE = "https://www.emleilao.com.br/"
ultima_info: dict = {}


def _texto(html: str) -> str:
    corpo = re.sub(r"<script.*?</script>|<style.*?</style>", "", html, flags=re.S)
    return re.sub(r"\s+", " ", html_mod.unescape(re.sub(r"<[^>]+>", " ", corpo))).strip()


def _json_var(html: str, nome: str) -> dict | None:
    """Extrai o objeto JSON de `var <nome> = {...};` balanceando chaves (o JSON não contém '{' em strings
    desbalanceadas na prática; strings são tratadas para segurança)."""
    m = re.search(r"\bvar\s+" + re.escape(nome) + r"\s*=\s*\{", html)
    if not m:
        return None
    i = m.end() - 1
    depth, j, em_str, esc = 0, i, False, False
    while j < len(html):
        c = html[j]
        if em_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                em_str = False
        else:
            if c == '"':
                em_str = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    break
        j += 1
    try:
        return json.loads(html[i:j + 1])
    except json.JSONDecodeError as e:
        log.debug("json de %s inválido: %s", nome, e)
        return None


def cards_do_buscador(html: str) -> list[dict]:
    """Cards da página de busca: url, titulo, descricao, cidade_uf, valor_1a_praca, status, codigo."""
    saida = []
    for art in re.findall(r'<article class="lote-main[^"]*"[^>]*>(.*?)</article>', html, re.S):
        m = re.search(r'href="([^"]*/lote/\d+/[^"]*)"', art)
        if not m:
            continue
        titulo_ = re.search(r"<h3>(.*?)</h3>", art, re.S)
        desc = re.search(r"<p>(.*?)</p>", art, re.S)
        cid = re.search(r'<div class="r2">.*?<span>(.*?)</span>', art, re.S)
        val = re.search(r"Valor 1º praça</span>\s*<strong[^>]*>(.*?)</strong>", art, re.S)
        st = re.search(r'class="strong-status[^"]*">(.*?)</strong>', art, re.S)
        cod = re.search(r'<strong class="strong-cod"><span>COD\.</span>&nbsp;(\d+)', art)
        desconto = re.search(r'<div class="item-desconto">\s*<strong>(\d+)%', art)
        saida.append({
            "url": html_mod.unescape(m.group(1)),
            "titulo": _texto(titulo_.group(1)) if titulo_ else None,
            "descricao": _texto(desc.group(1)) if desc else None,
            "cidade_uf": _texto(cid.group(1)) if cid else None,
            "valor_1a_praca": _num(re.sub(r"[^\d.,]", "", val.group(1))) if val and re.search(r"\d", val.group(1)) else None,
            "status": _texto(st.group(1)) if st else None,
            "codigo": cod.group(1) if cod else None,
            "desconto_pct_fonte": int(desconto.group(1)) if desconto else None,
        })
    return saida


def total_itens(html: str) -> int | None:
    m = re.search(r"Exibindo \d+ a \d+ de (\d+) itens", _texto(html))
    return int(m.group(1)) if m else None


def _data(obj) -> str | None:
    if isinstance(obj, dict):
        obj = obj.get("date")
    if not obj or not isinstance(obj, str):
        return None
    return obj[:10]


def parsear_lote(html: str, url: str, site: dict, card: dict | None = None) -> dict | None:
    lote = _json_var(html, "lote") or {}
    item = _json_var(html, "item") or {}
    leilao = lote.get("leilao") or {}
    texto = _texto(html)
    imovel = item.get("imovel") if isinstance(item.get("imovel"), dict) else {}
    descricao = lote.get("descricao") or item.get("descricao") or (card or {}).get("descricao") or ""
    descricao = html_mod.unescape(re.sub(r"<[^>]+>", " ", descricao)).strip()
    cidade_uf = (card or {}).get("cidade_uf") or ""
    uf = (item.get("uf") or cidade_uf.split(" - ")[-1].strip() if cidade_uf else item.get("uf") or "")
    cidade = item.get("cidade") or (cidade_uf.split(" - ")[0].strip() if cidade_uf else None)
    m = re.search(r"-\s*([A-ZÀ-Ú][A-ZÀ-Ú' ]+)/([A-Z]{2})\s*-\s*CEP", descricao)
    if m:
        cidade = cidade or m.group(1).strip()
        uf = uf or m.group(2)
    uf = (uf or "").strip().upper() or None
    comitente = None
    m = re.search(r"Leiloeiro\s+.+?\s+Comitente\s+(.+?)\s+Código Leilão", texto)
    if m:
        comitente = m.group(1).strip()
    tipo_leilao = None
    m = re.search(r"\bTipo\s+(Judicial|Extrajudicial)\b", texto)
    if m:
        tipo_leilao = m.group(1)
    judicial = (tipo_leilao == "Judicial") or bool(leilao.get("judicial"))
    docs = leilao.get("documentos") or []
    url_edital = None
    for d in docs:
        if isinstance(d, dict) and (d.get("tipo") or {}).get("nome", "").lower().startswith("edital"):
            url_edital = d.get("url") or d.get("arquivo") or None
            break
    pdfs = re.findall(r'href="([^"]+\.pdf)"', html, re.I)
    if not url_edital:
        for p in pdfs:
            if "/leiloes/" in p and "/documentos/" in p:
                url_edital = p
                break
    url_matricula = next((p for p in pdfs if "/bens/" in p), None)
    valor_min = lote.get("valorInicial") or (card or {}).get("valor_1a_praca")
    valor_2 = lote.get("valorInicial2") or None
    praca = leilao.get("praca")
    data1, data2 = _data(leilao.get("data1")), _data(leilao.get("data2"))
    modalidade = (f"{praca}ª praça" if praca and data2 else "Leilão online")
    if leilao.get("vendaDireta"):
        modalidade = "Venda direta (proposta)"
    titulo_site = (card or {}).get("titulo") or item.get("siteTitulo") or lote.get("numeroString")
    tipo_fonte = (card or {}).get("titulo") or (descricao.split(" - ", 1)[0] if descricao else None)
    m_id = re.search(r"/lote/(\d+)/", url)
    fonte = f"leiloeiro-{site['slug']}"
    parcel = leilao.get("permitirParcelamento")
    r = novo_registro(
        id=f"{site['slug']}-{m_id.group(1) if m_id else lote.get('id') or url}",
        fonte=fonte,
        url_anuncio=url,
        url_edital=url_edital,
        url_matricula=url_matricula,
        leiloeiro=site.get("leiloeiro") or ((leilao.get("leiloeiro") or {}).get("nome")),
        tipo=normalizar_tipo(tipo_fonte),
        uf=uf,
        cidade=titulo(cidade) if cidade else None,
        bairro=_bairro(descricao, item),
        endereco=_endereco(descricao, item),
        valor_avaliacao=lote.get("valorAvaliacao") or None,
        valor_minimo=float(valor_min) if valor_min else None,
        natureza="leilão judicial" if judicial else ("venda direta" if leilao.get("vendaDireta") else "leilão extrajudicial"),
        modalidade=modalidade,
        data_leilao=data1,
        data_segunda_praca=data2,
        ocupado=imovel.get("ocupado") if isinstance(imovel.get("ocupado"), bool) else None,
        aceita_parcelamento=bool(parcel) if parcel is not None else None,
        matricula=str(item.get("matricula")) if item.get("matricula") else None,
        comitente=comitente,
        descricao_original=descricao or None,
        url_foto=_foto(item),
    )
    if valor_2:
        r["descricao_original"] = (r["descricao_original"] or "") + f" | Lance 2ª praça: R$ {valor_2:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    completar(r, preencher_null_com=extrair_tudo(descricao))
    return preencher_derivados(r)


def _endereco(descricao: str, item: dict) -> str | None:
    """Endereço sem o sufixo ' - CIDADE/UF' e sem o bairro (último trecho entre vírgulas), que vão para
    cidade/bairro; assim o texto bate com o da Caixa na deduplicação."""
    if item.get("endereco"):
        return str(item["endereco"]).strip()
    m = re.search(r"Localizado\(a\):\s*(.+?)(?:\s*-\s*CEP|\s*-\s*N°|\s*$)", descricao)
    if not m:
        return None
    end = re.sub(r"\s*-\s*[A-ZÀ-Ú][A-ZÀ-Ú' ]+/[A-Z]{2}\s*$", "", m.group(1).strip())
    partes = [p.strip() for p in end.split(",") if p.strip()]
    # descarta do fim os trechos de bairro/loteamento (sem dígitos e sem palavra de complemento)
    while len(partes) > 1 and not re.search(r"\d", partes[-1]) and not _COMPLEMENTO.match(partes[-1]):
        partes.pop()
    return ", ".join(partes) or None


_COMPLEMENTO = re.compile(r"(?i)^(n\.?|nº|apto|ap|bl|bloco|vg|vaga|lt|lote|qd|quadra|cs|casa|box|tr|sl|sala|loja|lj|fundos|frente|esq|dir)\b")


def _bairro(descricao: str, item: dict) -> str | None:
    if item.get("bairro"):
        return titulo(str(item["bairro"]))
    m = re.search(r"Localizado\(a\):\s*(.+?)\s*-\s*[A-ZÀ-Ú][A-ZÀ-Ú' ]+/[A-Z]{2}\b", descricao)
    if not m:
        return None
    partes = [p.strip() for p in m.group(1).split(",") if p.strip()]
    # trechos finais sem dígitos e sem palavra de complemento = bairro e/ou loteamento/condomínio
    cauda: list[str] = []
    while len(partes) > 1 and not re.search(r"\d", partes[-1]) and not _COMPLEMENTO.match(partes[-1]):
        cauda.insert(0, partes.pop())
    if not cauda:
        return None
    # prefere o trecho que não é loteamento/condomínio/edifício (ex.: "ANCURI" antes de "LOTEAMENTO X")
    for p in cauda:
        if not re.match(r"(?i)^(loteamento|lot\.?|cond|condom[íi]nio|residencial|res\.?|ed\.?|edif[íi]cio|conjunto|conj\.?|parque|jardim res)", p):
            return titulo(p)
    return titulo(cauda[0])


_PALAVRAS_IMOVEL = re.compile(r"\b(apartamentos?|casas?|terrenos?|lotes?(?!\s*\d)|glebas?|im[óo]ve(?:l|is)|salas?|lojas?|galp[ãa]o|galp[õo]es|pr[ée]dios?|rural|rurais|ch[áa]caras?|s[íi]tios?|fazendas?|comercia(?:l|is)|kitnet|cobertura|sobrados?|box|garagem|edif[íi]c|vaga de garagem)\b", re.I)
_PALAVRAS_NAO_IMOVEL = re.compile(r"\b(ve[íi]culo|autom[óo]vel|caminh[ãa]o|motocicleta|moto\b|placa|chassi|renavam|sucata|trator|m[áa]quina|equipamento|mobili[áa]rio|computador|impressora|semovente|bovino|cadeira|mesa)\b", re.I)


def eh_imovel(titulo_: str | None, descricao: str | None) -> bool:
    t = f"{titulo_ or ''} {descricao or ''}"
    return bool(_PALAVRAS_IMOVEL.search(t)) and not (_PALAVRAS_NAO_IMOVEL.search(t[:160]) and not _PALAVRAS_IMOVEL.search(t[:160]))


def _foto(item: dict) -> str | None:
    img = item.get("image") or {}
    if isinstance(img, dict):
        for k in ("min", "max", "original"):
            if isinstance(img.get(k), dict) and img[k].get("url"):
                return img[k]["url"]
    return None


def fontes_produzidas(config: dict) -> list[str]:
    return [f"leiloeiro-{s['slug']}" for s in config["fontes"]["suporteleiloes"].get("sites", []) if s.get("ativo", True)]


def coletar(config: dict, cliente) -> list[dict]:
    cfg = config["fontes"]["suporteleiloes"]
    ufs = config.get("ufs", [])
    registros: list[dict] = []
    ultima_info.clear()
    for site in cfg.get("sites", []):
        if not site.get("ativo", True):
            continue
        base = site["url"].rstrip("/")
        vistos = 0
        try:
            for uf in ufs:
                pagina = 1
                while True:
                    r = cliente.get(f"{base}/buscador", params={"uf": uf, "page": pagina})
                    cards = cards_do_buscador(r.text)
                    total = total_itens(r.text) or 0
                    for card in cards:
                        if not eh_imovel(card.get("titulo"), card.get("descricao")):
                            continue  # veículos, sucata, bens de prefeituras etc.
                        url = urljoin(base + "/", card["url"])
                        try:
                            pl = cliente.get(url)
                            reg = parsear_lote(pl.text, url, site, card)
                        except Exception as e:
                            log.warning("%s: lote %s ignorado: %s", site["slug"], url, e)
                            continue
                        if reg:
                            if not reg.get("uf"):
                                reg["uf"] = uf
                            registros.append(reg)
                            vistos += 1
                    if not cards or pagina * 12 >= total:
                        break
                    pagina += 1
        except Exception as e:  # um site fora do ar não derruba os outros
            log.exception("%s falhou", site["slug"])
            ultima_info[site["slug"]] = f"erro: {e}"[:200]
            continue
        ultima_info[site["slug"]] = vistos
    return registros
