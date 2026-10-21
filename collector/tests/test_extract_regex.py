from collector import extract_regex as ex


def test_quartos_e_vagas_formato_caixa():
    t = "Apartamento, 84.78 de área total, 67.20 de área privativa, 0.00 de área do terreno,  2 qto(s), varanda, 1 vaga(s) de garagem."
    assert ex.extrair_quartos(t) == 2
    assert ex.extrair_vagas(t) == 1


def test_quartos_formato_edital():
    assert ex.extrair_quartos("Apartamento com 3 quartos, sendo 1 suíte, e 2 vagas de garagem") == 3
    assert ex.extrair_vagas("Apartamento com 3 quartos, sendo 1 suíte, e 2 vagas de garagem") == 2
    assert ex.extrair_quartos("Terreno sem benfeitorias") is None


def test_areas():
    t = "Casa, 62.00 de área total, 62.00 de área privativa, 200.00 de área do terreno"
    assert ex.extrair_area_privativa(t) == 62.0
    assert ex.extrair_area_terreno(t) == 200.0
    assert ex.extrair_area_total(t) == 62.0
    assert ex.extrair_area_privativa("Terreno, 0.00 de área total, 0.00 de área privativa, 334.75 de área do terreno.") is None
    assert ex.extrair_area_privativa("Área privativa de 45,30 m² e área total de 60,10m²") == 45.3
    assert ex.extrair_area_total("Área privativa de 45,30 m² e área total de 60,10m²") == 60.1


def test_fgts_financiamento():
    assert ex.extrair_aceita_fgts("Imóvel aceita FGTS e financiamento habitacional") is True
    assert ex.extrair_aceita_financiamento("Imóvel aceita FGTS e financiamento habitacional") is True
    assert ex.extrair_aceita_fgts("Não aceita FGTS. Venda somente à vista") is False
    assert ex.extrair_aceita_financiamento("Imóvel sem financiamento") is False
    assert ex.extrair_aceita_fgts("Casa com 2 quartos") is None
    assert ex.extrair_aceita_parcelamento("Permitido parcelamento em até 60 meses") is True


def test_ocupado():
    assert ex.extrair_ocupado("Imóvel ocupado. Desocupação por conta do comprador.") is True
    assert ex.extrair_ocupado("Imóvel desocupado, livre para visita") is False
    assert ex.extrair_ocupado("Apartamento 2 quartos") is None


def test_comissao():
    assert ex.extrair_comissao_pct("Comissão do leiloeiro: 5% sobre o valor da arrematação") == 5.0
    assert ex.extrair_comissao_pct("acrescido de 5,5% a título de comissão") == 5.5
    assert ex.extrair_comissao_pct("sem comissão informada") is None


def test_debitos():
    t = "Débitos de IPTU por conta do comprador. Despesas de condomínio serão arcadas pelo vendedor."
    assert ex.extrair_debitos_iptu(t) == "comprador"
    assert ex.extrair_debitos_condominio(t) == "vendedor"
    assert ex.extrair_debitos_iptu("Os débitos de IPTU e condomínio são de responsabilidade da Caixa") == "vendedor"
    assert ex.extrair_debitos_iptu("nada consta") is None


def test_praca_e_datas():
    t = "1ª praça em 10/11/2026 às 14h; 2ª praça em 24/11/2026 às 14h. Comissão 5%."
    assert ex.extrair_praca(t) == "1ª praça"
    assert ex.extrair_datas_leilao(t) == ("2026-11-10", "2026-11-24")
    assert ex.extrair_praca("2º Leilão SFI em 03/12/2026") == "2º leilão"
    assert ex.extrair_datas_leilao("Leilão em 03/12/2026") == ("2026-12-03", None)
    assert ex.extrair_datas_leilao("Venda direta online") == (None, None)
    assert ex.extrair_datas_leilao("Leilão em 31/02/2026") == (None, None)  # data inválida


def test_matricula_e_processo():
    assert ex.extrair_matricula("Matrícula nº 12.345 do 1º Ofício de Vitória") == "12345"
    assert ex.extrair_matricula("matricula 98765") == "98765"
    assert ex.extrair_numero_processo("Processo 0001234-56.2024.8.08.0024, 3ª Vara") == "0001234-56.2024.8.08.0024"


def test_extrair_tudo_so_devolve_encontrados():
    r = ex.extrair_tudo("Casa, 62.00 de área total, 62.00 de área privativa, 200.00 de área do terreno, 2 qto(s)")
    assert r["quartos"] == 2
    assert r["area_terreno_m2"] == 200.0
    assert "ocupado" not in r
    assert "vagas" not in r
    assert ex.extrair_tudo("") == {}


def test_num():
    assert ex._num("1.234,56") == 1234.56
    assert ex._num("67.20") == 67.2
    assert ex._num("334") == 334.0
    assert ex._num("12.502.000") == 12502000.0
    assert ex._num("abc") is None
