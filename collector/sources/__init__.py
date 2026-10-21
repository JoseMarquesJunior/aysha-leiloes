"""Fontes de dados. Cada módulo expõe `coletar(config, cliente) -> list[dict]` (registros no esquema).

Para adicionar uma fonte: criar `collector/sources/<nome>.py` com a função `coletar`,
registrar o nome em `REGISTRO` abaixo e acrescentar `fontes.<nome>.ativa` no config.yaml.
"""

from . import caixa, resale

REGISTRO = {
    "caixa": caixa,
    "resale": resale,
}
