from collector.sources.caixa import natureza_da_modalidade, parsear_csv, registro_de_linha

CSV = (
    "\n"
    " Lista de Imóveis da Caixa;;Data de geração:;20/10/2026;;;;;;;\n"
    " N° do imóvel;UF;Cidade;Bairro;Endereço;Preço;Valor de avaliação;Desconto;Financiamento;Descrição;Modalidade de venda;Link de acesso\n"
    "\n"
    " 8787701324906 ;ES ;CARIACICA ;VERA CRUZ ;RUA MONTE CASTELO, N. 140, Apto 502, TR A VG 01 ;168.383,74;275.000,00;38.77;Não;"
    "Apartamento, 84.78 de área total, 67.20 de área privativa, 0.00 de área do terreno,  2 qto(s), varanda, a.serv, WC, 1 sala(s), cozinha, 1 vaga(s) de garagem.;"
    "Licitação Aberta;https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=8787701324906\n"
    " 8444427665559 ;ES ;CARIACICA ;VALE DOS REIS ;RUA REI DARIO L, N. SN, LT 24 QD 20 ;52.308,74;90.356,08;42.11;Sim;"
    "Terreno, 0.00 de área total, 0.00 de área privativa, 334.75 de área do terreno.;Venda Direta Online;https://x/2\n"
    " 8555504719150 ;ES ;VILA VELHA ;PONTA DA FRUTA ;RUA DO ABACAXI, N. SN ;910.600,55;383.762,59;0.00;Não;"
    "Casa, 49.20 de área total, 49.20 de área privativa, 180.00 de área do terreno,  2 qto(s), WC, 1 sala(s), cozinha.;Leilão SFI - Edital Único;https://x/3\n"
).encode("latin-1")


def test_parse_cabecalho_e_data():
    linhas, data = parsear_csv(CSV)
    assert data == "2026-10-20"
    assert len(linhas) == 3
    assert linhas[0]["numero"] == "8787701324906"
    assert linhas[0]["cidade"] == "CARIACICA"


def test_registro_apartamento():
    linhas, _ = parsear_csv(CSV)
    r = registro_de_linha(linhas[0])
    assert r["id"] == "caixa-8787701324906"
    assert r["fonte"] == "caixa"
    assert r["tipo"] == "apartamento"
    assert r["cidade"] == "Cariacica"
    assert r["bairro"] == "Vera Cruz"
    assert r["valor_minimo"] == 168383.74
    assert r["valor_avaliacao"] == 275000.0
    assert r["area_privativa_m2"] == 67.2
    assert r["area_total_m2"] == 84.78
    assert r["area_terreno_m2"] is None  # 0.00 = desconhecido
    assert r["quartos"] == 2
    assert r["vagas"] == 1
    assert r["aceita_financiamento"] is False
    assert r["natureza"] == "licitação"
    assert r["modalidade"] == "Licitação Aberta"
    assert r["desconto_pct"] == 38.77
    assert r["valor_m2"] == round(168383.74 / 67.2, 2)
    assert r["url_anuncio"].endswith("hdnimovel=8787701324906")
    # campos que a Caixa (CSV) não fornece ficam null, nunca ausentes
    for c in ("url_edital", "url_matricula", "leiloeiro", "data_leilao", "ocupado", "aceita_fgts", "lat", "lng"):
        assert c in r and r[c] is None


def test_registro_terreno_usa_area_do_terreno_no_m2():
    linhas, _ = parsear_csv(CSV)
    r = registro_de_linha(linhas[1])
    assert r["tipo"] == "terreno"
    assert r["area_terreno_m2"] == 334.75
    assert r["area_privativa_m2"] is None
    assert r["valor_m2"] == round(52308.74 / 334.75, 2)
    assert r["aceita_financiamento"] is True
    assert r["natureza"] == "venda direta"


def test_leilao_sfi_desconto_negativo():
    linhas, _ = parsear_csv(CSV)
    r = registro_de_linha(linhas[2])
    assert r["natureza"] == "leilão extrajudicial"
    assert r["desconto_pct"] < 0  # lance mínimo acima da avaliação


def test_natureza():
    assert natureza_da_modalidade("Venda Online") == "venda direta"
    assert natureza_da_modalidade("1º Leilão SFI") == "leilão extrajudicial"
    assert natureza_da_modalidade("Licitação Aberta") == "licitação"
    assert natureza_da_modalidade(None) is None


def test_csv_sem_cabecalho_levanta_erro():
    import pytest
    with pytest.raises(ValueError):
        parsear_csv(b"a;b;c\n1;2;3\n")


def test_url_da_matricula_previsivel():
    from collector.sources.caixa import url_matricula_de
    assert url_matricula_de("10208367", "es") == "https://venda-imoveis.caixa.gov.br/editais/matricula/ES/0000010208367.pdf"
    assert url_matricula_de("8787701324906", "ES").endswith("/ES/8787701324906.pdf")
    assert url_matricula_de("abc", "ES") is None and url_matricula_de("1", None) is None
