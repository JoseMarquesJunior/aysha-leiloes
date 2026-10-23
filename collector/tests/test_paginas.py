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
    assert res == {"ufs": 2, "cidades": 1, "urls": 3 + 2 + 1}
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
