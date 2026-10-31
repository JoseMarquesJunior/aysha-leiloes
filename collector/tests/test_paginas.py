import re
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
    # urls: home, sobre, exemplo, estatísticas, índice, 2 UFs, 1 cidade, 2 "outras cidades" (Anchieta; Santos); fichas: os 8 ativos
    assert res == {"ufs": 2, "cidades": 1, "urls": 4 + 1 + 2 + 1 + 2, "fichas": 8, "fichas_sitemap": 8, "exemplo": False}
    assert (docs / "leiloes" / "index.html").exists()
    assert (docs / "leiloes" / "ES" / "index.html").exists()
    assert (docs / "leiloes" / "ES" / "vila-velha.html").exists()       # 6 imóveis: ganha página
    assert not (docs / "leiloes" / "ES" / "anchieta.html").exists()      # 1 imóvel: só na lista da UF
    uf_html = (docs / "leiloes" / "ES" / "index.html").read_text(encoding="utf-8")
    assert "Anchieta" in uf_html and "?uf=ES&amp;cidade=Anchieta" in uf_html
    assert 'rel="canonical" href="https://exemplo.test/leiloes/ES/"' in uf_html
    assert '"@type": "BreadcrumbList"' in uf_html and '"@type": "ItemList"' in uf_html  # JSON-LD no <head>
    assert "<script" not in uf_html.split("<main")[1].split("</main>")[0]  # conteúdo sem JS
    og = json.loads((docs / "data" / "og_SP.json").read_text(encoding="utf-8"))
    assert "t-11" in og and "t-12" not in og and og["t-11"]["c"] == "Santos" and og["t-11"]["va"] == 200000.0
    assert og["t-11"]["s"] == "caixa"   # fonte para o title/description da ficha (Worker)
    sitemap = (docs / "sitemap.xml").read_text(encoding="utf-8")
    assert "https://exemplo.test/leiloes/ES/vila-velha.html" in sitemap and "<lastmod>2026-10-23</lastmod>" in sitemap
    assert "https://exemplo.test/estatisticas.html" in sitemap
    fichas = (docs / "sitemap-imoveis.xml").read_text(encoding="utf-8")
    assert "https://exemplo.test/imovel.html?id=t-11&amp;uf=SP" in fichas and "id=t-12" not in fichas
    estat = (docs / "estatisticas.html").read_text(encoding="utf-8")
    assert "Estatísticas de leilões de imóveis no Brasil" in estat and '"@type": "Dataset"' in estat
    assert 'href="leiloes/ES/"' in estat and "Os 20 maiores descontos do país" in estat
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


def _gera(tmp_path, regs, hoje="2026-10-30", historico=None):
    docs = tmp_path / "docs"
    (docs / "data").mkdir(parents=True, exist_ok=True)
    if historico is not None:
        (docs / "data" / "historico.json").write_text(json.dumps({"eventos": historico}), encoding="utf-8")
    res = paginas.gerar(docs, regs, {"saida": {"url_site": "https://exemplo.test"}}, hoje)
    return docs, res


def test_h1_e_logo_na_listagem(tmp_path: Path):
    docs, _ = _gera(tmp_path, [_reg(i) for i in range(6)])
    for nome in ("ES/index.html", "ES/vila-velha.html", "index.html"):
        h = (docs / "leiloes" / nome).read_text(encoding="utf-8")
        assert h.count("<h1>") == 1 and '<div class="marca">' in h
    cidade = (docs / "leiloes" / "ES" / "vila-velha.html").read_text(encoding="utf-8")
    assert "<h1>Imóveis em leilão em Vila Velha, ES</h1>" in cidade
    assert "<title>Imóveis em leilão em Vila Velha, ES — Aysha Leilões</title>" in cidade
    assert "<h1>" in (docs / "estatisticas.html").read_text(encoding="utf-8")


def test_descricao_curta_com_leilao():
    regs = [_reg(i) for i in range(40)]
    d = paginas._descricao("Mato Grosso do Sul", regs)
    assert len(d) <= 158 and "em leilão" in d and "R$" in d


def test_cidade_paginada_cobre_todas_as_fichas_abertas(tmp_path: Path):
    n = paginas.POR_PAGINA * 2 + 7
    regs = [_reg(i) for i in range(n)]
    docs, _ = _gera(tmp_path, regs)
    pasta = docs / "leiloes" / "ES"
    assert (pasta / "vila-velha.html").exists() and (pasta / "vila-velha-p2.html").exists() and (pasta / "vila-velha-p3.html").exists()
    assert not (pasta / "vila-velha-p4.html").exists()
    ligados = set()
    for arq in pasta.glob("vila-velha*.html"):
        ligados |= set(re.findall(r"imovel\.html\?id=(t-\d+)&amp;uf=ES", arq.read_text(encoding="utf-8")))
    assert ligados == {f"t-{i}" for i in range(n)}   # nenhuma ficha órfã
    p2 = (pasta / "vila-velha-p2.html").read_text(encoding="utf-8")
    assert "<h1>Imóveis em leilão em Vila Velha, ES — página 2</h1>" in p2
    assert 'rel="canonical" href="https://exemplo.test/leiloes/ES/vila-velha-p2.html"' in p2
    assert 'href="vila-velha-p3.html"' in p2
    sitemap = (docs / "sitemap.xml").read_text(encoding="utf-8")
    assert "leiloes/ES/vila-velha-p3.html" in sitemap
    uf = (pasta / "index.html").read_text(encoding="utf-8")
    assert uf.split("<main")[1].split("</main>")[0].count("imovel.html?id=") == paginas.POR_PAGINA   # a UF mostra só os maiores descontos e aponta para as cidades


def test_cidades_pequenas_vao_para_outras_cidades(tmp_path: Path):
    regs = [_reg(i) for i in range(6)] + [_reg(20, cidade="Anchieta"), _reg(21, cidade="Guarapari"), _reg(22, cidade=None)]
    docs, _ = _gera(tmp_path, regs)
    outras = (docs / "leiloes" / "ES" / "outras-cidades.html").read_text(encoding="utf-8")
    for i in (20, 21, 22):
        assert f"id=t-{i}&amp;uf=ES" in outras
    assert "outras-cidades.html" in (docs / "leiloes" / "ES" / "index.html").read_text(encoding="utf-8")


def test_sitemap_de_fichas_sem_encerradas_e_lastmod_honesto(tmp_path: Path):
    regs = [_reg(1, primeira_vez_visto="2026-10-21"), _reg(2, primeira_vez_visto="2026-10-21"),
            _reg(3, data_leilao="2026-01-01", primeira_vez_visto="2026-10-21"), _reg(4)]
    hist = [{"id": "t-2", "data": "2026-10-28", "tipo": "mudou_preco", "de": 1, "para": 2},
            {"id": "t-2", "data": "2026-10-29", "tipo": "removido", "de": 1, "para": None}]
    docs, res = _gera(tmp_path, regs, hoje="2026-10-30", historico=hist)
    fichas = (docs / "sitemap-imoveis.xml").read_text(encoding="utf-8")
    assert "id=t-3" not in fichas and res["fichas"] == 4 and res["fichas_sitemap"] == 3   # t-3 encerrada
    assert "<loc>https://exemplo.test/imovel.html?id=t-1&amp;uf=ES</loc><lastmod>2026-10-21</lastmod>" in fichas   # não é a data da coleta
    assert "id=t-2&amp;uf=ES</loc><lastmod>2026-10-28</lastmod>" in fichas   # evento de preço; "removido" não conta
    assert "id=t-4&amp;uf=ES</loc></url>" in fichas   # sem nenhuma data conhecida: omite o lastmod
    assert "2026-10-30" not in fichas
