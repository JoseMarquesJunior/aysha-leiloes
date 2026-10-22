"""Geocodificação com Nominatim (OpenStreetMap), 1 requisição por segundo, cache persistente.

Estratégia por imóvel novo (sem lat/lng e sem entrada no cache):
1. endereço limpo + bairro + cidade + UF  -> geo_precisao "endereco" (só se o nome da rua aparece no resultado)
2. bairro + cidade + UF                   -> "bairro"
3. cidade + UF                            -> "cidade"
Cache em collector/cache/geo.json (commitado), chave = consulta normalizada; falhas também são
guardadas (valor null) para não repetir a consulta todo dia.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

from .schema import sem_acentos

log = logging.getLogger(__name__)

_TIPOS_ENDERECO = {
    "building", "house", "residential", "primary", "secondary", "tertiary", "road", "unclassified",
    "living_street", "pedestrian", "trunk", "service", "street", "address", "amenity", "shop", "office",
    "leisure", "tourism", "place_of_worship", "industrial", "commercial", "retail", "yes", "apartments",
    "footway", "track", "path",
}
_TIPOS_BAIRRO = {"suburb", "neighbourhood", "quarter", "hamlet", "village", "locality", "borough", "city_district"}
_TIPOS_CIDADE = {"city", "town", "municipality", "administrative", "county"}

_PALAVRAS_VIA = {"rua", "avenida", "av", "r", "alameda", "travessa", "praca", "estrada", "rodovia", "ladeira", "beco", "largo"}


def limpar_endereco(endereco: str | None) -> str | None:
    """Mantém logradouro e número; descarta lote/quadra/bloco/apto, que o Nominatim não entende."""
    if not endereco:
        return None
    t = endereco.strip()
    t = re.sub(r"(?i)\b(n|nº|n°|num|numero)\.?\s*(sn|s/n)\b.*$", "", t)
    t = re.sub(r"(?i),?\s*\b(lt|lote|qd|quadra|bl|bloco|ap|apto|apt|apartamento|cs|casa|sl|sala|lj|loja|cj|conj|conjunto|ed|edif|edificio)\b.*$", "", t)
    t = re.sub(r"(?i)\b(n|nº|n°|num|numero)\.?\s*(\d+)", r"\2", t)
    t = re.sub(r"\s+", " ", t).strip(" ,.-")
    return t or None


def _chave(*partes: str | None) -> str:
    return "|".join(sem_acentos(p or "").lower().strip() for p in partes)


def _rua_bate(endereco_limpo: str, display_name: str) -> bool:
    """Confere se alguma palavra significativa do logradouro aparece no resultado (evita rua trocada)."""
    palavras = [p for p in re.findall(r"[a-z]{3,}", sem_acentos(endereco_limpo).lower()) if p not in _PALAVRAS_VIA]
    alvo = sem_acentos(display_name).lower()
    return any(p in alvo for p in palavras) if palavras else True


class Geocodificador:
    def __init__(self, cliente, url: str, caminho_cache: str, intervalo: float = 1.1, maximo: int = 400,
                 precisao_maxima_por_uf: dict | None = None):
        self.cliente = cliente
        self.url = url
        self.caminho = Path(caminho_cache)
        self.intervalo = intervalo
        self.maximo = maximo
        self.precisao_maxima_por_uf = precisao_maxima_por_uf or {}
        self.consultas = 0
        self.cache: dict = {}
        if self.caminho.exists():
            self.cache = json.loads(self.caminho.read_text(encoding="utf-8"))

    def salvar(self) -> None:
        self.caminho.parent.mkdir(parents=True, exist_ok=True)
        self.caminho.write_text(json.dumps(self.cache, ensure_ascii=False, indent=0, sort_keys=True), encoding="utf-8")

    def _consultar(self, q: str) -> dict | None:
        chave = _chave(q)
        if chave in self.cache:
            return self.cache[chave]
        if self.consultas >= self.maximo:
            return {"_limite": True}
        self.consultas += 1
        try:
            # api=True: o robots.txt do Nominatim bloqueia /search para rastreadores; o uso como API segue a
            # Nominatim Usage Policy (1 req/s, User-Agent identificado), que é o que fazemos aqui.
            r = self.cliente.get(self.url, params={"q": q, "format": "jsonv2", "limit": 1, "countrycodes": "br"},
                                 intervalo=self.intervalo, api=True)
            dados = r.json()
        except Exception as e:  # falha de rede não derruba a coleta
            log.warning("nominatim falhou para %r: %s", q, e)
            return None
        res = None
        if dados:
            d = dados[0]
            res = {"lat": float(d["lat"]), "lng": float(d["lon"]), "tipo": d.get("addresstype") or d.get("type"),
                   "nome": d.get("display_name")}
        self.cache[chave] = res
        return res

    def geocodificar(self, r: dict) -> None:
        """Preenche lat, lng e geo_precisao no registro (in place)."""
        if r.get("lat") is not None and r.get("lng") is not None:
            return
        cidade, uf, bairro = r.get("cidade"), r.get("uf"), r.get("bairro")
        if not cidade or not uf:
            return
        endereco = limpar_endereco(r.get("endereco"))
        maxima = self.precisao_maxima_por_uf.get(uf, "endereco")
        tentativas = []
        if endereco and maxima == "endereco":
            tentativas.append(("endereco", ", ".join(p for p in (endereco, bairro, cidade, uf, "Brasil") if p)))
        if bairro and maxima in ("endereco", "bairro"):
            tentativas.append(("bairro", ", ".join((bairro, cidade, uf, "Brasil"))))
        tentativas.append(("cidade", ", ".join((cidade, uf, "Brasil"))))
        for precisao, q in tentativas:
            res = self._consultar(q)
            if res and res.get("_limite"):
                return
            if not res:
                continue
            tipo = res.get("tipo") or ""
            if precisao == "endereco":
                if tipo in _TIPOS_BAIRRO or tipo in _TIPOS_CIDADE:
                    continue  # devolveu só o bairro/cidade: tenta a consulta mais ampla, que marca a precisão certa
                if not _rua_bate(endereco, res.get("nome") or ""):
                    continue
            if precisao == "bairro" and tipo in _TIPOS_CIDADE:
                continue
            r["lat"], r["lng"], r["geo_precisao"] = res["lat"], res["lng"], precisao
            return
