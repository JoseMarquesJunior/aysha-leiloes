"""Deduplicação entre fontes.

Critérios: (a) mesma matrícula (quando ambas têm); (b) endereço normalizado + cidade iguais e área
(privativa, ou do terreno quando terreno) dentro de 2%. O registro principal é o da fonte com menor
prioridade numérica (config `prioridade_fontes`: banco/órgão antes de leiloeiro); os demais entram
em `outras_fontes` do principal e são removidos da lista — nunca silenciosamente: cada ocorrência
guarda fonte, id e URL, e a página de detalhe mostra todas.
"""

from __future__ import annotations

import re

from .schema import sem_acentos

_ABREV = {
    "r": "rua", "av": "avenida", "avn": "avenida", "al": "alameda", "tv": "travessa", "trav": "travessa",
    "pc": "praca", "pca": "praca", "est": "estrada", "rod": "rodovia", "lad": "ladeira", "lt": "lote",
    "qd": "quadra", "q": "quadra", "n": "", "no": "", "num": "", "sn": "", "s/n": "", "ap": "apto",
    "apt": "apto", "apartamento": "apto", "bl": "bloco", "cs": "casa", "ed": "edificio", "edif": "edificio",
    "cj": "conjunto", "conj": "conjunto",
}


def normalizar_endereco(endereco: str | None) -> str:
    if not endereco:
        return ""
    t = sem_acentos(endereco).lower()
    t = re.sub(r"[.,;:/\-()]", " ", t)
    t = re.sub(r"[^a-z0-9 ]", "", t)
    palavras = []
    for p in t.split():
        p = _ABREV.get(p, p)
        if p:
            palavras.append(p)
    return " ".join(palavras)


def _area_ref(r: dict) -> float | None:
    if r.get("tipo") == "terreno":
        return r.get("area_terreno_m2") or r.get("area_privativa_m2")
    return r.get("area_privativa_m2") or r.get("area_terreno_m2")


def _areas_compativeis(a: float | None, b: float | None, tolerancia: float = 0.02) -> bool:
    if a is None or b is None:
        return a is None and b is None
    if a == 0 or b == 0:
        return False
    return abs(a - b) / max(a, b) <= tolerancia


def sao_duplicatas(a: dict, b: dict) -> bool:
    if a.get("fonte") == b.get("fonte") and a.get("id") == b.get("id"):
        return False
    ma, mb = a.get("matricula"), b.get("matricula")
    if ma and mb:
        if ma == mb and (a.get("cidade") or "").lower() == (b.get("cidade") or "").lower():
            return True
    ea, eb = normalizar_endereco(a.get("endereco")), normalizar_endereco(b.get("endereco"))
    if not ea or not eb or ea != eb:
        return False
    if sem_acentos(a.get("cidade") or "").lower() != sem_acentos(b.get("cidade") or "").lower():
        return False
    if (a.get("uf") or "") != (b.get("uf") or ""):
        return False
    return _areas_compativeis(_area_ref(a), _area_ref(b))


def _prioridade(r: dict, prioridades: dict) -> int:
    fonte = r.get("fonte") or ""
    if fonte in prioridades:
        return prioridades[fonte]
    if fonte.startswith("leiloeiro"):
        return prioridades.get("leiloeiro", 2)
    return 5


def deduplicar(registros: list[dict], prioridades: dict | None = None) -> list[dict]:
    """Agrupa duplicatas; devolve só os registros principais, com `outras_fontes` preenchido."""
    prioridades = prioridades or {}
    # índice por (cidade normalizada) para evitar comparação quadrática em bases grandes
    grupos: dict[str, list[dict]] = {}
    for r in registros:
        chave = sem_acentos(r.get("cidade") or "").lower() + "|" + (r.get("uf") or "")
        grupos.setdefault(chave, []).append(r)

    saida: list[dict] = []
    for lista in grupos.values():
        usados = [False] * len(lista)
        for i, a in enumerate(lista):
            if usados[i]:
                continue
            bloco = [a]
            usados[i] = True
            for j in range(i + 1, len(lista)):
                if not usados[j] and any(sao_duplicatas(x, lista[j]) for x in bloco):
                    bloco.append(lista[j])
                    usados[j] = True
            bloco.sort(key=lambda r: (_prioridade(r, prioridades), r.get("fonte") or "", r.get("id") or ""))
            principal = bloco[0]
            outras = list(principal.get("outras_fontes") or [])
            for o in bloco[1:]:
                outras.append({"fonte": o.get("fonte"), "id": o.get("id"), "url_anuncio": o.get("url_anuncio"),
                               "valor_minimo": o.get("valor_minimo"), "modalidade": o.get("modalidade"),
                               "leiloeiro": o.get("leiloeiro")})
                # campos que a fonte principal não tem, mas a secundária tem, completam o principal
                for k, v in o.items():
                    if k in principal and principal[k] is None and v is not None and k not in ("id", "fonte", "url_anuncio"):
                        principal[k] = v
            principal["outras_fontes"] = outras
            saida.append(principal)
    return saida
