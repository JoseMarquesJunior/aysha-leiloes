import json
from pathlib import Path

from collector import paginas
from collector.schema import novo_registro


def _reg(i, uf="ES", cidade="Vila Velha", **k):
    return novo_registro(id=f"t-{i}", fonte="caixa", uf=uf, cidade=cidade, tipo="apartamento", valor_minimo=100000.0 + i,
                         valor_avaliacao=200000.0, desconto_pct=50.0 - i, area_privativa_m2=60.0, **k)


def test_slug():
    assert paginas.slug("Cachoeiro de Itapemirim") == "cachoeiro-de-itapemirim"
    assert paginas.slug("São José dos Campos") == "sao-jose-dos-campos"


def test_gera_paginas_sitemap_e_og(tmp_path: Path):
    docs = tmp_path / "docs"
    (docs / "data").mkdir(parents=True)
    regs = [_reg(i) for i in range(6)] + [_reg(10, cidade="Anchieta"), _reg(11, uf="SP", cidade="Santos"), _reg(12, uf="SP", cidade="Santos", ativo=False)]
    cfg = {"saida": {"url_site": "https://exemplo.test"}}
    res = paginas.gerar(docs, regs, cfg, "2026-10-23")
    assert res == {"ufs": 2, "cidades": 1, "urls": 3 + 1 + 2 + 1, "exemplo": False}  # home, sobre, exemplo, índice, 2 UFs, 1 cidade
    assert (docs / "leiloes" / "index.html").exists()
    assert (docs / "leiloes" / "ES" / "index.html").exists()
    assert (docs / "leiloes" / "ES" / "vila-velha.html").exists()       # 6 imóveis: ganha página
    assert not (docs / "leiloes" / "ES" / "anchieta.html").exists()      # 1 imóvel: só na lista da UF
    uf_html = (docs / "leiloes" / "ES" / "index.html").read_text(encoding="utf-8")
    assert "Anchieta" in uf_html and "?uf=ES&amp;cidade=Anchieta" in uf_html
    assert 'rel="canonical" href="https://exemplo.test/leiloes/ES/"' in uf_html
    assert "<script" not in uf_html.split("<main")[1].split("</main>")[0]  # conteúdo sem JS
    og = json.loads((docs / "data" / "og_SP.json").read_text(encoding="utf-8"))
    assert "t-11" in og and "t-12" not in og and og["t-11"]["c"] == "Santos"
    sitemap = (docs / "sitemap.xml").read_text(encoding="utf-8")
    assert "https://exemplo.test/leiloes/ES/vila-velha.html" in sitemap and "<lastmod>2026-10-23</lastmod>" in sitemap
    # segunda geração com a cidade abaixo do mínimo: a página antiga some
    res2 = paginas.gerar(docs, regs[:3] + regs[6:], cfg, "2026-10-24")
    assert res2["cidades"] == 0 and not (docs / "leiloes" / "ES" / "vila-velha.html").exists()


def test_markdown_para_html_basico():
    from collector.paginas import markdown_para_html
    h = markdown_para_html("## Resumo\nTexto **forte** e [link](https://x.y/z).\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- um\n- dois\n")
    assert "<h4>Resumo</h4>" in h and "<b>forte</b>" in h and 'href="https://x.y/z"' in h
    assert "<table><thead><tr><th>a</th><th>b</th>" in h and "<ul>\n<li>um</li>\n<li>dois</li>\n</ul>" in h


def test_tabela_estatica_ignora_encerrados_e_sem_desconto():
    from collector.paginas import _para_tabela
    hoje = "2026-10-25"
    lista = [{"id": "a", "desconto_pct": 30.0, "data_leilao": "2026-12-01"}, {"id": "b", "desconto_pct": -5.0, "data_leilao": "2026-12-01"},
             {"id": "c", "desconto_pct": 40.0, "data_leilao": "2025-11-11"}] + [{"id": f"d{i}", "desconto_pct": 10.0 + i} for i in range(5)]
    ids = [r["id"] for r in _para_tabela(lista, hoje)]
    assert "a" in ids and "b" not in ids and "c" not in ids and len(ids) == 6
