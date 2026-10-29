"""Localizações precisas descobertas nas visitas ao site (Worker POST /geo, guardadas no D1).

A ficha de um imóvel com endereço e localização aproximada pede ao Worker a geocodificação do
endereço na primeira visita; a coleta diária puxa esses pontos (GET /interno/geo, com WORKER_URL e
INTERNO_SECRET no ambiente) e grava na base, para que o mapa fique preciso para sempre sem
geocodificar os milhares de imóveis que nunca receberam visita.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.request

log = logging.getLogger(__name__)


def aplicar_geo_worker(registros: list[dict]) -> int:
    """Aplica lat/lng/geo_precisao="endereco" aos registros com ponto descoberto. Devolve quantos mudaram."""
    url, segredo = os.environ.get("WORKER_URL", "").rstrip("/"), os.environ.get("INTERNO_SECRET", "")
    if not url or not segredo:
        return 0
    req = urllib.request.Request(f"{url}/interno/geo",
                                 headers={"X-Interno": segredo, "User-Agent": "aysha-leiloes-coleta"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            pontos = json.loads(resp.read().decode("utf-8")).get("pontos", [])
    except Exception as e:  # indisponibilidade do Worker nunca derruba a coleta
        log.warning("GET /interno/geo falhou: %s", e)
        return 0
    por_id = {p["id"]: p for p in pontos
              if p.get("precisao") == "endereco" and isinstance(p.get("lat"), (int, float)) and isinstance(p.get("lng"), (int, float))}
    if not por_id:
        return 0
    n = 0
    for r in registros:
        p = por_id.get(r.get("id"))
        if p and r.get("geo_precisao") != "endereco":
            r["lat"], r["lng"], r["geo_precisao"] = p["lat"], p["lng"], "endereco"
            n += 1
    return n
