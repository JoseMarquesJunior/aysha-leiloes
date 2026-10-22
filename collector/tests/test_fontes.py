"""Parsers das fontes HTML/PDF, sobre amostras reais salvas em fixtures/ (coletadas em 2026-10-21)."""

from pathlib import Path

from collector.sources import banestes, colodete, jfes, suporteleiloes, vixleiloes

FIX = Path(__file__).parent / "fixtures"


def _ler(nome: str) -> str:
    return (FIX / nome).read_text(encoding="utf-8")


SITE = {"slug": "emleilao", "url": "https://www.emleilao.com.br", "leiloeiro": "Ayrton de Souza Porto Filho"}


def test_suporteleiloes_cards_do_buscador():
    html = _ler("emleilao_buscador_mg.html")
    cards = suporteleiloes.cards_do_buscador(html)
    assert len(cards) == 12
    assert suporteleiloes.total_itens(html) == 23
    c = cards[0]
    assert c["url"].endswith("/lote/11531/lote")
    assert c["titulo"] == "Apartamento"
    assert c["cidade_uf"] == "BELO HORIZONTE - MG"
    assert c["valor_1a_praca"] == 167613.66
    assert c["status"] == "Aberto para Lances"
    assert c["desconto_pct_fonte"] == 36


def test_suporteleiloes_lote():
    html = _ler("emleilao_lote.html")
    card = {"cidade_uf": "ITAITINGA - CE", "titulo": "Casa"}
    r = suporteleiloes.parsear_lote(html, "https://www.emleilao.com.br/eventos/leilao/x/lote/11435/lote", SITE, card)
    assert r["id"] == "emleilao-11435"
    assert r["fonte"] == "leiloeiro-emleilao"
    assert r["uf"] == "CE" and r["cidade"] == "Itaitinga"
    assert r["tipo"] == "casa"
    assert r["valor_minimo"] == 135540.01
    assert r["valor_avaliacao"] == 215340
    assert r["desconto_pct"] == 37.06
    assert r["area_privativa_m2"] == 89.08
    assert r["quartos"] == 3
    assert r["data_leilao"] == "2026-10-26"
    assert r["matricula"] == "14739"
    assert r["comitente"] == "CAIXA ECONOMICA FEDERAL"
    assert r["natureza"] == "leilão extrajudicial"
    assert r["url_edital"].endswith(".pdf") and "/leiloes/93/documentos/" in r["url_edital"]
    assert r["url_matricula"].endswith(".pdf") and "/bens/" in r["url_matricula"]
    assert r["aceita_parcelamento"] is False
    assert r["endereco"].startswith("RUA  A  SDO, N. 69")


def test_suporteleiloes_lote_sem_card_usa_descricao():
    r = suporteleiloes.parsear_lote(_ler("emleilao_lote.html"), "https://x/lote/1/lote", SITE)
    assert r["uf"] == "CE" and r["cidade"] == "Itaitinga"


def test_vix_lote():
    r = vixleiloes.parsear_lote(_ler("vix_lote.html"), "https://www.vixleiloes.com.br/lote/18257-x", "https://e.pdf")
    assert r["id"] == "vix-18257"
    assert r["uf"] == "ES" and r["cidade"] == "Serra" and r["bairro"] == "Jardim Limoeiro"
    assert r["tipo"] == "apartamento"
    assert r["valor_minimo"] == 751740.0 and r["valor_avaliacao"] == 751740.0
    assert r["data_leilao"] == "2026-11-04"
    assert r["comitente"] == "TJES"
    assert r["natureza"] == "leilão judicial"
    assert r["matricula"] == "53270"
    assert r["quartos"] == 2
    assert r["url_edital"] == "https://e.pdf"
    assert r["url_foto"].startswith("https://static.suporteleiloes.com.br/")


def test_colodete_leilao_e_lote():
    html = _ler("colodete_lotes.html")
    cab = colodete.cabecalho_leilao(html)
    assert cab["data1"] == "2026-11-18" and cab["data2"] == "2026-11-19"
    assert cab["comitente"] == "SICOOB CREDIROCHAS"
    assert cab["judicial"] is False
    cards = colodete.cards_de_lotes(html)
    assert len(cards) == 1
    c = cards[0]
    assert c["item_id"] == "14162" and c["uf"] == "RJ" and c["cidade"] == "Nova Friburgo"
    assert c["lance"] == 10146000.0 and c["lance2"] == 11897418.22
    det = colodete.parsear_detalhe(_ler("colodete_item.html"))
    assert det["comissao"] == 5.0 and det["avaliacao"] == 10146000.0
    assert det["url_matricula"].endswith(".pdf")
    r = colodete.registro(c, cab, det)
    assert r["id"] == "colodete-14162"
    assert r["matricula"] == "8498"
    assert r["comissao_leiloeiro_pct"] == 5.0
    assert r["data_segunda_praca"] == "2026-11-19"
    assert r["tipo"] == "casa"
    assert "Lance 2º leilão" in r["descricao_original"]


def test_banestes_editais():
    ed = banestes.parsear_editais(_ler("banestes_leilao.html"))
    assert len(ed) >= 15
    assert ed[0]["titulo"].startswith("Edital de 1º e 2º Leilões")
    assert ed[0]["publicado_em"] == "2026-09-04"
    assert (ed[0]["data_leilao"], ed[0]["data_segunda_praca"]) == ("2026-09-22", "2026-09-23")
    assert ed[0]["url"].startswith("https://www.banestes.com.br/") and ed[0]["url"].endswith(".pdf")
    assert all(e["imovel"] for e in ed)
    e010 = next(e for e in ed if "010/2026" in e["titulo"])
    assert e010["url"].endswith("leilao-imovel-010-2026.pdf")


def test_jfes_edital():
    texto = _ler("jfes_edital_4vfc.txt")
    geral = jfes.dados_gerais(texto)
    assert geral["data1"] == "2026-11-10"
    assert geral["comissao"] == 10.0
    assert geral["leiloeiro"] == "Hidirlene Duszeiko"
    assert geral["site_leiloeiro"] == "https://www.hdleiloes.com.br"
    blocos = jfes.blocos_de_bens(texto)
    assert len(blocos) == 8
    assert blocos[1]["processo"] == "5007957-74.2018.4.02.5001"
    assert blocos[1]["avaliacao"] == 353000.0
    regs = jfes.registros_do_edital(texto, "https://x.pdf")
    assert [r["id"][-2:] for r in regs] == ["02", "03", "05", "06"]  # veículos e aspiradores descartados
    r = regs[0]
    assert r["tipo"] == "terreno" and r["cidade"] == "Vila Velha" and r["uf"] == "ES"
    assert r["natureza"] == "leilão judicial"
    assert r["numero_processo"] == "5007957-74.2018.4.02.5001"
    assert r["comissao_leiloeiro_pct"] == 10.0
    assert "Ônus:" in r["descricao_original"]
    # nenhum nome de parte entra no registro
    assert "EXECUTADO" not in r["descricao_original"] and "EXEQUENTE" not in r["descricao_original"]


def test_bandes_venda_direta():
    from collector.sources import bandes
    texto = _ler("bandes_vila_velha.txt").split("\n", 1)[1]
    regs = bandes.registros_do_texto(texto, "https://x.pdf")
    assert len(regs) == 1
    r = regs[0]
    assert r["id"] == "bandes-62"
    assert r["cidade"] == "Vila Velha" and r["uf"] == "ES"
    assert r["valor_minimo"] == 64546.0
    assert r["ocupado"] is True
    assert r["tipo"] == "terreno"
    assert r["matricula"] == "8162"
    assert r["endereco"].startswith("Lotes 27 e 28, Rua Atílio Vivacqua")
    assert r["lat"] is not None and -20.5 < r["lat"] < -20.4
    assert r["natureza"] == "venda direta"
    assert "Confronta" not in r["descricao_original"]  # confrontações citam vizinhos: não entram


def test_suporteleiloes_endereco_sem_bairro_e_filtro_imovel():
    r = suporteleiloes.parsear_lote(_ler("emleilao_lote.html"), "https://x/lote/11435/lote", SITE, {"cidade_uf": "ITAITINGA - CE", "titulo": "Casa"})
    assert r["endereco"] == "RUA  A  SDO, N. 69, TR 28 LT 27 QD B"
    assert r["bairro"] == "Ancuri"
    assert suporteleiloes.eh_imovel("Apartamento", "Apartamento - Área privativa: 45 m²")
    assert not suporteleiloes.eh_imovel("Veículo", "Sucata FIAT DOBLO 2009")
    assert not suporteleiloes.eh_imovel("Lote 3", "Bens diversos: cadeiras e mesas")


def test_dedupe_aceita_sufixo_de_bairro_no_endereco():
    from collector.dedupe import sao_duplicatas
    a = {"fonte": "caixa", "id": "c", "endereco": "RUA MONTE CASTELO, N. 140, Apto 502, TR A VG 01", "cidade": "Cariacica", "uf": "ES", "tipo": "apartamento", "area_privativa_m2": 67.2}
    b = {"fonte": "leiloeiro-emleilao", "id": "e", "endereco": "RUA MONTE CASTELO, N. 140, Apto. 502, TR A VG 01, VERA CRUZ", "cidade": "Cariacica", "uf": "ES", "tipo": "apartamento", "area_privativa_m2": 67.2}
    assert sao_duplicatas(a, b)
    c = dict(b, endereco="RUA MONTE CASTELO, N. 14")  # prefixo curto demais
    assert not sao_duplicatas(a, c)


def test_hdleiloes_lote():
    import json
    from collector.sources import hdleiloes
    lotes = json.loads(_ler("hd_lotes.json"))["items"]
    leiloes = hdleiloes.indexar_leiloes(json.loads(_ler("hd_leiloes.json"))["items"])
    com_anexo = next(it for it in lotes if it.get("anexos"))
    r = hdleiloes.registro_de_lote(com_anexo, leiloes.get(com_anexo["leilao_id"]))
    assert r["id"] == f"hd-{com_anexo['lote_id']}"
    assert r["fonte"] == "leiloeiro-hd"
    assert r["uf"] == "ES" and r["cidade"]
    assert r["url_anuncio"] == f"https://www.hdleiloes.com.br/leilao/index/leilao_id/{com_anexo['leilao_id']}/lote/{com_anexo['lote_id']}"
    assert r["url_matricula"] and r["url_matricula"].endswith(".pdf")
    assert r["valor_minimo"] and r["valor_minimo"] > 0
    assert r["data_leilao"] and len(r["data_leilao"]) == 10
    assert "<" not in (r["descricao_original"] or "")  # HTML removido
    assert r["leiloeiro"].startswith("Hidirlene")
    assert r["natureza"] in ("leilão judicial", "leilão extrajudicial", "venda direta")
    judicial = next(it for it in lotes if "JUSTIÇA" in (it.get("nm_titulo_leilao") or ""))
    rj = hdleiloes.registro_de_lote(judicial, leiloes.get(judicial["leilao_id"]))
    assert rj["natureza"] == "leilão judicial"
    # 1º leilão judicial = 100 % da avaliação; o lance mínimo atual pode já ser o do 2º leilão
    assert rj["valor_avaliacao"] == hdleiloes._valor(judicial["vl_lanceinicial"])
    assert rj["valor_minimo"] == hdleiloes._valor(judicial["vl_lanceminimo"])
    if rj["valor_minimo"] < rj["valor_avaliacao"]:
        assert rj["modalidade"].startswith("2º leilão") and rj["desconto_pct"] > 0
    assert rj["numero_processo"] and "." in rj["numero_processo"]
    if judicial.get("vl_lanceinicialsegundoleilao"):
        assert rj["data_segunda_praca"] and "Lance inicial 2º leilão" in rj["descricao_original"]


def test_geocodificador_ordem_de_tentativas(monkeypatch):
    """Sem rede: registra as consultas feitas e simula respostas, para conferir a ordem das tentativas."""
    from collector import geocode
    feitas = []

    class Cliente:
        def get(self, url, params=None, intervalo=None, api=False):
            q = params["q"]; feitas.append(q)
            class R:
                def json(self_inner):
                    if q.lower().startswith("mata da praia,"):
                        return [{"lat": "-20.27", "lon": "-40.29", "addresstype": "suburb", "display_name": "Mata da Praia, Vitória, ES, Brasil"}]
                    if q.startswith("Rua Tupinambás"):
                        return [{"lat": "-20.85", "lon": "-41.11", "addresstype": "residential", "display_name": "Rua Tupinambás, Aquidaban, Cachoeiro de Itapemirim"}]
                    if q.startswith("Bairro Inexistente,"):
                        return []
                    return [{"lat": "-20.32", "lon": "-40.34", "addresstype": "city", "display_name": "Vitória, ES, Brasil"}]
            return R()

    g = geocode.Geocodificador(Cliente(), "u", str(__import__("pathlib").Path(__import__("tempfile").mkdtemp()) / "geo.json"),
                               intervalo=0, maximo=100, precisao_maxima_por_uf={"RJ": "bairro"})
    # candidato de bairro tirado do fim da descrição (leiloeiro sem campo de bairro)
    r = {"uf": "ES", "cidade": "Vitória", "bairro": None, "endereco": None, "descricao_original": "APTO 402 ED. PORTO RICO MATA DA PRAIA - VITÓRIA/ES"}
    g.geocodificar(r)
    assert r["geo_precisao"] == "bairro" and r["bairro"] == "Mata da Praia" and r["lat"] == -20.27
    # estado grande: bairro inexistente no OSM -> tenta o endereço antes de cair na cidade
    r2 = {"uf": "RJ", "cidade": "Cachoeiro de Itapemirim", "bairro": "Bairro Inexistente", "endereco": "Rua Tupinambás, 120", "descricao_original": ""}
    g.geocodificar(r2)
    assert r2["geo_precisao"] == "endereco" and r2["lat"] == -20.85
    assert [q.split(",")[0] for q in feitas] == ["MATA DA PRAIA", "Bairro Inexistente", "Rua Tupinambás"]
