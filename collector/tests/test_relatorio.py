"""Partes determinísticas do relatório com IA (sem chamar a API)."""

from collector import relatorio
from collector.schema import novo_registro


def test_mensagem_inclui_anuncio_e_documentos_cortados():
    r = novo_registro(id="hd-1", fonte="leiloeiro-hd", cidade="Vitória", uf="ES", valor_minimo=376500.0, valor_avaliacao=753000.0,
                      numero_processo="0000445-97.1996.4.02.5001", descricao_original="Apartamento 102, Bloco IV")
    m = relatorio.montar_mensagem(r, ["EDITAL " + "x" * 70000, "MATRÍCULA 263"])
    assert "- valor_minimo: 376500.0" in m and "0000445-97.1996.4.02.5001" in m
    assert "### Documento 1" in m and "### Documento 2" in m and "MATRÍCULA 263" in m
    assert "[... documento cortado por tamanho ...]" in m
    assert len(m) < relatorio.MAX_CHARS_DOCUMENTO + 5000
    assert "(nenhum documento legível)" in relatorio.montar_mensagem(r, [])


def test_custo_opus_5():
    # 25 mil tokens de entrada, 3 mil de saída, 4 buscas
    assert relatorio.custo_usd("claude-opus-5", 25_000, 3_000, 4) == round(25_000 * 5 / 1e6 + 3_000 * 25 / 1e6 + 0.04, 4)


def test_anonimizar_preserva_links_e_entidades():
    md = ("**Terceiro interessado:** Gilceia Oliveira Paes, adquirente.\n"
          "Exequente: Caixa Econômica Federal. Cartório do 3º Ofício. Rua Oscar Rodrigues de Oliveira, 657.\n"
          "- [Lote 7 – hd Leilões](https://www.hdleiloes.com.br/leilao/index/leilao_id/101221/lote/224061)")
    out = relatorio.anonimizar(md)
    assert "Gilceia" not in out and "[nome]" in out
    assert "Caixa Econômica Federal" in out and "Rua Oscar Rodrigues de Oliveira" in out
    assert "https://www.hdleiloes.com.br/leilao/index/leilao_id/101221/lote/224061" in out


def test_nome_arquivo_seguro():
    assert relatorio._nome_arquivo("jfes-0000445-97.1996.4.02.5001-01") == "jfes-0000445-97.1996.4.02.5001-01"
    assert relatorio._nome_arquivo("x/../y") == "x_.._y"


def test_recorta_edital_unificado_ao_processo():
    texto = ("CABEÇALHO geral da vara\n"
             "01 - PROCESSO N.º 0001-11.2020.4.02.5001\nBEM: carro\nAVALIAÇÃO: R$ 1\n"
             "02 - PROCESSO N.º 0002-22.2020.4.02.5001\nBEM: apartamento 102\nAVALIAÇÃO: R$ 2\n"
             "03 - PROCESSO N.º 0003-33.2020.4.02.5001\nBEM: terreno\nAVALIAÇÃO: R$ 3\n"
             "LOCAL, DATAS E HORÁRIO: 1º LEILÃO dia 10 de novembro\ncomissão de 10%")
    rec = relatorio.recortar_documento(texto, "0002-22.2020.4.02.5001")
    assert "CABEÇALHO" in rec and "apartamento 102" in rec and "comissão de 10%" in rec
    assert "carro" not in rec and "terreno" not in rec
    assert relatorio.recortar_documento(texto, None) == texto
    assert relatorio.recortar_documento("sem blocos 0002-22.2020.4.02.5001", "0002-22.2020.4.02.5001").startswith("sem blocos")


def test_remover_nomes_preserva_entidades():
    from collector.ia import remover_nomes
    assert remover_nomes("Exequente: Condomínio Conj. Res. Mata da Praia III") == "Exequente: Condomínio Conj. Res. Mata da Praia III"
    assert remover_nomes("Exequente: União – Procuradoria da Fazenda Nacional") == "Exequente: União – Procuradoria da Fazenda Nacional"
    assert remover_nomes("Executado: Carlos Alberto Souza") == "Executado: [nome]"


def test_limpar_campos_valida_faixas_tipos_e_nomes():
    from collector.relatorio import limpar_campos
    bruto = {"tipo": "Apartamentos", "area_privativa_m2": 72.456, "area_terreno_m2": 2, "quartos": 3.0, "vagas": True,
             "endereco": "Rua  das Flores, 10, apto 301", "bairro": "Mata da Praia", "cidade": "Vitória", "uf": "es",
             "matricula": "12345", "numero_processo": None, "ocupado": False, "aceita_fgts": "sim",
             "debitos_iptu_por_conta_de": "comprador", "debitos_condominio_por_conta_de": "ninguém",
             "comissao_leiloeiro_pct": 5, "valor_avaliacao": 350000, "data_leilao": "2026-11-05", "data_segunda_praca": "05/11/2026",
             "comitente": "Caixa Econômica Federal"}
    c = limpar_campos(bruto)
    assert c["tipo"] == "apartamento" and c["area_privativa_m2"] == 72.46 and "area_terreno_m2" not in c
    assert c["quartos"] == 3 and "vagas" not in c and c["endereco"] == "Rua das Flores, 10, apto 301"
    assert c["uf"] == "ES" and c["ocupado"] is False and "aceita_fgts" not in c
    assert c["debitos_iptu_por_conta_de"] == "comprador" and "debitos_condominio_por_conta_de" not in c
    assert c["data_leilao"] == "2026-11-05" and "data_segunda_praca" not in c and c["comitente"] == "Caixa Econômica Federal"


def test_aplicar_campos_so_preenche_vazios_e_reinicia_geo_de_baixa_precisao():
    from collector.relatorio import aplicar_campos
    from collector.schema import novo_registro
    r = novo_registro(id="x-1", fonte="hdleiloes", tipo="apartamento", cidade="Vitória", uf="ES", valor_minimo=200000.0,
                      lat=-20.3, lng=-40.3, geo_precisao="cidade")
    preenchidos = aplicar_campos(r, {"area_privativa_m2": 80.0, "bairro": "Mata da Praia", "cidade": "Vila Velha", "quartos": 2})
    assert set(preenchidos) == {"area_privativa_m2", "bairro", "quartos"}
    assert r["cidade"] == "Vitória"            # não sobrescreve
    assert r["valor_m2"] == 2500.0             # derivado recalculado
    assert r["lat"] is None and r["geo_precisao"] is None  # vai geocodificar de novo com o bairro
    r2 = novo_registro(id="x-2", fonte="caixa", lat=-20.3, lng=-40.3, geo_precisao="endereco")
    aplicar_campos(r2, {"bairro": "Centro"})
    assert r2["geo_precisao"] == "endereco"    # precisão de endereço não é descartada


def test_documento_digitalizado_vai_como_pdf_e_texto_como_texto():
    from collector.relatorio import _doc, montar_conteudo
    r = {"id": "x", "numero_processo": None}
    escaneado = _doc(texto="Cartório\n" * 10, pdf=b"%PDF-1.4 fake", paginas=6, url="u1")
    textual = _doc(texto="MATRÍCULA " * 2000, pdf=b"%PDF-1.4 fake", paginas=3, url="u2")
    assert escaneado["escaneado"] and not textual["escaneado"]
    blocos = montar_conteudo(r, [escaneado, textual])
    tipos = [b["type"] for b in blocos]
    assert tipos == ["text", "text", "document", "text", "text"]
    assert blocos[2]["source"]["media_type"] == "application/pdf"
    assert blocos[-1].get("cache_control") == {"type": "ephemeral"}


def test_anonimizar_preserva_nomes_protegidos():
    from collector.relatorio import anonimizar
    # bairro com cara de nome de pessoa: sem proteção cai no filtro, com proteção fica
    linha = "- **Liquidez baixa**: comercial de 850 m² em Rosa Santos tem público comprador restrito."
    assert "[nome]" in anonimizar(linha)
    assert anonimizar(linha, protegidos=["Rosa Santos"]) == linha
