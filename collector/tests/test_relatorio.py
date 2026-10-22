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
