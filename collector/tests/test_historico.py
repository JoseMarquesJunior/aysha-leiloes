import json

from collector import historico as h
from collector.schema import novo_registro


def _r(id_, **kw):
    base = dict(id=id_, fonte="caixa", valor_minimo=100.0, modalidade="Venda Direta Online", ativo=True)
    base.update(kw)
    return novo_registro(**base)


def test_comparar_gera_eventos():
    antes = {"a": _r("a"), "b": _r("b", valor_minimo=200.0), "c": _r("c"), "d": _r("d", data_leilao="2026-11-01")}
    depois = {"a": _r("a"), "b": _r("b", valor_minimo=150.0, modalidade="2º Leilão SFI"), "e": _r("e"),
              "d": _r("d", data_leilao="2026-11-15")}
    ev = h.comparar(antes, depois, "2026-10-21")
    tipos = sorted((e["id"], e["tipo"]) for e in ev)
    assert tipos == [("b", "mudou_modalidade"), ("b", "mudou_preco"), ("c", "removido"), ("d", "mudou_data_leilao"), ("e", "novo")]
    preco = next(e for e in ev if e["tipo"] == "mudou_preco")
    assert (preco["de"], preco["para"]) == (200.0, 150.0)
    assert all(e["data"] == "2026-10-21" for e in ev)


def test_removido_nao_repete_para_inativo():
    antes = {"c": _r("c", ativo=False)}
    assert h.comparar(antes, {}, "2026-10-21") == []


def test_fundir_mantem_primeira_vez_visto_e_inativa_removidos():
    antes = {"a": _r("a", primeira_vez_visto="2026-01-01", ultima_vez_visto="2026-10-20", lat=-20.1, lng=-40.2),
             "velho": _r("velho", primeira_vez_visto="2026-01-01", ultima_vez_visto="2026-05-01"),
             "recente": _r("recente", primeira_vez_visto="2026-09-01", ultima_vez_visto="2026-10-01")}
    depois = {"a": _r("a"), "n": _r("n")}
    base = h.fundir_com_anteriores(antes, depois, "2026-10-21", dias_retencao=90)
    assert base["a"]["primeira_vez_visto"] == "2026-01-01"
    assert base["a"]["ultima_vez_visto"] == "2026-10-21"
    assert base["a"]["lat"] == -20.1  # geocodificação preservada
    assert base["n"]["primeira_vez_visto"] == "2026-10-21"
    assert base["recente"]["ativo"] is False
    assert "velho" not in base  # inativo há mais de 90 dias é descartado


def test_snapshot_e_compactacao(tmp_path):
    regs = [_r("a", valor_minimo=100.0), _r("b", valor_minimo=50.0, ativo=False)]
    p = h.gravar_snapshot(tmp_path, "2026-01-10", regs)
    dados = json.loads(p.read_text(encoding="utf-8"))
    assert dados == [{"id": "a", "valor_minimo": 100.0, "modalidade": "Venda Direta Online", "data_leilao": None}]
    h.gravar_snapshot(tmp_path, "2026-01-11", [_r("a", valor_minimo=90.0)])
    h.gravar_snapshot(tmp_path, "2026-10-20", [_r("a", valor_minimo=80.0)])
    n = h.compactar_snapshots(tmp_path, "2026-10-21", dias=90)
    assert n == 2
    assert not (tmp_path / "2026-01-10.json").exists()
    assert (tmp_path / "2026-10-20.json").exists()
    mensal = json.loads((tmp_path / "mensal" / "2026-01.json").read_text(encoding="utf-8"))
    assert mensal["a"]["dias"] == 2
    assert (mensal["a"]["valor_min"], mensal["a"]["valor_max"]) == (90.0, 100.0)
    assert mensal["a"]["valor_ultimo"] == 90.0
    assert mensal["a"]["ultimo_dia"] == "2026-01-11"


def test_gravar_historico_descarta_eventos_velhos(tmp_path):
    caminho = tmp_path / "historico.json"
    antigo = {"eventos": [{"id": "x", "data": "2024-01-01", "tipo": "novo", "de": None, "para": 1}]}
    novos = [{"id": "y", "data": "2026-10-21", "tipo": "novo", "de": None, "para": 2}]
    res = h.gravar_historico(caminho, antigo, novos, "2026-10-21", dias_retencao_eventos=365)
    assert [e["id"] for e in res["eventos"]] == ["y"]
    assert json.loads(caminho.read_text(encoding="utf-8"))["eventos"] == res["eventos"]


def test_snapshot_delta_so_com_mudancas(tmp_path):
    anteriores = {"a": _r("a", valor_minimo=100.0), "b": _r("b", valor_minimo=50.0), "c": _r("c", valor_minimo=70.0)}
    atuais = [_r("a", valor_minimo=100.0), _r("b", valor_minimo=45.0), _r("c", valor_minimo=70.0, data_leilao="2026-11-01"), _r("d", valor_minimo=1.0)]
    p = h.gravar_snapshot(tmp_path, "2026-10-22", atuais, anteriores)
    ids = [x["id"] for x in json.loads(p.read_text(encoding="utf-8"))]
    assert ids == ["b", "c", "d"]  # 'a' não mudou e fica de fora
    p2 = h.gravar_snapshot(tmp_path, "2026-11-01", atuais, anteriores, completo=True)
    assert len(json.loads(p2.read_text(encoding="utf-8"))) == 4
