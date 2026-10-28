"""Páginas estáticas por UF e por cidade (para buscadores), sitemap.xml, sitemap-imoveis.xml (fichas),
a página de estatísticas (docs/estatisticas.html) e mapas compactos para a pré-visualização de links
(Open Graph) e o resumo sem JavaScript da ficha do imóvel (lidos pelo Worker do site).

Geradas no fim de cada coleta em docs/leiloes/<UF>/index.html e docs/leiloes/<UF>/<cidade>.html. Cada página
tem título e descrição próprios ("Imóveis em leilão em Vila Velha, ES"), uma tabela com os melhores
descontos, dados estruturados (JSON-LD: BreadcrumbList + ItemList) e links para a tabela filtrada do site e
para as fichas. Não têm JavaScript além da contagem de visitas e do redirecionamento do endereço antigo.
"""

from __future__ import annotations

import html
import json
import re
import urllib.parse
from datetime import date, timedelta
from pathlib import Path

from .schema import sem_acentos

UFS = {
    "AC": "Acre", "AL": "Alagoas", "AP": "Amapá", "AM": "Amazonas", "BA": "Bahia", "CE": "Ceará", "DF": "Distrito Federal",
    "ES": "Espírito Santo", "GO": "Goiás", "MA": "Maranhão", "MT": "Mato Grosso", "MS": "Mato Grosso do Sul", "MG": "Minas Gerais",
    "PA": "Pará", "PB": "Paraíba", "PR": "Paraná", "PE": "Pernambuco", "PI": "Piauí", "RJ": "Rio de Janeiro",
    "RN": "Rio Grande do Norte", "RS": "Rio Grande do Sul", "RO": "Rondônia", "RR": "Roraima", "SC": "Santa Catarina",
    "SP": "São Paulo", "SE": "Sergipe", "TO": "Tocantins",
}
TIPOS = {"apartamento": "Apartamento", "casa": "Casa", "terreno": "Terreno", "comercial": "Comercial", "rural": "Rural", "outro": "Outro"}
MINIMO_CIDADE = 5   # cidades com menos imóveis ativos não ganham página própria (ficam listadas na página da UF)
MAX_LINHAS = 60


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", sem_acentos(s or "").lower()).strip("-") or "x"


def _moeda(v) -> str:
    return "—" if v is None else "R$ " + f"{v:,.0f}".replace(",", ".")


def _num(v, casas=0) -> str:
    return "—" if v is None else f"{v:,.{casas}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _data(s) -> str:
    return "—" if not s else f"{s[8:10]}/{s[5:7]}/{s[0:4]}"


def _area(r):
    return r.get("area_terreno_m2") if r.get("tipo") == "terreno" else (r.get("area_privativa_m2") or r.get("area_terreno_m2"))


def _ordem(r):
    d = r.get("desconto_pct")
    return (0 if d is not None else 1, -(d or 0), r.get("valor_minimo") or 0)


def _encerrado(r: dict, hoje: str) -> bool:
    datas = [d for d in (r.get("data_leilao"), r.get("data_segunda_praca")) if d]
    return bool(datas) and max(datas) < hoje


def _para_tabela(lista: list[dict], hoje: str) -> list[dict]:
    """Só imóveis com leilão ainda aberto e desconto positivo (uma tabela "maiores descontos" não pode
    começar com 0 % ou desconto negativo). Se sobrar pouco, completa com os demais abertos."""
    abertos = [r for r in lista if not _encerrado(r, hoje)]
    com_desconto = [r for r in abertos if (r.get("desconto_pct") or 0) > 0]
    return com_desconto if len(com_desconto) >= 5 else abertos


def _esc(s) -> str:
    return html.escape(str(s if s is not None else "—"), quote=True)


def _linha(r: dict, prefixo: str, com_cidade: bool) -> str:
    ficha = f"{prefixo}imovel.html?id={urllib.parse.quote(r['id'], safe='')}&uf={r.get('uf')}"
    cidade = f"<td>{_esc(r.get('cidade'))}</td>" if com_cidade else ""
    d = r.get("desconto_pct")
    return (f"<tr><td>{_esc(TIPOS.get(r.get('tipo'), 'Outro'))}</td><td>{_esc(r.get('bairro'))}</td>{cidade}"
            f"<td class=\"num\">{_moeda(r.get('valor_minimo'))}</td><td class=\"num\">{'—' if d is None else _num(d) + '%'}</td>"
            f"<td class=\"num\">{_num(_area(r))}</td><td class=\"num\">{_num(r.get('valor_m2'))}</td><td>{_data(r.get('data_leilao'))}</td>"
            f"<td><a href=\"{_esc(ficha)}\">ficha</a></td></tr>")


def _url_ficha(base: str, r: dict) -> str:
    return f"{base}/imovel.html?id={urllib.parse.quote(r['id'], safe='')}&uf={r.get('uf')}"


def _jsonld(*objs: dict) -> str:
    """Blocos <script type="application/ld+json"> (dados, não executados: a CSP não os bloqueia)."""
    return "".join('<script type="application/ld+json">' + json.dumps(o, ensure_ascii=False).replace("<", "\\u003c")
                   + "</script>" for o in objs)


def _breadcrumb_jsonld(*itens: tuple[str, str | None]) -> dict:
    return {"@context": "https://schema.org", "@type": "BreadcrumbList",
            "itemListElement": [dict({"@type": "ListItem", "position": i, "name": n}, **({"item": u} if u else {}))
                                for i, (n, u) in enumerate(itens, 1)]}


def _itemlist_jsonld(base: str, regs: list[dict], hoje: str) -> dict:
    itens = []
    for i, r in enumerate(sorted(_para_tabela(regs, hoje), key=_ordem)[:10], 1):
        onde = ", ".join(x for x in (r.get("bairro"), r.get("cidade")) if x)
        item = {"@type": "RealEstateListing", "name": f"{TIPOS.get(r.get('tipo'), 'Imóvel')} em {onde}/{r.get('uf')}",
                "url": _url_ficha(base, r)}
        if r.get("valor_minimo"):
            item["offers"] = {"@type": "Offer", "price": round(r["valor_minimo"]), "priceCurrency": "BRL"}
        itens.append({"@type": "ListItem", "position": i, "item": item})
    return {"@context": "https://schema.org", "@type": "ItemList", "itemListElement": itens}


def _pagina(titulo: str, descricao: str, corpo: str, prefixo: str, canonico: str | None, extra_head: str = "") -> str:
    meta_url = ""
    if canonico:
        meta_url = (f'<link rel="canonical" href="{_esc(canonico)}">\n<meta property="og:url" content="{_esc(canonico)}">\n'
                    f'<meta property="og:image" content="{_esc(urllib.parse.urljoin(canonico, "/og.png"))}">')
    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{_esc(titulo)} — Aysha Leilões</title>
<meta name="description" content="{_esc(descricao)}">
<meta name="color-scheme" content="light dark">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Aysha Leilões">
<meta property="og:title" content="{_esc(titulo)}">
<meta property="og:description" content="{_esc(descricao)}">
<meta name="twitter:card" content="summary_large_image">
{meta_url}
{extra_head}
<link rel="icon" href="{prefixo}img/logo.svg" type="image/svg+xml">
<link rel="stylesheet" href="{prefixo}css/style.css">
</head>
<body>
<a class="skip" href="#conteudo">Ir para o conteúdo</a>
<header class="topo">
  <div class="linha1">
    <h1><a href="{prefixo}"><img class="logo" src="{prefixo}img/logo.svg" alt="">Aysha Leilões</a></h1>
    <div class="resumo"><a href="{prefixo}">← tabela com filtros</a></div>
    <nav><a href="{prefixo}agenda.html">Agenda</a><a href="{prefixo}estatisticas.html">Estatísticas</a><a href="{prefixo}conta.html">Minha conta</a><a href="{prefixo}sobre.html">Como funciona e preços</a></nav>
  </div>
</header>
<main class="sobre seo" id="conteudo">
{corpo}
</main>
<footer>
  <p><strong>Aviso.</strong> Agregador independente, sem vínculo com a Caixa, o Banestes, leiloeiros, tribunais ou qualquer fonte listada. Dados extraídos automaticamente, sujeitos a erros e desatualização; confira o anúncio e o edital originais. Nada aqui é assessoria jurídica ou recomendação de investimento.</p>
  <p>Contato: <a href="mailto:jmarques.oliveirajunior@gmail.com">jmarques.oliveirajunior@gmail.com</a> · <a href="{prefixo}sobre.html#contas">termos de uso e privacidade</a>.</p>
</footer>
<script src="{prefixo}js/config.js"></script>
<script src="{prefixo}js/common.js"></script>
</body>
</html>
"""


def _tabela(lista: list[dict], prefixo: str, com_cidade: bool, hoje: str) -> str:
    cab = "<th>Tipo</th><th>Bairro</th>" + ("<th>Cidade</th>" if com_cidade else "") + \
          "<th class=\"num\">Lance mínimo</th><th class=\"num\">Desconto</th><th class=\"num\">m²</th><th class=\"num\">R$/m²</th><th>Leilão</th><th></th>"
    linhas = "\n".join(_linha(r, prefixo, com_cidade) for r in sorted(_para_tabela(lista, hoje), key=_ordem)[:MAX_LINHAS])
    return f"<div class=\"tabela-wrap\"><table class=\"tabela seo\"><thead><tr>{cab}</tr></thead><tbody>\n{linhas}\n</tbody></table></div>"


def _resumo(lista: list[dict]) -> str:
    menor = min((r.get("valor_minimo") for r in lista if r.get("valor_minimo")), default=None)
    desc = [r["desconto_pct"] for r in lista if r.get("desconto_pct") is not None]
    partes = [f"{len(lista)} imóve{'l' if len(lista) == 1 else 'is'} ativo{'' if len(lista) == 1 else 's'}"]
    if menor:
        partes.append(f"lance mínimo a partir de {_moeda(menor)}")
    if desc:
        partes.append(f"descontos de até {_num(max(desc))}% sobre a avaliação")
    tipos = {}
    for r in lista:
        tipos[r.get("tipo") or "outro"] = tipos.get(r.get("tipo") or "outro", 0) + 1
    partes.append(", ".join(f"{n} {TIPOS.get(t, t).lower()}{'s' if n > 1 and t != 'comercial' and t != 'rural' else ''}" for t, n in sorted(tipos.items(), key=lambda x: -x[1])[:4]))
    return "; ".join(partes) + "."


def gerar(docs: Path, registros: list[dict], config: dict, hoje: str) -> dict:
    base = (config.get("saida", {}).get("url_site") or "").rstrip("/")
    ativos = [r for r in registros if r.get("ativo", True) and r.get("uf") in UFS and r.get("id")]
    pasta = docs / "leiloes"
    pasta.mkdir(parents=True, exist_ok=True)
    gerados: set[Path] = set()
    urls: list[tuple[str, str]] = [("", hoje), ("sobre.html", hoje), ("exemplo-analise.html", hoje), ("estatisticas.html", hoje)]
    por_uf: dict[str, list[dict]] = {}
    for r in ativos:
        por_uf.setdefault(r["uf"], []).append(r)
    n_cidades = 0
    for uf in sorted(por_uf):
        lista = por_uf[uf]
        nome_uf = UFS[uf]
        p_uf = pasta / uf
        p_uf.mkdir(exist_ok=True)
        prefixo = "../../"
        cidades: dict[str, list[dict]] = {}
        for r in lista:
            if r.get("cidade"):
                cidades.setdefault(r["cidade"], []).append(r)
        itens = []
        for cidade in sorted(cidades, key=lambda c: (-len(cidades[c]), c)):
            lc = cidades[cidade]
            if len(lc) >= MINIMO_CIDADE:
                href = f"{slug(cidade)}.html"
            else:
                href = f"{prefixo}?uf={uf}&cidade={urllib.parse.quote(cidade)}"
            itens.append(f"<li><a href=\"{_esc(href)}\">{_esc(cidade)}</a> <span class=\"muted\">({len(lc)})</span></li>")
        titulo = f"Imóveis em leilão no {nome_uf} ({uf})" if uf not in ("DF",) else f"Imóveis em leilão no {nome_uf}"
        descricao = f"Imóveis em leilão, licitação e venda direta em {nome_uf}: {_resumo(lista)} Tabela com desconto, R$/m² e link para o edital."
        corpo = (f"<h2>{_esc(titulo)}</h2>\n<p>{_esc(_resumo(lista))} Dados da coleta de {_data(hoje)}, reunidos de bancos, leiloeiros e tribunais. "
                 f"<a href=\"{prefixo}?uf={uf}\">Abrir {uf} na tabela com filtros, mapa e comparação →</a></p>\n"
                 f"<h3>Cidades</h3>\n<ul class=\"cidades\">{''.join(itens)}</ul>\n"
                 f"<h3>Maiores descontos em {_esc(nome_uf)}</h3>\n{_tabela(lista, prefixo, True, hoje)}\n"
                 f"<p class=\"muted\">Mostrando até {MAX_LINHAS} de {len(lista)} imóveis, ordenados pelo desconto sobre a avaliação. "
                 f"Quer um parecer sobre um imóvel? Abra a ficha e peça a <a href=\"{prefixo}exemplo-analise.html\">análise com IA (veja um exemplo)</a>.</p>")
        canon = f"{base}/leiloes/{uf}/" if base else None
        extra = _jsonld(_breadcrumb_jsonld(("Aysha Leilões", f"{base}/"), ("Leilões por estado", f"{base}/leiloes/"), (nome_uf, None)),
                        _itemlist_jsonld(base, lista, hoje)) if base else ""
        alvo = p_uf / "index.html"
        alvo.write_text(_pagina(titulo, descricao, corpo, prefixo, canon, extra), encoding="utf-8")
        gerados.add(alvo)
        urls.append((f"leiloes/{uf}/", hoje))
        for cidade, lc in cidades.items():
            if len(lc) < MINIMO_CIDADE:
                continue
            titulo_c = f"Imóveis em leilão em {cidade}, {uf}"
            descricao_c = f"Imóveis em leilão, licitação e venda direta em {cidade} ({nome_uf}): {_resumo(lc)} Tabela com desconto, R$/m² e link para o edital."
            corpo_c = (f"<h2>{_esc(titulo_c)}</h2>\n<p>{_esc(_resumo(lc))} Dados da coleta de {_data(hoje)}. "
                       f"<a href=\"{prefixo}?uf={uf}&cidade={urllib.parse.quote(cidade)}\">Abrir {_esc(cidade)} na tabela com filtros, mapa e comparação →</a> · "
                       f"<a href=\"index.html\">todas as cidades de {uf}</a></p>\n"
                       f"<h3>Maiores descontos em {_esc(cidade)}</h3>\n{_tabela(lc, prefixo, False, hoje)}\n"
                       f"<p class=\"muted\">Mostrando até {MAX_LINHAS} de {len(lc)} imóveis, ordenados pelo desconto sobre a avaliação. "
                       f"Quer um parecer sobre um imóvel? Abra a ficha e peça a <a href=\"{prefixo}exemplo-analise.html\">análise com IA (veja um exemplo)</a>.</p>")
            nome = f"{slug(cidade)}.html"
            extra_c = _jsonld(_breadcrumb_jsonld(("Aysha Leilões", f"{base}/"), ("Leilões por estado", f"{base}/leiloes/"),
                                                 (nome_uf, f"{base}/leiloes/{uf}/"), (cidade, None)),
                              _itemlist_jsonld(base, lc, hoje)) if base else ""
            alvo_c = p_uf / nome
            alvo_c.write_text(_pagina(titulo_c, descricao_c, corpo_c, prefixo, f"{base}/leiloes/{uf}/{nome}" if base else None, extra_c), encoding="utf-8")
            gerados.add(alvo_c)
            urls.append((f"leiloes/{uf}/{nome}", hoje))
            n_cidades += 1
        # mapa compacto para a pré-visualização de links, o resumo sem JavaScript e o JSON-LD da ficha
        # (lidos pelo Worker do site; site/index.js documenta as chaves)
        og = {r["id"]: {k: v for k, v in {"t": r.get("tipo"), "b": r.get("bairro"), "c": r.get("cidade"), "v": r.get("valor_minimo"),
                                          "d": r.get("desconto_pct"), "a": _area(r), "q": r.get("quartos"), "n": r.get("natureza"),
                                          "e": r.get("endereco"), "va": r.get("valor_avaliacao"), "dl": r.get("data_leilao"),
                                          "d2": r.get("data_segunda_praca"), "f": r.get("url_foto"), "o": r.get("ocupado")}.items() if v is not None}
              for r in lista}
        (docs / "data" / f"og_{uf}.json").write_text(json.dumps(og, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # índice dos estados (docs/leiloes/index.html)
    itens_uf = "".join(f"<li><a href=\"{uf}/\">{_esc(UFS[uf])}</a> <span class=\"muted\">({len(por_uf[uf])})</span></li>" for uf in sorted(por_uf, key=lambda u: UFS[u]))
    corpo_idx = (f"<h2>Imóveis em leilão por estado</h2>\n<p>{len(ativos)} imóveis ativos em {len(por_uf)} estados, de bancos, leiloeiros e tribunais, "
                 f"coletados em {_data(hoje)}. Escolha o estado para ver as cidades e os maiores descontos, ou "
                 f"<a href=\"../\">abra a tabela com filtros</a>.</p>\n<ul class=\"cidades\">{itens_uf}</ul>")
    alvo_idx = pasta / "index.html"
    alvo_idx.write_text(_pagina("Imóveis em leilão por estado", f"Leilões, licitações e vendas diretas de imóveis em {len(por_uf)} estados: escolha o estado e veja cidades e maiores descontos.",
                                corpo_idx, "../", f"{base}/leiloes/" if base else None), encoding="utf-8")
    gerados.add(alvo_idx)
    urls.insert(3, ("leiloes/", hoje))
    # páginas de coletas anteriores que não existem mais (cidade que ficou abaixo do mínimo etc.)
    for p in pasta.rglob("*.html"):
        if p not in gerados:
            p.unlink()
    for d in sorted((d for d in pasta.iterdir() if d.is_dir()), reverse=True):
        if not any(d.iterdir()):
            d.rmdir()
    gerar_estatisticas(docs, ativos, por_uf, hoje, base)
    if base:
        itens_xml = "\n".join(f"  <url><loc>{_esc(base + '/' + u)}</loc><lastmod>{d}</lastmod></url>" for u, d in urls)
        (docs / "sitemap.xml").write_text(f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{itens_xml}\n</urlset>\n', encoding="utf-8")
        # sitemap das fichas: o Worker do site renderiza o resumo de cada uma no servidor (site/index.js)
        fichas_xml = "\n".join(f"  <url><loc>{_esc(_url_ficha(base, r))}</loc><lastmod>{hoje}</lastmod></url>" for r in ativos)
        (docs / "sitemap-imoveis.xml").write_text(f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{fichas_xml}\n</urlset>\n', encoding="utf-8")
    exemplo = gerar_exemplo(docs)
    return {"ufs": len(por_uf), "cidades": n_cidades, "urls": len(urls), "fichas": len(ativos), "exemplo": exemplo}


# ---------------------------------------------------------------- estatísticas (docs/estatisticas.html) ----
_MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]


def _mediana(valores: list) -> float | None:
    s = sorted(valores)
    n = len(s)
    return None if not n else (s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2)


def _media(valores: list) -> float | None:
    return sum(valores) / len(valores) if valores else None


def _pct(v) -> str:
    return "—" if v is None else f"{_num(v)}%"


def _descontos(regs: list[dict]) -> list[float]:
    """Descontos plausíveis: acima de 90 % é quase sempre erro da fonte e distorceria médias e ranking."""
    return [r["desconto_pct"] for r in regs if r.get("desconto_pct") is not None and 0 < r["desconto_pct"] <= 90]


def gerar_estatisticas(docs: Path, ativos: list[dict], por_uf: dict[str, list[dict]], hoje: str, base: str) -> None:
    """Página de números do mercado (docs/estatisticas.html): resumo, tabela por estado, maiores descontos
    do país, números por tipo e nota de metodologia/citação. Atualizada a cada coleta."""
    d0 = date.fromisoformat(hoje)
    ate30 = (d0 + timedelta(days=30)).isoformat()
    abertos = [r for r in ativos if not _encerrado(r, hoje)]
    prox30 = [r for r in abertos if any(hoje <= dt <= ate30 for dt in (r.get("data_leilao"), r.get("data_segunda_praca")) if dt)]
    cidades = {(r.get("uf"), r.get("cidade")) for r in ativos if r.get("cidade")}
    desc_geral = _descontos(ativos)
    mes = f"{_MESES[d0.month - 1]} de {d0.year}"
    titulo = f"Estatísticas de leilões de imóveis no Brasil — {mes}"
    descricao = (f"{_num(len(ativos))} imóveis em leilão, licitação e venda direta em {len(por_uf)} estados: desconto médio de "
                 f"{_pct(_media(desc_geral))} sobre a avaliação, {len(prox30)} leilões nos próximos 30 dias, números por estado "
                 f"e por tipo e os maiores descontos do país. Atualizado todo dia.")
    kpis = [("Imóveis ativos", _num(len(ativos))), ("Estados", str(len(por_uf))), ("Cidades", _num(len(cidades))),
            ("Desconto médio", _pct(_media(desc_geral))), ("Leilões em 30 dias", _num(len(prox30))),
            ("Fontes", str(len({r.get('fonte') for r in ativos})))]
    corpo = [f"<h2>{_esc(titulo)}</h2>",
             f"<p>Números calculados sobre os imóveis ativos da base na coleta de {_data(hoje)}, reunidos diariamente de bancos, "
             f"leiloeiros oficiais e tribunais, com deduplicação entre fontes. <a href=\"./\">Abrir a tabela completa com filtros →</a></p>",
             '<div class="kpis">' + "".join(f'<div class="kpi"><div class="r">{_esc(r)}</div><div class="v">{_esc(v)}</div></div>' for r, v in kpis) + "</div>"]

    corpo.append("<h3 id=\"por-estado\">Por estado</h3>")
    linhas = []
    for uf in sorted(por_uf, key=lambda u: -len(por_uf[u])):
        lu = por_uf[uf]
        du = _descontos(lu)
        lances = [r["valor_minimo"] for r in lu if r.get("valor_minimo")]
        m2 = [r["valor_m2"] for r in lu if r.get("valor_m2")]
        linhas.append(f"<tr><td><a href=\"leiloes/{uf}/\">{_esc(UFS[uf])}</a></td><td class=\"num\">{_num(len(lu))}</td>"
                      f"<td class=\"num\">{_pct(_media(du))}</td><td class=\"num\">{_pct(max(du)) if du else '—'}</td>"
                      f"<td class=\"num\">{_moeda(min(lances) if lances else None)}</td><td class=\"num\">{_num(_mediana(m2))}</td></tr>")
    corpo.append("<div class=\"tabela-wrap\"><table class=\"tabela seo\"><thead><tr><th>Estado</th><th class=\"num\">Imóveis</th>"
                 "<th class=\"num\">Desconto médio</th><th class=\"num\">Maior desconto</th><th class=\"num\">Menor lance</th>"
                 "<th class=\"num\">R$/m² mediano</th></tr></thead><tbody>\n" + "\n".join(linhas) + "\n</tbody></table></div>")

    corpo.append("<h3 id=\"maiores-descontos\">Os 20 maiores descontos do país</h3>")
    top = sorted((r for r in abertos if r.get("desconto_pct") is not None and 0 < r["desconto_pct"] <= 90),
                 key=lambda r: -r["desconto_pct"])[:20]
    linhas = [(f"<tr><td>{_esc(TIPOS.get(r.get('tipo'), 'Outro'))}</td><td>{_esc(r.get('cidade'))}/{_esc(r.get('uf'))}</td>"
               f"<td>{_esc(r.get('bairro'))}</td><td class=\"num\">{_moeda(r.get('valor_minimo'))}</td>"
               f"<td class=\"num\">{_moeda(r.get('valor_avaliacao'))}</td><td class=\"num\">{_num(r.get('desconto_pct'))}%</td>"
               f"<td>{_data(r.get('data_leilao'))}</td><td><a href=\"imovel.html?id={urllib.parse.quote(r['id'], safe='')}&amp;uf={r.get('uf')}\">ficha</a></td></tr>")
              for r in top]
    corpo.append("<div class=\"tabela-wrap\"><table class=\"tabela seo\"><thead><tr><th>Tipo</th><th>Cidade</th><th>Bairro</th>"
                 "<th class=\"num\">Lance mínimo</th><th class=\"num\">Avaliação</th><th class=\"num\">Desconto</th><th>Leilão</th><th></th>"
                 "</tr></thead><tbody>\n" + "\n".join(linhas) + "\n</tbody></table></div>")

    corpo.append("<h3 id=\"por-tipo\">Por tipo de imóvel</h3>")
    por_tipo: dict[str, list[dict]] = {}
    for r in ativos:
        por_tipo.setdefault(r.get("tipo") or "outro", []).append(r)
    linhas = []
    for t in sorted(por_tipo, key=lambda t: -len(por_tipo[t])):
        lt = por_tipo[t]
        m2 = [r["valor_m2"] for r in lt if r.get("valor_m2")]
        linhas.append(f"<tr><td>{_esc(TIPOS.get(t, 'Outro'))}</td><td class=\"num\">{_num(len(lt))}</td>"
                      f"<td class=\"num\">{_pct(_media(_descontos(lt)))}</td><td class=\"num\">{_num(_mediana(m2))}</td></tr>")
    corpo.append("<div class=\"tabela-wrap\"><table class=\"tabela seo\"><thead><tr><th>Tipo</th><th class=\"num\">Imóveis</th>"
                 "<th class=\"num\">Desconto médio</th><th class=\"num\">R$/m² mediano</th></tr></thead><tbody>\n"
                 + "\n".join(linhas) + "\n</tbody></table></div>")

    url_pagina = f"{base}/estatisticas.html" if base else None
    corpo.append("<h3 id=\"metodologia\">Metodologia e citação</h3>"
                 "<p>Base: imóveis ativos (ainda anunciados na fonte) no dia da coleta; leilões já encerrados ficam fora do ranking. "
                 "O desconto compara o lance mínimo com a avaliação informada pela própria fonte; descontos acima de 90% são tratados "
                 "como provável erro de origem e não entram nas médias nem no ranking. R$/m² usa a área privativa (ou do terreno, em terrenos). "
                 f"Os números podem ser citados livremente, com link para esta página{(' (<code>' + _esc(url_pagina) + '</code>)') if url_pagina else ''}. "
                 "Os dados mudam todo dia; a data da coleta está no topo.</p>"
                 "<p class=\"muted\">Quer um parecer sobre um imóvel específico? Abra a ficha e peça a "
                 "<a href=\"exemplo-analise.html\">análise com IA (veja um exemplo)</a>.</p>")

    extra = ""
    if base:
        extra = _jsonld({"@context": "https://schema.org", "@type": "Dataset", "name": titulo, "description": descricao,
                         "url": url_pagina, "dateModified": hoje, "inLanguage": "pt-BR", "spatialCoverage": "Brasil",
                         "creator": {"@type": "Organization", "name": "Aysha Leilões", "url": f"{base}/"}},
                        _breadcrumb_jsonld(("Aysha Leilões", f"{base}/"), ("Estatísticas", None)))
    (docs / "estatisticas.html").write_text(_pagina(titulo, descricao, "\n".join(corpo), "./", url_pagina, extra), encoding="utf-8")


# ---------------------------------------------------------------- exemplo de análise (HTML estático) ----
def _inline(s: str) -> str:
    s = html.escape(s, quote=False)
    s = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", r'<a href="\2" target="_blank" rel="noopener">\1</a>', s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", s)
    s = re.sub(r"(^|[^*])\*([^*\n]+)\*(?!\*)", r"\1<i>\2</i>", s)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    return s


def markdown_para_html(md: str) -> str:
    """Mesmo subconjunto que docs/js/common.js (títulos, parágrafos, listas, tabelas, negrito, itálico, links)."""
    out: list[str] = []
    estado = {"lista": None, "tabela": None, "par": []}

    def fechar_par():
        if estado["par"]:
            out.append("<p>" + " ".join(_inline(x) for x in estado["par"]) + "</p>")
            estado["par"] = []

    def fechar_lista():
        if estado["lista"]:
            out.append(f"</{estado['lista']}>")
            estado["lista"] = None

    def fechar_tabela():
        t = estado["tabela"]
        if not t:
            return
        cab, corpo = t[0], t[1:]
        out.append("<table><thead><tr>" + "".join(f"<th>{_inline(c)}</th>" for c in cab) + "</tr></thead><tbody>"
                   + "".join("<tr>" + "".join(f"<td>{_inline(c)}</td>" for c in l) + "</tr>" for l in corpo) + "</tbody></table>")
        estado["tabela"] = None

    for raw in md.replace("\r", "").split("\n"):
        l = raw.rstrip()
        if re.match(r"^\s*\|.*\|\s*$", l):
            fechar_par(); fechar_lista()
            celulas = [c.strip() for c in l.strip()[1:-1].split("|")]
            if all(re.fullmatch(r":?-{2,}:?", c) for c in celulas):
                continue
            (estado["tabela"] or estado.__setitem__("tabela", []) or estado["tabela"]).append(celulas)
            continue
        fechar_tabela()
        m = re.match(r"^(#{1,4})\s+(.*)", l)
        if m:
            fechar_par(); fechar_lista()
            n = len(m.group(1)) + 2
            out.append(f"<h{n}>{_inline(m.group(2))}</h{n}>")
            continue
        m = re.match(r"^\s*[-*]\s+(.*)", l)
        if m:
            fechar_par()
            if estado["lista"] != "ul":
                fechar_lista(); out.append("<ul>"); estado["lista"] = "ul"
            out.append(f"<li>{_inline(m.group(1))}</li>")
            continue
        m = re.match(r"^\s*\d+[.)]\s+(.*)", l)
        if m:
            fechar_par()
            if estado["lista"] != "ol":
                fechar_lista(); out.append("<ol>"); estado["lista"] = "ol"
            out.append(f"<li>{_inline(m.group(1))}</li>")
            continue
        if not l.strip():
            fechar_par(); fechar_lista()
            continue
        estado["par"].append(l.strip())
    fechar_par(); fechar_lista(); fechar_tabela()
    return "\n".join(out)


def gerar_exemplo(docs: Path) -> bool:
    """Pré-renderiza o exemplo público de análise em docs/exemplo-analise.html (dentro de <main>), para
    buscadores e prévias de link verem o conteúdo sem JavaScript. O script da ficha substitui o conteúdo
    pela versão completa quando a página abre no navegador."""
    dados = docs / "data" / "exemplo_analise.json"
    pagina = docs / "exemplo-analise.html"
    if not dados.exists() or not pagina.exists():
        return False
    d = json.loads(dados.read_text(encoding="utf-8"))
    tipo = TIPOS.get(d.get("tipo"), "Imóvel")
    onde = ", ".join(x for x in (d.get("bairro"), d.get("cidade")) if x) + (f"/{d['uf']}" if d.get("uf") else "")
    kpis = [("Lance mínimo", _moeda(d.get("valor_minimo"))), ("Avaliação", _moeda(d.get("valor_avaliacao"))),
            ("Área privativa", f"{_num(d.get('area_privativa_m2'))} m²" if d.get("area_privativa_m2") else "—"),
            ("Quartos", _num(d.get("quartos")) if d.get("quartos") else "—")]
    corpo = (f'<div class="aviso exemplo-aviso"><b>Exemplo público.</b> Ficha real de um imóvel da base com a análise com IA aberta, para você ver o que recebe ao pedir uma análise. '
             f'<a href="imovel.html?id={html.escape(d["id"])}&amp;uf={html.escape(d.get("uf") or "")}">Abrir a ficha normal deste imóvel →</a></div>\n'
             f"<h2>{_esc(tipo)} em {_esc(onde)}</h2>\n<div class=\"kpis\">"
             + "".join(f'<div class="kpi"><div class="r">{_esc(r)}</div><div class="v">{_esc(v)}</div></div>' for r, v in kpis)
             + '</div>\n<div class="grade"><div class="bloco largo relatorio" id="analise"><h3>✦ Análise com IA</h3><div class="relatorio-texto">'
             + markdown_para_html(d.get("markdown") or "")
             + '</div><p class="aviso">Parecer automático, gerado por IA a partir do edital, da matrícula e de buscas na web. Pode conter erros. Não é assessoria jurídica nem recomendação de investimento: confira os documentos e consulte um profissional antes de dar lance.</p>'
             + '<p class="chamada"><a class="btn primario btn-ia-grande" href="./">Escolher um imóvel na tabela</a> <span class="muted">Toda conta nova ganha 1 crédito: a primeira análise é grátis.</span></p></div></div>')
    original = pagina.read_text(encoding="utf-8")
    novo = re.sub(r'(<main class="detalhe"[^>]*id="detalhe"[^>]*>).*?(</main>)', lambda m: m.group(1) + "\n" + corpo + "\n" + m.group(2), original, count=1, flags=re.S)
    if novo != original:
        pagina.write_text(novo, encoding="utf-8")
    return True
