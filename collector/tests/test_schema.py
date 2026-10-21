import pytest

from collector.schema import (CAMPOS, calcular_desconto_pct, calcular_valor_m2, completar, normalizar_tipo,
                              novo_registro, preencher_derivados, titulo)


def test_novo_registro_tem_todos_os_campos_null():
    r = novo_registro(id="x", fonte="caixa")
    assert set(r) == set(CAMPOS)
    assert r["id"] == "x"
    assert r["tipo"] is None
    assert r["outras_fontes"] == []
    assert r["ativo"] is True
    with pytest.raises(KeyError):
        novo_registro(campo_inexistente=1)


def test_desconto():
    assert calcular_desconto_pct(100000, 60000) == 40.0
    assert calcular_desconto_pct(275000.0, 168383.74) == 38.77
    assert calcular_desconto_pct(383762.59, 910600.55) == -137.28  # mínimo acima da avaliação
    assert calcular_desconto_pct(None, 60000) is None
    assert calcular_desconto_pct(0, 60000) is None
    assert calcular_desconto_pct(100000, None) is None


def test_valor_m2():
    assert calcular_valor_m2(168383.74, "apartamento", 67.2, None) == 2505.71
    assert calcular_valor_m2(52308.74, "terreno", None, 334.75) == 156.26
    # terreno com área privativa informada por engano: continua usando o terreno
    assert calcular_valor_m2(100000, "terreno", 50, 200) == 500.0
    assert calcular_valor_m2(100000, "casa", None, 200) is None  # sem área privativa não inventa
    assert calcular_valor_m2(None, "casa", 50, None) is None
    assert calcular_valor_m2(100000, "casa", 0, None) is None


def test_preencher_derivados():
    r = novo_registro(valor_avaliacao=200000, valor_minimo=150000, tipo="casa", area_privativa_m2=100)
    preencher_derivados(r)
    assert r["desconto_pct"] == 25.0
    assert r["valor_m2"] == 1500.0


def test_completar_nao_sobrescreve():
    r = novo_registro(quartos=3, vagas=None)
    completar(r, preencher_null_com={"quartos": 2, "vagas": 1, "ocupado": None})
    assert r["quartos"] == 3
    assert r["vagas"] == 1
    assert r["ocupado"] is None


def test_normalizar_tipo():
    assert normalizar_tipo("Apartamento") == "apartamento"
    assert normalizar_tipo("Casa") == "casa"
    assert normalizar_tipo("Sobrado") == "casa"
    assert normalizar_tipo("Terreno") == "terreno"
    assert normalizar_tipo("Gleba") == "terreno"
    assert normalizar_tipo("Lote rural") == "rural"
    assert normalizar_tipo("Chácara") == "rural"
    assert normalizar_tipo("Loja") == "comercial"
    assert normalizar_tipo("Galpão") == "comercial"
    assert normalizar_tipo("Sala") == "comercial"
    assert normalizar_tipo("Prédio") == "comercial"
    assert normalizar_tipo("Imóvel") == "outro"
    # subcategorias no plural (HD Leilões, Sued Peter)
    assert normalizar_tipo("Comerciais") == "comercial"
    assert normalizar_tipo("Industriais") == "comercial"
    assert normalizar_tipo("Terrenos e lotes") == "terreno"
    assert normalizar_tipo("Fazendas, sítios e chácaras") == "rural"
    assert normalizar_tipo("Apartamentos") == "apartamento"
    assert normalizar_tipo("Casas") == "casa"
    assert normalizar_tipo(None) is None


def test_titulo():
    assert titulo("VILA VELHA") == "Vila Velha"
    assert titulo("CACHOEIRO DE ITAPEMIRIM") == "Cachoeiro de Itapemirim"
    assert titulo("") == ""
