"""Fonte HD Leilões (leiloeira Hidirlene Duszeiko) — hdleiloes.com.br — ESQUELETO DESATIVADO.

Inspecionado em 2026-10-21: plataforma "Leilões Judiciais Brasil" (vlance). Há 225 lotes no ES
(166 imóveis) segundo /core/api/get-dados-filtros, mas:
- a busca (/busca/pesquisar) só responde a formulário POST montado por JavaScript (GET devolve vazio);
- os Termos de Uso ficam num Zendesk (atendimento.leiloesjudiciais.com.br) que devolve 403 ao nosso
  User-Agent, então não foi possível ler se permitem coleta automatizada;
- não há robots.txt (404).
Enquanto os termos não forem lidos (abrir no navegador e registrar aqui), a fonte fica desligada.
Os leilões da JFES conduzidos por ela entram pelo módulo `jfes` (editais em PDF).
"""

from __future__ import annotations

NOME = "leiloeiro-hd"
SITE = "https://www.hdleiloes.com.br/"
ultima_info: dict = {}


def coletar(config: dict, cliente) -> list[dict]:
    raise NotImplementedError("hdleiloes: desativada até a leitura dos termos de uso (ver docstring)")
