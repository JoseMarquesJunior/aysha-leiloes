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
