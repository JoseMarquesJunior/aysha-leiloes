"""Fontes de dados. Cada módulo expõe `coletar(config, cliente) -> list[dict]` (registros no esquema),
`NOME`, `SITE` e `ultima_info` (dict livre gravado em status_fontes.json; a chave "editais" é agregada
em docs/data/editais.json).

Para adicionar uma fonte: criar `collector/sources/<nome>.py` com a função `coletar`,
registrar o nome em `REGISTRO` abaixo e acrescentar `fontes.<nome>.ativa` no config.yaml.
"""

from . import bandes, banestes, caixa, colodete, hdleiloes, jfes, resale, spu, suporteleiloes, vixleiloes

REGISTRO = {
    "caixa": caixa,
    "banestes": banestes,
    "bandes": bandes,
    "spu": spu,
    "jfes": jfes,
    "suporteleiloes": suporteleiloes,
    "vixleiloes": vixleiloes,
    "colodete": colodete,
    "hdleiloes": hdleiloes,
    "resale": resale,
}
