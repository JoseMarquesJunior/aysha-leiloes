"""Partes determinísticas da etapa de IA (nenhum teste chama a API)."""

import json

from collector import ia
from collector.schema import novo_registro

CFG = {
    "modelo": "claude-haiku-5-5", "max_tokens_saida": 900, "max_caracteres_entrada": 6000,
    "limite_chamadas_por_execucao": 50, "limite_custo_usd_por_execucao": 0.5,
    "filtro": {"ufs": ["ES"], "cidades": ["Vitória", "Vila Velha", "Serra", "Cariacica", "Guarapari"], "desconto_minimo_pct": 30},
    "campos_alto_valor": ["ocupado", "debitos_iptu_por_conta_de", "debitos_condominio_por_conta_de", "onus_na_matricula"],
    "palavras_chave": ["ocupa", "IPTU", "condomínio", "débito", "ônus", "penhora", "hipoteca", "comissão", "FGTS", "financiamento"],
}


def test_candidatos_respeitam_filtro_e_campos():
    a = novo_registro(id="a", fonte="caixa", uf="ES", cidade="Vila Velha", desconto_pct=45.0)
    b = novo_registro(id="b", fonte="caixa", uf="ES", cidade="Vila Velha", desconto_pct=10.0)      # desconto baixo
    c = novo_registro(id="c", fonte="caixa", uf="MG", cidade="Belo Horizonte", desconto_pct=60.0)  # UF fora
    d = novo_registro(id="d", fonte="caixa", uf="ES", cidade="Serra", desconto_pct=80.0, ocupado=False,
                      debitos_iptu_por_conta_de="vendedor", debitos_condominio_por_conta_de="vendedor",
                      extracao_ia={"onus_na_matricula": ["penhora"]})                                # já completo
    e = novo_registro(id="e", fonte="caixa", uf="ES", cidade="Serra", desconto_pct=70.0)
    lista = ia.candidatos([a, b, c, d, e], CFG)
    assert [r["id"] for r in lista] == ["e", "a"]  # maior desconto primeiro


def test_trechos_relevantes_remove_cabecalho_e_limita():
    texto = "\n".join(["PODER JUDICIÁRIO", "linha 1", "linha 2", "O imóvel está ocupado por terceiros.", "linha 4", "linha 5",
                       "PODER JUDICIÁRIO", "Página 2 de 3", "longe 1", "longe 2", "perto", "PODER JUDICIÁRIO",
                       "Débitos de IPTU por conta do arrematante.", "fim"])
    r = ia.trechos_relevantes(texto, CFG["palavras_chave"], max_caracteres=6000, contexto=1)
    assert "ocupado por terceiros" in r and "IPTU" in r
    assert "PODER JUDICIÁRIO" not in r and "Página 2" not in r
    assert "perto" in r and "linha 2" in r          # 1 linha de contexto
    assert "longe 1" not in r and "linha 1" not in r  # fora do contexto
    assert "…" in r  # separador entre blocos não contíguos
    assert len(ia.trechos_relevantes("ocupa " * 5000, ["ocupa"], max_caracteres=100)) == 100


def test_remover_nomes():
    assert ia.remover_nomes("Executado: João da Silva Pereira, CPF 123.456.789-00") == "Executado: [nome], [CPF]"
    assert ia.remover_nomes("situado na Rua Monte Castelo, Bairro Vera Cruz") == "situado na Rua Monte Castelo, Bairro Vera Cruz"
    assert ia.remover_nomes("penhora em favor da Caixa Econômica Federal") == "penhora em favor da Caixa Econômica Federal"
    assert ia.remover_nomes("hipoteca") == "hipoteca"
    assert ia.remover_nomes(None) is None


def test_limpar_resultado_e_aplicar_sem_sobrescrever():
    bruto = {"ocupado": True, "debitos_iptu_por_conta_de": "arrematante", "debitos_condominio_por_conta_de": "vendedor",
             "aceita_financiamento": None, "aceita_fgts": "sim", "comissao_leiloeiro_pct": "5",
             "onus_na_matricula": ["penhora em favor de Maria José Santos", "hipoteca"],
             "alertas": ["Imóvel ocupado; desocupação por conta do comprador"],
             "trechos_fonte": {"ocupado": "x" * 300, "comissao_leiloeiro_pct": "comissão de 5%", "onus_na_matricula": None}}
    limpo = ia._limpar_resultado(bruto)
    assert limpo["debitos_iptu_por_conta_de"] is None       # valor fora do enum
    assert limpo["aceita_fgts"] is None                      # não booleano
    assert limpo["comissao_leiloeiro_pct"] == 5.0
    assert limpo["onus_na_matricula"][0] == "penhora em favor de [nome]"
    assert len(limpo["trechos_fonte"]["ocupado"]) == 200
    assert "onus_na_matricula" not in limpo["trechos_fonte"]
    r = novo_registro(id="x", fonte="caixa", ocupado=False, comissao_leiloeiro_pct=None)
    ia.aplicar_resultado(r, {"hash": "abc", "modelo": "claude-haiku-5-5", "processado_em": "2026-10-21T10:00:00", "resultado": limpo})
    assert r["ocupado"] is False                             # já preenchido: a IA não sobrescreve
    assert r["comissao_leiloeiro_pct"] == 5.0                # estava null: preenche
    assert r["debitos_condominio_por_conta_de"] == "vendedor"
    assert r["extracao_ia"]["hash_documento"] == "abc" and r["extracao_ia"]["alertas"]


def test_requisicao_fixa_e_json():
    req = ia.montar_requisicao("h1", "texto", CFG)
    p = req["params"]
    assert p["model"] == "claude-haiku-5-5" and p["max_tokens"] == 900
    assert p["thinking"] == {"type": "disabled"} and p["output_config"]["effort"] == "low"
    assert p["output_config"]["format"]["type"] == "json_schema"
    assert p["system"][0]["cache_control"] == {"type": "ephemeral"} and p["system"][0]["text"] == ia.SISTEMA
    assert p["messages"] == [{"role": "user", "content": "texto"}]
    json.dumps(ia.ESQUEMA)  # esquema serializável


def test_custo_e_estimativa():
    assert ia.custo_usd("claude-haiku-5-5", 1_000_000, 0, batch=False) == 0.1
    assert ia.custo_usd("claude-haiku-5-5", 1_000_000, 0, batch=True) == 0.05
    regs = [novo_registro(id=f"r{i}", fonte="caixa", uf="ES", cidade="Serra", desconto_pct=50.0) for i in range(80)]
    e = ia.estimativa(regs, CFG)
    assert e["candidatos_hoje"] == 80 and e["chamadas_por_execucao_max"] == 50
    assert e["custo_usd_por_execucao_batch"] <= 0.5
