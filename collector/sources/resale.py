"""Fonte Resale (imóveis retomados de BB, Santander, BTG e outros) — ESQUELETO DESATIVADO.

Pendente (ver README, seção "Fontes"): ler os termos de uso de resale.com.br e verificar se há API,
feed, sitemap ou JSON consumido pela própria página. Só depois disso o módulo será implementado,
e apenas se os termos permitirem coleta automatizada.
"""

from __future__ import annotations

NOME = "resale"
SITE = "https://www.resale.com.br/"

ultima_info: dict = {}


def coletar(config: dict, cliente) -> list[dict]:
    raise NotImplementedError("resale: fonte desativada até a verificação dos termos de uso (README)")
