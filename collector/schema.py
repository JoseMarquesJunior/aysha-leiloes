"""Esquema de cada imóvel em docs/data/imoveis.json e campos derivados."""

from __future__ import annotations

import re
import unicodedata

CAMPOS = [
    "id", "fonte", "url_anuncio", "url_edital", "url_matricula", "leiloeiro",
    "tipo", "uf", "cidade", "bairro", "endereco", "lat", "lng", "geo_precisao",
    "area_privativa_m2", "area_terreno_m2", "area_total_m2", "quartos", "vagas",
    "valor_avaliacao", "valor_minimo", "desconto_pct", "valor_m2",
    "natureza", "modalidade", "data_leilao", "data_segunda_praca",
    "ocupado", "aceita_financiamento", "aceita_fgts", "aceita_parcelamento",
    "debitos_iptu_por_conta_de", "debitos_condominio_por_conta_de",
    "comissao_leiloeiro_pct", "matricula", "numero_processo",
    "descricao_original", "url_foto",
    "primeira_vez_visto", "ultima_vez_visto", "ativo",
    "outras_fontes", "extracao_ia",
]

TIPOS = ("apartamento", "casa", "terreno", "comercial", "rural", "outro")
NATUREZAS = ("venda direta", "leilão extrajudicial", "leilão judicial", "licitação")

# Campos essenciais guardados em cada snapshot diário.
CAMPOS_SNAPSHOT = ("id", "valor_minimo", "modalidade", "data_leilao")


def novo_registro(**valores) -> dict:
    """Registro com todos os campos do esquema (null quando desconhecido)."""
    r = {c: None for c in CAMPOS}
    r["outras_fontes"] = []
    r["ativo"] = True
    for k, v in valores.items():
        if k not in r:
            raise KeyError(f"campo fora do esquema: {k}")
        r[k] = v
    return r


def sem_acentos(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def normalizar_tipo(texto: str | None) -> str | None:
    """Mapeia o tipo informado pela fonte para o conjunto fechado do esquema."""
    if not texto:
        return None
    t = sem_acentos(texto).lower().strip()
    if re.search(r"\b(apartamento|apto|ap\b|cobertura|kitnet|flat|studio|loft)", t):
        return "apartamento"
    if re.search(r"\b(casa|sobrado|residencia|residencial)", t):
        return "casa"
    if re.search(r"\b(terreno|lote|gleba|area\b)", t):
        return "terreno" if not re.search(r"\b(rural|chacara|sitio|fazenda)", t) else "rural"
    if re.search(r"\b(chacara|sitio|fazenda|rural|haras)", t):
        return "rural"
    if re.search(r"\b(loja|sala|galpao|comercial|predio|escritorio|box|garagem|vaga|hotel|pousada|imovel comercial|barracao|deposito)", t):
        return "comercial"
    return "outro"


def calcular_desconto_pct(valor_avaliacao, valor_minimo):
    """Desconto do lance mínimo sobre a avaliação, em %. Negativo quando o mínimo supera a avaliação."""
    if not valor_avaliacao or valor_minimo is None or valor_avaliacao <= 0:
        return None
    return round((1 - valor_minimo / valor_avaliacao) * 100, 2)


def calcular_valor_m2(valor_minimo, tipo, area_privativa, area_terreno):
    """R$/m² sobre a área privativa; para terreno, sobre a área do terreno."""
    if valor_minimo is None:
        return None
    area = area_terreno if tipo == "terreno" else area_privativa
    if not area and tipo != "terreno":
        area = None
    if not area or area <= 0:
        return None
    return round(valor_minimo / area, 2)


def preencher_derivados(r: dict) -> dict:
    r["desconto_pct"] = calcular_desconto_pct(r.get("valor_avaliacao"), r.get("valor_minimo"))
    r["valor_m2"] = calcular_valor_m2(r.get("valor_minimo"), r.get("tipo"),
                                      r.get("area_privativa_m2"), r.get("area_terreno_m2"))
    return r


def completar(r: dict, *, preencher_null_com: dict | None = None) -> dict:
    """Preenche campos ainda null com valores de outra origem (regex/IA), sem sobrescrever o que já existe."""
    if preencher_null_com:
        for k, v in preencher_null_com.items():
            if k in r and r[k] is None and v is not None:
                r[k] = v
    return r


def titulo(s: str | None) -> str | None:
    """'VILA VELHA' -> 'Vila Velha' (mantém preposições minúsculas)."""
    if not s:
        return s
    pequenas = {"de", "da", "do", "das", "dos", "e"}
    partes = []
    for i, p in enumerate(s.lower().split()):
        partes.append(p if (p in pequenas and i > 0) else p.capitalize())
    return " ".join(partes)
