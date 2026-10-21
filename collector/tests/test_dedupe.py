from collector.dedupe import deduplicar, normalizar_endereco, sao_duplicatas
from collector.schema import novo_registro

PRIORIDADES = {"caixa": 0, "banestes": 0, "leiloeiro": 2}


def _r(**kw):
    base = dict(fonte="caixa", uf="ES", cidade="Vitória", tipo="apartamento", area_privativa_m2=60.0)
    base.update(kw)
    return novo_registro(**base)


def test_normalizar_endereco():
    assert normalizar_endereco("R. Monte Castelo, N. 140, Apto 502") == "rua monte castelo 140 apto 502"
    assert normalizar_endereco("AV. ARISTÓTELES MENICUCCI, nº 76") == "avenida aristoteles menicucci 76"
    assert normalizar_endereco("Rua Rei Dario L, N. SN, LT 24 QD 20") == "rua rei dario l lote 24 quadra 20"
    assert normalizar_endereco(None) == ""


def test_duplicata_por_endereco_e_area_dentro_de_2pct():
    a = _r(id="caixa-1", endereco="Rua Monte Castelo, 140, apto 502", area_privativa_m2=67.2)
    b = _r(id="leiloeiro-x-9", fonte="leiloeiro-x", endereco="R. MONTE CASTELO N. 140 APTO 502", area_privativa_m2=68.0)
    c = _r(id="leiloeiro-x-10", fonte="leiloeiro-x", endereco="R. MONTE CASTELO N. 140 APTO 502", area_privativa_m2=80.0)
    assert sao_duplicatas(a, b)
    assert not sao_duplicatas(a, c)  # área 19% diferente


def test_duplicata_por_matricula():
    a = _r(id="caixa-1", endereco="Rua A, 1", matricula="12345")
    b = _r(id="banestes-7", fonte="banestes", endereco="Rua A nº 1 (frente)", matricula="12345", area_privativa_m2=None)
    assert sao_duplicatas(a, b)


def test_cidades_diferentes_nao_sao_duplicatas():
    a = _r(id="caixa-1", endereco="Rua A, 1")
    b = _r(id="caixa-2", endereco="Rua A, 1", cidade="Vila Velha")
    assert not sao_duplicatas(a, b)


def test_terreno_compara_area_do_terreno():
    a = _r(id="caixa-1", tipo="terreno", endereco="Rua B, lote 3", area_privativa_m2=None, area_terreno_m2=300.0)
    b = _r(id="leiloeiro-z-5", fonte="leiloeiro-z", tipo="terreno", endereco="Rua B lt 3", area_privativa_m2=None, area_terreno_m2=304.0)
    assert sao_duplicatas(a, b)


def test_deduplicar_prefere_fonte_oficial_e_lista_outras():
    leil = _r(id="leiloeiro-x-9", fonte="leiloeiro-x", endereco="Rua A, 1", url_anuncio="https://l/9", quartos=2,
              leiloeiro="Fulano Leilões")
    caixa = _r(id="caixa-1", endereco="Rua A, 1", url_anuncio="https://c/1")
    outro = _r(id="caixa-2", endereco="Rua C, 3", url_anuncio="https://c/2")
    saida = deduplicar([leil, caixa, outro], PRIORIDADES)
    assert sorted(r["id"] for r in saida) == ["caixa-1", "caixa-2"]
    principal = next(r for r in saida if r["id"] == "caixa-1")
    assert principal["outras_fontes"] == [{"fonte": "leiloeiro-x", "id": "leiloeiro-x-9", "url_anuncio": "https://l/9",
                                           "valor_minimo": None, "modalidade": None, "leiloeiro": "Fulano Leilões"}]
    # campo que só a secundária tinha completa o principal
    assert principal["quartos"] == 2
    assert next(r for r in saida if r["id"] == "caixa-2")["outras_fontes"] == []


def test_deduplicar_sem_duplicatas_mantem_tudo():
    regs = [_r(id=f"caixa-{i}", endereco=f"Rua {i}, {i}") for i in range(5)]
    assert len(deduplicar(regs, PRIORIDADES)) == 5
