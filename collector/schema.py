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
    "comissao_leiloeiro_pct", "matricula", "numero_processo", "comitente",
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
    if re.search(r"\b(apartamentos?|apto|ap\b|coberturas?|kitnet|flat|studio|loft)", t):
        return "apartamento"
    if re.search(r"\b(chacaras?|sitios?|fazendas?|rural|rurais|haras)\b", t) and not re.search(r"\b(casa|sobrado)\b", t):
        return "rural"
    if re.search(r"\b(casas?|sobrados?|residencia|residencial)\b", t):
        return "casa"
    if re.search(r"\b(terrenos?|lotes?|glebas?|area\b)", t):
        return "terreno" if not re.search(r"\b(rural|chacara|sitio|fazenda)", t) else "rural"
    if re.search(r"\b(lojas?|salas?|galpao|galpoes|comercia(?:l|is)|industria(?:l|is)|predios?|escritorios?|box|garagem|vagas?|hotel|pousada|barracao|deposito)", t):
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


_MUNICIPIOS: dict[tuple[str, str], str] | None = None


def _municipios() -> dict[tuple[str, str], str]:
    """{(UF, nome sem acento em minúsculas): nome oficial do IBGE} (collector/dados/municipios_ibge.json)."""
    global _MUNICIPIOS
    if _MUNICIPIOS is None:
        import json
        from pathlib import Path
        p = Path(__file__).resolve().parent / "dados" / "municipios_ibge.json"
        _MUNICIPIOS = {}
        if p.exists():
            for uf, nomes in json.loads(p.read_text(encoding="utf-8")).items():
                for nome in nomes:
                    _MUNICIPIOS[(uf, sem_acentos(nome).lower())] = nome
    return _MUNICIPIOS


def canonizar_cidades(registros: list[dict]) -> int:
    """Troca a grafia da cidade pela oficial do IBGE ("Sao Goncalo" → "São Gonçalo", "VILA VELHA" → "Vila Velha").
    Cidades que não casam com o IBGE ficam como estão. Devolve quantos registros mudaram."""
    mapa = _municipios()
    if not mapa:
        return 0
    n = 0
    for r in registros:
        c, uf = r.get("cidade"), r.get("uf")
        if not c or not uf or not isinstance(c, str):
            continue
        # editais escrevem "Município de Serra", "Comarca de Colatina", "Urbano de X": fica só o nome
        limpo = re.sub(r"(?i)^(munic[ií]pio|cidade|comarca|distrito|urbano|zona urbana|perímetro urbano|per[ií]metro urbano)\s+d[eao]s?\s+", "", c).strip()
        oficial = mapa.get((uf, sem_acentos(limpo).lower()))
        novo = oficial or (limpo if limpo != c else c)
        if novo != c:
            r["cidade"] = novo
            n += 1
    return n


def normalizar_grafias(registros: list[dict], campo: str, chave_grupo) -> int:
    """Unifica grafias do mesmo nome ("Vitoria" e "Vitória", "VILA VELHA" e "Vila Velha") dentro de cada grupo
    (UF para cidade; UF + cidade para bairro). Entre as variantes, vence a que tem acento; empatando, a
    mais frequente. Devolve quantos registros mudaram."""
    variantes: dict[tuple, dict[str, int]] = {}
    for r in registros:
        v = r.get(campo)
        if not v or not isinstance(v, str):
            continue
        chave = (*chave_grupo(r), sem_acentos(v).lower().strip())
        grupo = variantes.setdefault(chave, {})
        grupo[v.strip()] = grupo.get(v.strip(), 0) + 1
    escolha = {}
    for chave, grupo in variantes.items():
        if len(grupo) > 1:
            escolha[chave] = max(grupo.items(), key=lambda it: (any(ord(ch) > 127 for ch in it[0]), it[0] != it[0].upper(), it[1]))[0]
    n = 0
    for r in registros:
        v = r.get(campo)
        if not v or not isinstance(v, str):
            continue
        alvo = escolha.get((*chave_grupo(r), sem_acentos(v).lower().strip()))
        if alvo and alvo != v:
            r[campo] = alvo
            n += 1
    return n


def titulo(s: str | None) -> str | None:
    """'VILA VELHA' -> 'Vila Velha' (mantém preposições minúsculas)."""
    if not s:
        return s
    pequenas = {"de", "da", "do", "das", "dos", "e"}
    partes = []
    for i, p in enumerate(s.lower().split()):
        partes.append(p if (p in pequenas and i > 0) else p.capitalize())
    return " ".join(partes)
