"""Extração determinística (regex) de campos a partir de texto livre de anúncios e editais.

Centraliza todas as expressões regulares do projeto. A IA só entra para o que ficar null aqui.
Todas as funções recebem texto e devolvem valor ou None; `extrair_tudo` junta tudo num dict
com apenas os campos encontrados (nunca sobrescreve nada: quem chama usa schema.completar).
"""

from __future__ import annotations

import re
from datetime import date

from .schema import sem_acentos

_FLAGS = re.IGNORECASE


def _num(s: str | None) -> float | None:
    """'1.234,56' -> 1234.56 ; '67.20' -> 67.2 ; '334' -> 334.0"""
    if s is None:
        return None
    s = s.strip().replace(" ", "")
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    elif s.count(".") > 1 or re.fullmatch(r"\d{1,3}(\.\d{3})+", s):
        s = s.replace(".", "")
    try:
        v = float(s)
    except ValueError:
        return None
    return v


def _norm(texto: str) -> str:
    return sem_acentos(texto or "")


def extrair_quartos(texto: str) -> int | None:
    t = _norm(texto)
    # "2 qto(s)", "3 qt(s)", "02 (dois) quartos", "3 dormitórios", "2 suítes"
    m = re.search(r"(\d+)\s*(?:\([a-z]+\)\s*)?(?:qto|qts?\b|quarto|dormit|dorm\b|suite)", t, _FLAGS)
    if not m:
        m = re.search(r"(?:qto|quarto|dormit)[a-z()]*\s*[:=]?\s*(\d+)", t, _FLAGS)
    return int(m.group(1)) if m else None


def extrair_vagas(texto: str) -> int | None:
    t = _norm(texto)
    m = re.search(r"(\d+)\s*(?:\([a-z]+\)\s*)?vaga", t, _FLAGS)
    if not m:
        m = re.search(r"vaga[s]?(?:\s*de\s*garagem)?\s*[:=]?\s*(\d+)", t, _FLAGS)
    return int(m.group(1)) if m else None


_AREA = r"([\d.]+(?:,\d+)?)"
_M2 = r"\s*(?:m2|m²|metros?\s*quadrados?)?"


def _area(texto: str, rotulos: str) -> float | None:
    t = _norm(texto)
    # "67.20 de área privativa" / "área privativa de 67,20 m²" / "área privativa: 67,20m²"
    m = re.search(_AREA + _M2 + r"\s*de\s*area\s*(?:" + rotulos + r")", t, _FLAGS)
    if not m:
        m = re.search(r"area\s*(?:" + rotulos + r")\s*(?:de|:|=)?\s*" + _AREA + _M2, t, _FLAGS)
    if not m:
        return None
    v = _num(m.group(1))
    return v if v else None  # 0.00 = desconhecido


def extrair_area_privativa(texto: str) -> float | None:
    return _area(texto, r"privativa|util|construida")


def extrair_area_terreno(texto: str) -> float | None:
    return _area(texto, r"do\s*terreno|de\s*terreno|terreno")


def extrair_area_total(texto: str) -> float | None:
    return _area(texto, r"total")


def _booleano_por_palavra(texto: str, positivo: str) -> bool | None:
    """True se a palavra aparece sem negação próxima; False se negada; None se ausente."""
    t = _norm(texto)
    m = re.search(positivo, t, _FLAGS)
    if not m:
        return None
    antes = t[max(0, m.start() - 40):m.start()]
    depois = t[m.end():m.end() + 25]
    if re.search(r"\b(nao|sem|nem|vedad[oa]|impossibilit|indisponivel)\b[^.;]*$", antes, _FLAGS) \
            or re.search(r"^\s*:?\s*(nao|indisponivel)\b", depois, _FLAGS):
        return False
    return True


def extrair_aceita_fgts(texto: str) -> bool | None:
    return _booleano_por_palavra(texto, r"\bfgts\b")


def extrair_aceita_financiamento(texto: str) -> bool | None:
    return _booleano_por_palavra(texto, r"\bfinanciamento\b|\bfinanciavel\b|\bfinanciad[oa]\b")


def extrair_aceita_parcelamento(texto: str) -> bool | None:
    return _booleano_por_palavra(texto, r"\bparcelamento\b|\bparcelad[oa]\b|\bparcelar\b")


def extrair_ocupado(texto: str) -> bool | None:
    """'desocupado' -> False; 'ocupado' -> True; nada -> None."""
    t = _norm(texto)
    if re.search(r"\bdesocupad[oa]s?\b|\blivre\s+de\s+ocupa|\bimovel\s+vago\b|\bdesocupacao\s+ja\b", t, _FLAGS):
        return False
    if re.search(r"\bocupad[oa]s?\b|\bocupacao\s+(?:por|de)\s+terceir|\bhabitado\b", t, _FLAGS):
        return True
    return None


def extrair_comissao_pct(texto: str) -> float | None:
    t = _norm(texto)
    m = re.search(r"comissao[^.;%]{0,80}?(\d{1,2}(?:[.,]\d+)?)\s*%", t, _FLAGS)
    if not m:
        m = re.search(r"(\d{1,2}(?:[.,]\d+)?)\s*%[^.;]{0,40}?(?:de\s+)?comissao", t, _FLAGS)
    return _num(m.group(1)) if m else None


def _por_conta_de(texto: str, assunto: str) -> str | None:
    t = _norm(texto)
    m = re.search(assunto + r"[^.;]{0,120}?(?:por\s+conta|responsabilidade|a\s+cargo|arcad[oa]s?\s+(?:por|pel[oa]s?)|pagos?\s+pel[oa]s?|quitad[oa]s?\s+pel[oa]s?)\s*(?:d[oa]s?|pel[oa]s?)?\s*(comprador|arrematante|adquirente|vendedor|vendedora|caixa|banco|proponente|licitante|credor)",
                  t, _FLAGS)
    if not m:
        m = re.search(r"(comprador|arrematante|adquirente|vendedor|vendedora|caixa|banco|proponente|licitante|credor)[^.;]{0,60}?(?:arcar[aá]?|responsavel|pagar[aá]?|assumir[aá]?)[^.;]{0,60}?" + assunto, t, _FLAGS)
    if not m:
        return None
    quem = m.group(1).lower()
    return "vendedor" if quem in ("vendedor", "vendedora", "caixa", "banco", "credor") else "comprador"


def extrair_debitos_iptu(texto: str) -> str | None:
    return _por_conta_de(texto, r"\biptu\b")


def extrair_debitos_condominio(texto: str) -> str | None:
    return _por_conta_de(texto, r"\bcondomini(?:o|ais)\b")


def extrair_praca(texto: str) -> str | None:
    """Devolve '1ª praça', '2ª praça', '1º leilão' ou '2º leilão' se mencionado."""
    t = _norm(texto)
    m = re.search(r"\b([12])\s*[aªº°o.]?\s*(praca|leilao)\b", t, _FLAGS)
    if not m:
        m = re.search(r"\b(primeir[ao]|segund[ao])\s+(praca|leilao)\b", t, _FLAGS)
        if not m:
            return None
        n = "1" if m.group(1).lower().startswith("primeir") else "2"
    else:
        n = m.group(1)
    palavra = m.group(2).lower()
    if palavra == "praca":
        return f"{n}ª praça"
    return f"{n}º leilão"


_DATA = r"(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})"


def _data_iso(m) -> str | None:
    d, mth, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    try:
        return date(y, mth, d).isoformat()
    except ValueError:
        return None


def extrair_datas_leilao(texto: str) -> tuple[str | None, str | None]:
    """(data_leilao, data_segunda_praca). Pega datas junto de 'leilão'/'praça' e, em último caso, as 2 primeiras datas."""
    t = _norm(texto)
    primeira = segunda = None
    for m in re.finditer(r"\b([12])\s*[aªº°o.]?\s*(?:praca|leilao)\b[^.;]{0,80}?" + _DATA, t, _FLAGS):
        dm = re.search(_DATA, m.group(0))
        iso = _data_iso(dm) if dm else None
        if m.group(1) == "1" and not primeira:
            primeira = iso
        elif m.group(1) == "2" and not segunda:
            segunda = iso
    if not primeira:
        m = re.search(r"(?:leilao|praca|encerramento|abertura)[^.;]{0,60}?" + _DATA, t, _FLAGS)
        if m:
            primeira = _data_iso(re.search(_DATA, m.group(0)))
    return primeira, segunda


def extrair_matricula(texto: str) -> str | None:
    t = _norm(texto)
    m = re.search(r"matricula\s*(?:n|no|n\.|nº|numero)?\s*[:.]?\s*([\d.]{3,})", t, _FLAGS)
    if not m:
        return None
    return m.group(1).replace(".", "")


def extrair_numero_processo(texto: str) -> str | None:
    m = re.search(r"\b(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})\b", texto or "")
    return m.group(1) if m else None


_VIA = r"(?:Rua|R\.|Avenida|Av\.|Travessa|Tv\.|Alameda|Al\.|Rodovia|Rod\.|Estrada|Estr\.|Pra[çc]a|Largo|Ladeira|Beco|Via)"


def extrair_endereco(texto: str) -> str | None:
    """'situado na Rua Tupinambás, nº 120, Bairro X' -> 'Rua Tupinambás, nº 120'. Só logradouro e número."""
    if not texto:
        return None
    m = re.search(_VIA + r"\s+[A-ZÀ-Úa-zà-ú0-9][^,;\n()]{2,60}?(?:,\s*(?:n[ºo°.]?\s*)?\d+[A-Za-z]?)?(?=[,;.\n(]|\s+-\s|\s+(?:bairro|lote|quadra|apto|apartamento|casa|sala|loja|esquina|em|no|na)\b|$)",
                  texto, re.I)
    if not m:
        return None
    end = re.sub(r"\s+", " ", m.group(0)).strip(" ,.")
    return end if len(end) >= 6 else None


def extrair_bairro(texto: str) -> str | None:
    """'Bairro Aquidaban, Cachoeiro' / 'no bairro Mata da Praia' -> 'Aquidaban' / 'Mata da Praia'."""
    if not texto:
        return None
    m = re.search(r"\b[Bb]airro\s+(?:d[aeo]s?\s+)?([A-ZÀ-Ú][\w'ÀÁÂÃÉÊÍÓÔÕÚÇàáâãéêíóôõúç\-]*(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ú0-9][\w'ÀÁÂÃÉÊÍÓÔÕÚÇàáâãéêíóôõúç\-]*){0,3})",
                  texto)
    if not m:
        return None
    b = m.group(1).strip(" ,.-")
    if re.match(r"(?i)^(de|do|da|em|no|na|e|o|a)$", b) or len(b) < 3:
        return None
    return b


def candidatos_bairro_do_fim(texto: str, cidade: str | None) -> list[str]:
    """Descrições de leiloeiro terminam em '... ED. PORTO RICO MATA DA PRAIA - VITÓRIA/ES'. Devolve os
    últimos 3 e 2 termos antes de ' - CIDADE/UF' como candidatos a bairro, para o geocodificador validar."""
    if not texto:
        return []
    m = re.search(r"([A-ZÀ-Ú0-9][A-ZÀ-Ú0-9.'\s]{3,80}?)\s*-\s*([A-ZÀ-Ú][A-ZÀ-Ú\s]+)/([A-Z]{2})\s*(?:\||$)", texto.strip())
    if not m:
        return []
    if cidade and sem_acentos(m.group(2)).strip().lower() != sem_acentos(cidade).lower():
        return []
    palavras = [p for p in re.split(r"\s+", m.group(1).strip()) if p and not re.fullmatch(r"[A-Z]{1,2}\.|N[ºO°]?|\d+", p)]
    saida = []
    for n in (3, 2):
        if len(palavras) >= n:
            cand = " ".join(palavras[-n:])
            cand = re.sub(r"(?i)^(?:DE|DA|DO|DOS|DAS|E|EM|NO|NA|NOS|NAS|COM|AO|À)\s+", "", cand)
            if cand and cand not in saida and len(cand.split()) >= 2 or (cand and len(cand) >= 5 and cand not in saida):
                saida.append(cand)
    return saida


def extrair_tudo(texto: str) -> dict:
    """Todos os campos que o regex consegue tirar do texto; só inclui o que foi encontrado."""
    if not texto:
        return {}
    data_leilao, data_segunda = extrair_datas_leilao(texto)
    achados = {
        "quartos": extrair_quartos(texto),
        "vagas": extrair_vagas(texto),
        "area_privativa_m2": extrair_area_privativa(texto),
        "area_terreno_m2": extrair_area_terreno(texto),
        "area_total_m2": extrair_area_total(texto),
        "aceita_fgts": extrair_aceita_fgts(texto),
        "aceita_financiamento": extrair_aceita_financiamento(texto),
        "aceita_parcelamento": extrair_aceita_parcelamento(texto),
        "ocupado": extrair_ocupado(texto),
        "comissao_leiloeiro_pct": extrair_comissao_pct(texto),
        "debitos_iptu_por_conta_de": extrair_debitos_iptu(texto),
        "debitos_condominio_por_conta_de": extrair_debitos_condominio(texto),
        "data_leilao": data_leilao,
        "data_segunda_praca": data_segunda,
        "matricula": extrair_matricula(texto),
        "numero_processo": extrair_numero_processo(texto),
        "endereco": extrair_endereco(texto),
        "bairro": extrair_bairro(texto),
    }
    return {k: v for k, v in achados.items() if v is not None}
