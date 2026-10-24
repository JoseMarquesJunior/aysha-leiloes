"""Análise detalhada de um imóvel com IA (relatório sob demanda), no estilo de um parecer para quem compra.

Diferente da etapa de extração (collector/ia.py, Haiku, campos estruturados), aqui o modelo lê o edital,
a matrícula e o laudo inteiros, pesquisa comparáveis de mercado na web e escreve um parecer em Markdown:
resumo do lote, conta de custos no lance, referência de mercado, sinais vermelhos, veredito e checklist
de diligência. Modelo: Opus 5 (pedido do mantenedor), com busca na web.

Economia: o relatório de cada imóvel é gerado UMA vez. O texto vai para o banco do Worker (D1), que o
entrega só a quem tem acesso (conta + análise grátis ou crédito); nada do parecer fica no site público.
Em collector/cache/relatorios/<id>.json ficam apenas os metadados (custo, tokens) e os CAMPOS ESTRUTURADOS
extraídos junto com o parecer (área, endereço, bairro, quartos, matrícula...), que a coleta diária aplica
ao registro do imóvel (só onde ainda está vazio). O custo acumulado fica em docs/data/custo_relatorios.json.

Uso:  python -m collector.relatorio <id> [<id> ...]   (precisa de ANTHROPIC_API_KEY; com WORKER_URL e
                                                      INTERNO_SECRET envia o parecer ao Worker)
      python -m collector.relatorio --migrar           (envia ao Worker os relatórios antigos de docs/data/relatorios,
                                                      extrai os campos deles e apaga os arquivos públicos)
      python -m collector.relatorio --campos           (extrai os campos dos relatórios em que a extração falhou)
      python -m collector.relatorio --refazer -- <id>  (gera de novo, mesmo que já exista)
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
from datetime import date, datetime
from pathlib import Path

import yaml

from .ia import remover_nomes, textos_dos_documentos
from .http_client import cliente_do_config
from .schema import TIPOS, completar, normalizar_tipo, preencher_derivados

log = logging.getLogger(__name__)

RAIZ = Path(__file__).resolve().parent.parent
PASTA_PUBLICA_ANTIGA = RAIZ / "docs" / "data" / "relatorios"    # só para a migração (--migrar)
PASTA = RAIZ / "collector" / "cache" / "relatorios"              # metadados + campos estruturados (sem o texto)
PASTA_LOCAL = RAIZ / "collector" / "cache" / "relatorios_local"  # texto do parecer quando não há Worker (não versionado)
MODELO = "claude-opus-5"
MODELO_CAMPOS = "claude-haiku-5-5"
PRECOS_USD_MTOK = {"claude-opus-5": (5.0, 25.0), "claude-opus-5-5": (4.0, 20.0), "claude-haiku-5-5": (0.10, 0.50)}
PRECO_BUSCA_USD = 0.01  # US$ 10 por mil buscas na web
MAX_BUSCAS = 3   # cada busca devolve páginas inteiras: 6 buscas levaram a 120 mil tokens de entrada no 1º teste
MAX_TOKENS = 6000  # parecer de até 500 palavras + raciocínio
MAX_CHARS_DOCUMENTO = 60000  # ~17 mil tokens por documento; acima disso o texto é cortado no fim

SISTEMA = """Você é um analista experiente de leilões de imóveis no Brasil, escrevendo para investidores e pessoas do ramo que vão decidir se dão lance. Você recebe os dados do anúncio e o texto dos documentos (edital, matrícula, laudo) e pode pesquisar na web preços de mercado do bairro e do prédio.

Escreva em português do Brasil, em Markdown, direto e opinativo. SEJA CURTO: o parecer inteiro deve ter no máximo 500 palavras (uma página). Nada de tabela-ficha com todos os dados do edital; só o que muda a decisão. Formato (use exatamente estes títulos):

## Resumo do lote
Um parágrafo de 3 a 5 linhas: o que é, onde, área, quartos, vaga (própria ou rotativa), estado de conservação, ocupação, quem vende e por quê, datas e os valores-chave (avaliação, lance mínimo, comissão, forma de pagamento). Mencione matrícula e processo só pelo número.

## Conta no lance mínimo
Tabela Markdown de no máximo 6 linhas: lance, comissão, ITBI (~2%) + registro, reforma estimada (R$/m²), débitos que ficam com o arrematante se o edital disser, total.

## Referência de mercado
Até 4 linhas: preço do m² no bairro e, se achar, anúncio no mesmo prédio ou rua, com link. Diga se a avaliação é preço de mercado e qual o valor provável de saída reformado. Se não achar comparáveis, diga em uma linha.

## Sinais vermelhos
Lista com os 3 a 5 riscos que realmente importam, uma ou duas linhas cada (titularidade irregular, terceiros, ônus, dívida pequena demais / remição, processo antigo / prescrição, débitos propter rem, preço vil, ocupação, vaga rotativa, documentos ausentes). Sem os que não se aplicam.

## Veredito
Dois ou três parágrafos curtos: entrar ou não, em qual leilão, com qual teto de lance e sob qual condição. Depois uma lista numerada de no máximo 4 diligências antes do lance, cada uma em uma linha, dizendo o que mudaria a decisão.

Regras: nunca invente dados; quando o documento não diz, escreva "não informado", sem explicar por quê. NUNCA escreva nomes de pessoas físicas (executados, terceiros, depositários, titulares): use "o executado", "o terceiro interessado", "o titular registral", "o depositário". Nomes de empresas, bancos, cartórios, condomínios e leiloeiros podem aparecer. Termine com uma linha avisando que não é assessoria jurídica nem recomendação de investimento e que a parte jurídica deve ser validada por um profissional."""


def _carregar_base() -> dict[str, dict]:
    pasta = RAIZ / "docs" / "data"
    meta = json.loads((pasta / "meta.json").read_text(encoding="utf-8"))
    base = {}
    for nome in meta.get("arquivos", ["imoveis.json"]):
        for r in json.loads((pasta / nome).read_text(encoding="utf-8")):
            base[r["id"]] = r
    # ids absorvidos pela deduplicação (lote de leiloeiro fundido ao registro da Caixa/JFES) apontam para o
    # registro principal, que é o que a ficha do site usa
    for r in list(base.values()):
        for o in r.get("outras_fontes") or []:
            if o.get("id") and o["id"] not in base:
                base[o["id"]] = r
    return base


def _campos_do_anuncio(r: dict) -> str:
    chaves = ["id", "fonte", "leiloeiro", "comitente", "tipo", "uf", "cidade", "bairro", "endereco", "area_privativa_m2",
              "area_terreno_m2", "quartos", "vagas", "valor_avaliacao", "valor_minimo", "desconto_pct", "valor_m2", "natureza",
              "modalidade", "data_leilao", "data_segunda_praca", "ocupado", "aceita_financiamento", "aceita_fgts",
              "aceita_parcelamento", "comissao_leiloeiro_pct", "matricula", "numero_processo", "url_anuncio", "url_edital",
              "url_matricula", "descricao_original"]
    linhas = [f"- {k}: {r.get(k)}" for k in chaves if r.get(k) not in (None, "", [])]
    ia = r.get("extracao_ia") or {}
    if ia.get("alertas") or ia.get("onus_na_matricula"):
        linhas.append(f"- extração automática anterior: ônus={ia.get('onus_na_matricula')} alertas={ia.get('alertas')}")
    return "\n".join(linhas)


def recortar_documento(texto: str, numero_processo: str | None) -> str:
    """Editais de leilão unificado (JFES) listam dezenas de processos; para o parecer de um imóvel basta o
    cabeçalho/regras gerais e o bloco do processo dele. Sem número de processo, ou se o bloco não for
    encontrado, devolve o texto inteiro."""
    if not numero_processo or numero_processo not in texto:
        return texto
    partes = re.split(r"(?=\n\s*\d{2}\s*-\s*PROCESSO\s+N)", texto)
    if len(partes) < 3:
        return texto
    cabecalho = partes[0]
    bloco = next((p for p in partes[1:] if numero_processo in p), None)
    if bloco is None:
        return texto
    # as regras gerais do leilão (datas, comissão, parcelamento) costumam vir depois do último bloco
    cauda = partes[-1]
    m = re.search(r"\n\s*(?:LOCAL,?\s*DATAS?|DAS CONDI|CONDI[ÇC][ÕO]ES|REGRAS|DO LEIL[ÃA]O|LEIL[ÃA]O:)", cauda, re.I)
    regras = cauda[m.start():] if m and bloco is not cauda else ("" if bloco is cauda else "")
    return cabecalho + "\n" + bloco + ("\n" + regras if regras else "")


def montar_mensagem(r: dict, textos: list[str]) -> str:
    docs = []
    for i, t in enumerate(textos, 1):
        t = recortar_documento(t, r.get("numero_processo"))
        t = re.sub(r"[ \t]+", " ", t)
        if len(t) > MAX_CHARS_DOCUMENTO:
            t = t[:MAX_CHARS_DOCUMENTO] + "\n[... documento cortado por tamanho ...]"
        docs.append(f"### Documento {i}\n{t}")
    return (f"## Dados do anúncio\n{_campos_do_anuncio(r)}\n\n## Documentos (texto extraído dos PDFs)\n"
            + ("\n\n".join(docs) if docs else "(nenhum documento legível)")
            + "\n\nEscreva o parecer no formato pedido.")


# ---------------------------------------------------------------- documentos (texto ou PDF) ----------
# Matrículas costumam ser digitalizadas: o PDF tem imagem das páginas e quase nenhum texto. Nesses casos o
# próprio PDF vai ao modelo como documento (ele lê as páginas como imagem); quando há texto, vai o texto.
MAX_PAGINAS_PDF = 100
MAX_BYTES_PDF = 25 * 1024 * 1024
MIN_CHARS_POR_PAGINA = 1200  # abaixo disso o PDF é tratado como digitalizado (uma página de matrícula com texto real tem 2 a 4 mil caracteres; só cabeçalho e selo dão ~600)


def _doc(texto: str = "", pdf: bytes | None = None, paginas: int = 0, url: str | None = None) -> dict:
    escaneado = bool(pdf) and paginas > 0 and len(texto.strip()) / paginas < MIN_CHARS_POR_PAGINA
    return {"url": url, "texto": texto, "pdf": pdf, "paginas": paginas, "escaneado": escaneado}


def _normalizar_docs(docs) -> list[dict]:
    return [d if isinstance(d, dict) else _doc(texto=str(d)) for d in (docs or [])]


def documentos_do_imovel(r: dict, cliente, config: dict) -> list[dict]:
    """Baixa edital e matrícula (PDF) do imóvel: texto extraído + bytes + número de páginas. Guarda o texto
    no mesmo cache usado pela etapa em lote (collector/cache/pdf)."""
    import hashlib
    from .sources.jfes import _cache_dir, extrair_texto_pdf
    docs = []
    for url in (r.get("url_edital"), r.get("url_matricula")):
        if not url or not (url.lower().split("?")[0].endswith(".pdf") or "/documentos/" in url or "/anexo/" in url):
            continue
        try:
            conteudo = cliente.get(url).content
            if not conteudo.lstrip().startswith(b"%PDF"):
                log.warning("documento %s não é PDF (%d bytes)", url, len(conteudo))
                continue
            from pypdf import PdfReader
            import io
            paginas = len(PdfReader(io.BytesIO(conteudo)).pages)
            texto = extrair_texto_pdf(conteudo)
            pasta = _cache_dir(config)
            pasta.mkdir(parents=True, exist_ok=True)
            cache = pasta / f"{hashlib.sha256(url.encode()).hexdigest()[:20]}.txt"
            if not cache.exists():
                cache.write_text(f"# {url}\n" + texto, encoding="utf-8")
        except Exception as e:  # noqa: BLE001
            log.warning("documento %s não lido (%s)", url, e)
            continue
        d = _doc(texto=texto, pdf=conteudo, paginas=paginas, url=url)
        log.info("documento %s: %d páginas, %d chars de texto, %s", url, paginas, len(texto), "digitalizado → vai como PDF" if d["escaneado"] else "texto")
        docs.append(d)
    return docs


def _bloco_documento(i: int, d: dict, r: dict) -> list[dict]:
    """Blocos de conteúdo de um documento: PDF (digitalizado) ou texto recortado."""
    if d["escaneado"] and d["pdf"] and d["paginas"] <= MAX_PAGINAS_PDF and len(d["pdf"]) <= MAX_BYTES_PDF:
        import base64
        return [{"type": "text", "text": f"### Documento {i} (PDF digitalizado, {d['paginas']} páginas: leia as páginas como imagem)"},
                {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": base64.b64encode(d["pdf"]).decode("ascii")}}]
    t = re.sub(r"[ \t]+", " ", recortar_documento(d["texto"], r.get("numero_processo")))
    if len(t) > MAX_CHARS_DOCUMENTO:
        t = t[:MAX_CHARS_DOCUMENTO] + "\n[... documento cortado por tamanho ...]"
    return [{"type": "text", "text": f"### Documento {i}\n{t}"}]


def montar_conteudo(r: dict, docs: list[dict]) -> list[dict]:
    blocos = [{"type": "text", "text": f"## Dados do anúncio\n{_campos_do_anuncio(r)}\n\n## Documentos (edital, matrícula)"}]
    for i, d in enumerate(docs, 1):
        blocos.extend(_bloco_documento(i, d, r))
    if not docs:
        blocos.append({"type": "text", "text": "(nenhum documento legível)"})
    # o último bloco marca o cache: a busca na web roda em várias iterações e cada uma reenvia tudo isto
    blocos.append({"type": "text", "text": "Escreva o parecer no formato pedido.", "cache_control": {"type": "ephemeral"}})
    return blocos


def custo_usd(modelo: str, tokens_in: int, tokens_out: int, buscas: int) -> float:
    pe, ps = PRECOS_USD_MTOK.get(modelo, (5.0, 25.0))
    return round((tokens_in * pe + tokens_out * ps) / 1e6 + buscas * PRECO_BUSCA_USD, 4)


_GATILHOS_PESSOA = re.compile(r"\b(executad[oa]s?|exequentes?|terceir[oa]s?|deposit[áa]ri[oa]s?|titular(?:es)?|propriet[áa]ri[oa]s?|c[ôo]njuge|herdeir[oa]s?|esp[óo]lio|adquirente|devedor(?:a|es)?|CPF|falecid[oa]|inventariante|usufrutu[áa]ri[oa]s?|vendedor(?:a|es)?|comprador(?:a|es)?|em nome de|por conta de)\b", re.I)
_CPF = re.compile(r"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b")


def anonimizar(markdown: str, protegidos=()) -> str:
    """Segunda barreira contra nomes de pessoas (a primeira é a instrução ao modelo). Só mexe nas linhas que
    falam de partes (executado, terceiro, depositário, titular, CPF...): aplicar o filtro ao texto inteiro
    mascarava condomínios, leiloeiros e varas ("Conj. Res. Mata da Praia III", "5º Juizado").
    `protegidos`: nomes do próprio registro (cidade, bairro, leiloeiro, comitente) que nunca devem ser
    mascarados, mesmo numa linha que fala de "comprador" ou "vendedor"."""
    prot = [p for p in protegidos if isinstance(p, str) and len(p) > 2]

    def proteger(l):
        for i, p in enumerate(prot):
            l = l.replace(p, f"\x00{i}\x00")
        return l

    def restaurar(l):
        for i, p in enumerate(prot):
            l = l.replace(f"\x00{i}\x00", p)
        return l

    saida = []
    for linha in markdown.splitlines():
        if "](http" in linha or linha.lstrip().startswith(("http", "Sources", "Fontes")):
            saida.append(linha)  # links e fontes ficam como estão
        elif _GATILHOS_PESSOA.search(linha):
            saida.append(restaurar(remover_nomes(proteger(linha)) or ""))
        else:
            saida.append(_CPF.sub("[CPF]", linha))
    return "\n".join(saida)


# ---------------------------------------------------------------- campos estruturados ---------------
# Depois do parecer, uma chamada barata (Haiku, saída estruturada) lê o parecer + os documentos e devolve
# os campos do esquema que a fonte não informou. A coleta diária aplica só onde o registro está null.
CAMPOS_ESTRUTURADOS = ("tipo", "area_privativa_m2", "area_terreno_m2", "area_total_m2", "quartos", "vagas", "endereco",
                       "bairro", "cidade", "uf", "matricula", "numero_processo", "ocupado", "aceita_financiamento",
                       "aceita_fgts", "aceita_parcelamento", "debitos_iptu_por_conta_de", "debitos_condominio_por_conta_de",
                       "comissao_leiloeiro_pct", "valor_avaliacao", "data_leilao", "data_segunda_praca", "comitente")


def _nulo_ou(t: dict) -> dict:
    return {"anyOf": [t, {"type": "null"}]}


# A API aceita no máximo 16 campos anuláveis (anyOf) por esquema: os textos usam "" para "não informado" e
# só números e booleanos são anuláveis (11).
ESQUEMA_CAMPOS = {
    "type": "object",
    "additionalProperties": False,
    "required": list(CAMPOS_ESTRUTURADOS),
    "properties": {
        "tipo": {"type": "string", "enum": list(TIPOS) + [""]},
        "area_privativa_m2": _nulo_ou({"type": "number"}), "area_terreno_m2": _nulo_ou({"type": "number"}),
        "area_total_m2": _nulo_ou({"type": "number"}),
        "quartos": _nulo_ou({"type": "integer"}), "vagas": _nulo_ou({"type": "integer"}),
        "endereco": {"type": "string"}, "bairro": {"type": "string"}, "cidade": {"type": "string"}, "uf": {"type": "string"},
        "matricula": {"type": "string"}, "numero_processo": {"type": "string"},
        "ocupado": _nulo_ou({"type": "boolean"}), "aceita_financiamento": _nulo_ou({"type": "boolean"}),
        "aceita_fgts": _nulo_ou({"type": "boolean"}), "aceita_parcelamento": _nulo_ou({"type": "boolean"}),
        "debitos_iptu_por_conta_de": {"type": "string", "enum": ["vendedor", "comprador", ""]},
        "debitos_condominio_por_conta_de": {"type": "string", "enum": ["vendedor", "comprador", ""]},
        "comissao_leiloeiro_pct": _nulo_ou({"type": "number"}),
        "valor_avaliacao": _nulo_ou({"type": "number"}),
        "data_leilao": {"type": "string"}, "data_segunda_praca": {"type": "string"},
        "comitente": {"type": "string"},
    },
}

SISTEMA_CAMPOS = (
    "Você estrutura dados de imóveis em leilão no Brasil. Receberá o parecer de um analista, os dados do anúncio "
    "e o texto dos documentos (edital, matrícula). Responda SOMENTE com o JSON do esquema. Regras: null (números e "
    "booleanos) ou \"\" (textos) quando nenhuma fonte informa; nunca invente nem estime; áreas em m² (número), quartos e vagas inteiros; endereco = "
    "logradouro, número e complemento (sem CEP, sem bairro, sem cidade); bairro, cidade e uf (sigla de 2 letras) "
    "separados; matricula e numero_processo só o número; datas em AAAA-MM-DD; comissao_leiloeiro_pct em número "
    "(5 para 5 %); débitos: 'vendedor' quando quem vende/credor assume, 'comprador' quando o arrematante assume; "
    "comitente = quem vende (banco, empresa, vara/juízo), nunca pessoa física; nunca escreva nomes de pessoas físicas."
)

_DATA_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def limpar_campos(c: dict) -> dict:
    """Valida o JSON do modelo: faixas plausíveis, tipos, sem nomes de pessoas; devolve só o aproveitável."""
    out: dict = {}

    def num(k, lo, hi, inteiro=False):
        v = c.get(k)
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            return
        if lo <= v <= hi:
            out[k] = int(v) if inteiro else round(float(v), 2)

    def txt(k, maximo=200):
        v = c.get(k)
        if isinstance(v, str) and v.strip():
            v = re.sub(r"\s+", " ", v).strip()[:maximo]
            if "[nome]" in (remover_nomes(v) or ""):
                return
            out[k] = v

    t = normalizar_tipo(c.get("tipo")) if c.get("tipo") else None
    if t and t != "outro":
        out["tipo"] = t
    num("area_privativa_m2", 5, 50000)
    num("area_terreno_m2", 5, 100000000)
    num("area_total_m2", 5, 100000000)
    num("quartos", 0, 30, True)
    num("vagas", 0, 100, True)
    num("comissao_leiloeiro_pct", 0, 20)
    num("valor_avaliacao", 1000, 1e9)
    for k in ("endereco", "bairro", "cidade", "matricula", "numero_processo", "comitente"):
        txt(k, 300 if k == "endereco" else 120)
    uf = c.get("uf")
    if isinstance(uf, str) and re.fullmatch(r"[A-Za-z]{2}", uf.strip()):
        out["uf"] = uf.strip().upper()
    for k in ("ocupado", "aceita_financiamento", "aceita_fgts", "aceita_parcelamento"):
        if isinstance(c.get(k), bool):
            out[k] = c[k]
    for k in ("debitos_iptu_por_conta_de", "debitos_condominio_por_conta_de"):
        if c.get(k) in ("vendedor", "comprador"):
            out[k] = c[k]
    for k in ("data_leilao", "data_segunda_praca"):
        if isinstance(c.get(k), str) and _DATA_ISO.match(c[k]):
            out[k] = c[k]
    return out


def extrair_campos(r: dict, docs, markdown: str, client) -> tuple[dict, dict]:
    """Chamada barata ao Haiku (saída estruturada) para estruturar o que o parecer e os documentos dizem.
    `docs`: lista de documentos (dicts de documentos_do_imovel) ou de textos. Devolve (campos limpos, uso)."""
    blocos = [{"type": "text", "text": f"## Parecer do analista\n{markdown}\n\n## Dados do anúncio\n{_campos_do_anuncio(r)}"}]
    for i, d in enumerate(_normalizar_docs(docs), 1):
        blocos.extend(_bloco_documento(i, d, r))
    msg = client.messages.create(
        model=MODELO_CAMPOS, max_tokens=800, system=SISTEMA_CAMPOS,
        thinking={"type": "disabled"}, output_config={"effort": "low", "format": {"type": "json_schema", "schema": ESQUEMA_CAMPOS}},
        messages=[{"role": "user", "content": blocos}],
    )
    texto = next((b.text for b in msg.content if b.type == "text"), "")
    try:
        bruto = json.loads(texto)
    except json.JSONDecodeError:
        bruto = {}
    uso = {"entrada": msg.usage.input_tokens or 0, "saida": msg.usage.output_tokens or 0}
    return limpar_campos(bruto), uso


def aplicar_campos(r: dict, campos: dict) -> list[str]:
    """Preenche no registro só o que está null; se endereço/bairro/cidade entraram, zera a geocodificação
    de precisão baixa para o próximo passo geocodificar de novo. Devolve os campos preenchidos."""
    antes = {k: r.get(k) for k in campos}
    completar(r, preencher_null_com={k: v for k, v in campos.items() if k in r})
    preenchidos = [k for k in campos if antes.get(k) is None and r.get(k) is not None]
    if any(k in preenchidos for k in ("endereco", "bairro", "cidade")) and r.get("geo_precisao") not in (None, "endereco"):
        r["lat"] = r["lng"] = r["geo_precisao"] = None
    if preenchidos:
        preencher_derivados(r)
    return preenchidos


def carregar_campos_guardados() -> dict[str, dict]:
    """{id: campos} de todos os relatórios já gerados (collector/cache/relatorios/*.json)."""
    saida: dict[str, dict] = {}
    if not PASTA.exists():
        return saida
    for p in PASTA.glob("*.json"):
        if p.name.startswith("_"):
            continue
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if d.get("campos"):
            saida[d.get("id") or p.stem] = d["campos"]
    return saida


def aplicar_campos_guardados(registros: list[dict]) -> int:
    """Etapa da coleta diária: aplica aos registros os campos estruturados dos relatórios já gerados."""
    guardados = carregar_campos_guardados()
    if not guardados:
        return 0
    n = 0
    for r in registros:
        c = guardados.get(r["id"])
        if c and aplicar_campos(r, c):
            n += 1
    return n


# ---------------------------------------------------------------- geração ---------------------------

def _usage_total(msg, acumulado: dict) -> None:
    u = msg.usage
    acumulado["entrada"] += (u.input_tokens or 0) + (getattr(u, "cache_read_input_tokens", 0) or 0) + (getattr(u, "cache_creation_input_tokens", 0) or 0)
    acumulado["saida"] += u.output_tokens or 0
    stu = getattr(u, "server_tool_use", None)
    acumulado["buscas"] += (getattr(stu, "web_search_requests", 0) or 0) if stu else 0


def gerar(r: dict, docs, client, modelo: str = MODELO) -> dict:
    """Chama o modelo (com busca na web) e devolve {markdown, uso, custo_usd, fontes}. `docs`: documentos
    (dicts de documentos_do_imovel: texto ou PDF digitalizado) ou textos."""
    # o bloco com os documentos fica em cache: a busca na web roda em várias iterações servidoras e cada
    # continuação reenvia o contexto inteiro; com cache, as repetições custam 10 % do preço de entrada
    mensagens = [{"role": "user", "content": montar_conteudo(r, _normalizar_docs(docs))}]
    uso = {"entrada": 0, "saida": 0, "buscas": 0}
    fontes: list[dict] = []
    texto_final = ""
    for _ in range(6):  # pause_turn: a API retoma de onde parou quando reenviamos o histórico
        with client.messages.stream(
            model=modelo, max_tokens=MAX_TOKENS, system=SISTEMA, messages=mensagens,
            thinking={"type": "adaptive"}, output_config={"effort": "medium"},  # high gerou 14 mil tokens de saída
            tools=[{"type": "web_search_20260209", "name": "web_search", "max_uses": MAX_BUSCAS,
                    "user_location": {"type": "approximate", "country": "BR", "city": r.get("cidade") or "Vitória", "region": r.get("uf") or "ES"}}],
        ) as stream:
            msg = stream.get_final_message()
        _usage_total(msg, uso)
        for b in msg.content:
            if b.type == "text":
                texto_final += b.text
                for c in getattr(b, "citations", None) or []:
                    url, titulo = getattr(c, "url", None), getattr(c, "title", None)
                    if url and url not in {f["url"] for f in fontes}:
                        fontes.append({"url": url, "titulo": titulo or url})
        if msg.stop_reason == "pause_turn":
            mensagens.append({"role": "assistant", "content": msg.content})
            continue
        if msg.stop_reason == "refusal":
            texto_final += "\n\n_O modelo recusou parte da análise (stop_reason=refusal)._"
        break
    markdown = anonimizar(texto_final.strip(), protegidos=[r.get("cidade"), r.get("bairro"), r.get("leiloeiro"), r.get("comitente"), r.get("endereco")])
    # o modelo às vezes emenda o texto no título ("## Referência de mercadoO preço..."): separa
    for titulo in ("Resumo do lote", "Conta no lance mínimo", "Referência de mercado", "Sinais vermelhos", "Veredito"):
        markdown = re.sub(rf"^(## {re.escape(titulo)})(?=\S)", r"\1\n", markdown, flags=re.M)
    if fontes and "Fontes" not in markdown[-600:] and "Sources" not in markdown[-600:]:
        markdown += "\n\nFontes:\n" + "\n".join(f"- [{f['titulo']}]({f['url']})" for f in fontes[:10])
    return {"markdown": markdown, "uso": uso, "custo_usd": custo_usd(modelo, uso["entrada"], uso["saida"], uso["buscas"]), "fontes": fontes}


def enviar_ao_worker(item: dict) -> bool:
    """Grava o parecer no banco do Worker (POST /interno/relatorio). Devolve False quando o Worker não
    está configurado (WORKER_URL + INTERNO_SECRET)."""
    url, segredo = os.environ.get("WORKER_URL", "").rstrip("/"), os.environ.get("INTERNO_SECRET", "")
    if not url or not segredo:
        return False
    import urllib.request
    corpo = {k: item.get(k) for k in ("id", "gerado_em", "modelo", "custo_usd", "documentos_lidos", "uso", "campos", "markdown")}
    req = urllib.request.Request(f"{url}/interno/relatorio", data=json.dumps(corpo, ensure_ascii=False).encode("utf-8"),
                                 headers={"Content-Type": "application/json", "X-Interno": segredo, "User-Agent": "aysha-leiloes-relatorio"}, method="POST")
    with urllib.request.urlopen(req, timeout=60) as resp:
        if resp.status != 200:
            raise RuntimeError(f"Worker respondeu {resp.status}")
    return True


def baixar_do_worker(id_: str) -> dict:
    """Relatório guardado no Worker (GET /interno/relatorio/<id>), com o texto."""
    import urllib.parse
    import urllib.request
    url, segredo = os.environ.get("WORKER_URL", "").rstrip("/"), os.environ.get("INTERNO_SECRET", "")
    if not url or not segredo:
        raise RuntimeError("WORKER_URL/INTERNO_SECRET ausentes")
    req = urllib.request.Request(f"{url}/interno/relatorio/{urllib.parse.quote(id_, safe='')}",
                                 headers={"X-Interno": segredo, "User-Agent": "aysha-leiloes-relatorio"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def completar_campos_faltantes(base: dict | None = None) -> int:
    """Relatórios já gerados cuja extração de campos falhou (campos = null): baixa o texto do Worker,
    extrai os campos, regrava os metadados e reenvia ao Worker."""
    base = base or _carregar_base()
    import anthropic
    client = anthropic.Anthropic()
    config = yaml.safe_load((RAIZ / "collector" / "config.yaml").read_text(encoding="utf-8"))
    cliente = cliente_do_config(config)
    n = 0
    for p in sorted(PASTA.glob("*.json")) if PASTA.exists() else []:
        meta = json.loads(p.read_text(encoding="utf-8"))
        r = base.get(meta.get("id"))
        if meta.get("campos") is not None or not r:
            continue
        try:
            item = baixar_do_worker(meta["id"])
            if item.get("campos") is not None:  # o Worker já tem (corrida anterior que não chegou a commitar)
                campos, uso = item["campos"], {"entrada": 0, "saida": 0}
            else:
                textos = textos_dos_documentos(r, cliente, config)
                campos, uso = extrair_campos(r, textos, item.get("markdown", ""), client)
        except Exception:
            log.exception("campos de %s não extraídos", meta["id"])
            continue
        meta["campos"] = campos
        meta["custo_usd"] = round((meta.get("custo_usd") or 0) + custo_usd(MODELO_CAMPOS, uso["entrada"], uso["saida"], 0), 4)
        enviar_ao_worker({**item, "campos": campos, "custo_usd": meta["custo_usd"]})
        p.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
        n += 1
        log.info("campos de %s: %s", meta["id"], ", ".join(sorted(campos)) or "nenhum")
    return n


def _metadados(item: dict) -> dict:
    return {k: item.get(k) for k in ("id", "gerado_em", "modelo", "documentos_lidos", "documentos", "uso", "custo_usd", "fontes", "campos")}


def _guardar(item: dict) -> None:
    """Metadados + campos no cache versionado (sem o texto); texto no Worker ou, sem Worker, em pasta local."""
    PASTA.mkdir(parents=True, exist_ok=True)
    (PASTA / f"{_nome_arquivo(item['id'])}.json").write_text(json.dumps(_metadados(item), ensure_ascii=False, indent=1), encoding="utf-8")
    if not enviar_ao_worker(item):
        PASTA_LOCAL.mkdir(parents=True, exist_ok=True)
        (PASTA_LOCAL / f"{_nome_arquivo(item['id'])}.json").write_text(json.dumps(item, ensure_ascii=False, indent=1), encoding="utf-8")
        log.warning("WORKER_URL/INTERNO_SECRET ausentes: parecer de %s guardado só em %s", item["id"], PASTA_LOCAL)


def gerar_e_gravar(id_: str, base: dict | None = None, forcar: bool = False) -> dict:
    base = base or _carregar_base()
    if id_ not in base:
        raise KeyError(f"imóvel {id_} não está na base")
    r = base[id_]
    id_ = r["id"]  # id principal, quando o pedido veio com o id de uma fonte absorvida
    if r.get("fonte") == "caixa" and not r.get("url_matricula"):  # bases anteriores a 2026-10-24 não traziam a URL
        from .sources.caixa import url_matricula_de
        r["url_matricula"] = url_matricula_de(id_.split("-", 1)[1], r.get("uf"))
    meta_existente = PASTA / f"{_nome_arquivo(id_)}.json"
    if meta_existente.exists() and not forcar:
        log.info("relatório de %s já foi gerado; nada a fazer", id_)
        return json.loads(meta_existente.read_text(encoding="utf-8"))
    config = yaml.safe_load((RAIZ / "collector" / "config.yaml").read_text(encoding="utf-8"))
    cliente = cliente_do_config(config)
    docs = documentos_do_imovel(r, cliente, config)
    import anthropic
    client = anthropic.Anthropic()
    res = gerar(r, docs, client)
    campos, uso_campos = {}, {"entrada": 0, "saida": 0}
    try:
        campos, uso_campos = extrair_campos(r, docs, res["markdown"], client)
    except Exception:
        log.exception("extração de campos estruturados de %s falhou (o parecer segue)", id_)
    custo = round(res["custo_usd"] + custo_usd(MODELO_CAMPOS, uso_campos["entrada"], uso_campos["saida"], 0), 4)
    item = {"id": id_, "gerado_em": datetime.now().isoformat(timespec="seconds"), "modelo": MODELO,
            "documentos_lidos": len(docs), "documentos": [{"url": d["url"], "paginas": d["paginas"], "modo": "pdf" if d["escaneado"] else "texto"} for d in docs],
            "uso": {**res["uso"], "campos": uso_campos}, "custo_usd": custo, "fontes": res["fontes"],
            "campos": campos, "markdown": res["markdown"]}
    _guardar(item)
    _registrar_custo(item)
    log.info("relatório de %s gerado: %d docs, %d/%d tokens, %d buscas, %d campos estruturados, US$ %.4f", id_, len(docs),
             res["uso"]["entrada"], res["uso"]["saida"], res["uso"]["buscas"], len(campos), custo)
    return item


def migrar_relatorios_antigos(base: dict | None = None) -> int:
    """Relatórios gerados quando ainda eram servidos pelo site público: envia o texto ao Worker, extrai os
    campos estruturados (se houver chave) e apaga o arquivo público. Idempotente."""
    base = base or _carregar_base()
    if not PASTA_PUBLICA_ANTIGA.exists():
        return 0
    client = None
    if os.environ.get("ANTHROPIC_API_KEY"):
        import anthropic
        client = anthropic.Anthropic()
    config = yaml.safe_load((RAIZ / "collector" / "config.yaml").read_text(encoding="utf-8"))
    cliente = cliente_do_config(config)
    n = 0
    for p in sorted(PASTA_PUBLICA_ANTIGA.glob("*.json")):
        if p.name.startswith("_"):
            p.unlink()
            continue
        item = json.loads(p.read_text(encoding="utf-8"))
        r = base.get(item.get("id"))
        if client and r and not item.get("campos"):
            try:
                textos = textos_dos_documentos(r, cliente, config)
                item["campos"], uso = extrair_campos(r, textos, item.get("markdown", ""), client)
                item["custo_usd"] = round((item.get("custo_usd") or 0) + custo_usd(MODELO_CAMPOS, uso["entrada"], uso["saida"], 0), 4)
            except Exception:
                log.exception("campos de %s não extraídos na migração", item.get("id"))
        if not enviar_ao_worker(item):
            log.error("Worker não configurado: %s não migrado", p.name)
            continue
        PASTA.mkdir(parents=True, exist_ok=True)
        (PASTA / p.name).write_text(json.dumps(_metadados(item), ensure_ascii=False, indent=1), encoding="utf-8")
        p.unlink()
        n += 1
        log.info("migrado: %s (%d campos)", item.get("id"), len(item.get("campos") or {}))
    if not any(PASTA_PUBLICA_ANTIGA.iterdir()):
        PASTA_PUBLICA_ANTIGA.rmdir()
    return n


def _nome_arquivo(id_: str) -> str:
    return re.sub(r"[^\w.\-]", "_", id_)


def _registrar_custo(item: dict) -> None:
    p = RAIZ / "docs" / "data" / "custo_relatorios.json"
    dados = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {"relatorios": []}
    dados["relatorios"].append({k: item[k] for k in ("id", "gerado_em", "modelo", "uso", "custo_usd")})
    dados["total_usd"] = round(sum(x["custo_usd"] for x in dados["relatorios"]), 4)
    dados["hoje"] = {"data": date.today().isoformat(), "n": sum(1 for x in dados["relatorios"] if x["gerado_em"][:10] == date.today().isoformat())}
    p.write_text(json.dumps(dados, ensure_ascii=False, indent=1), encoding="utf-8")


def gerados_hoje() -> int:
    p = RAIZ / "docs" / "data" / "custo_relatorios.json"
    if not p.exists():
        return 0
    d = json.loads(p.read_text(encoding="utf-8"))
    return d.get("hoje", {}).get("n", 0) if d.get("hoje", {}).get("data") == date.today().isoformat() else 0


def main(argv=None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s", stream=sys.stdout)
    argv = argv if argv is not None else sys.argv[1:]
    if not argv:
        print(__doc__)
        return 2
    if argv[0] == "--migrar":
        n = migrar_relatorios_antigos()
        log.info("%d relatório(s) migrado(s) para o Worker", n)
        return 0
    if argv[0] == "--campos":
        n = completar_campos_faltantes()
        log.info("campos estruturados completados em %d relatório(s)", n)
        return 0
    # "--refazer" gera de novo mesmo que já exista (ex.: documento que antes não era lido);
    # "--" separa opções de ids: tudo depois dele é id, mesmo que comece com "-"
    forcar = argv[0] == "--refazer"
    if forcar:
        argv = argv[1:]
    ids = argv[1:] if argv and argv[0] == "--" else argv
    ruins = [i for i in ids if i.startswith("-")]
    if ruins:
        log.error("ids inválidos (começam com '-'): %s", ruins)
        return 2
    config = yaml.safe_load((RAIZ / "collector" / "config.yaml").read_text(encoding="utf-8")).get("relatorios", {})
    teto = config.get("maximo_por_dia", 100)
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY ausente")
        return 1
    base = _carregar_base()
    ok = 0
    for id_ in ids:
        if gerados_hoje() >= teto:
            log.warning("teto diário de %d relatórios atingido; %s fica para amanhã", teto, id_)
            break
        try:
            gerar_e_gravar(id_, base, forcar=forcar)
            ok += 1
        except Exception:
            log.exception("relatório de %s falhou", id_)
    try:
        alertar_custo(config)
    except Exception:
        log.exception("alerta de custo falhou")
    return 0 if ok else 1


def alertar_custo(cfg: dict) -> bool:
    """Avisa o mantenedor por e-mail (via Worker) quando o custo do dia passa do teto configurado
    (relatorios.alerta_custo_usd_dia, padrão US$ 10). No máximo um aviso por dia."""
    p = RAIZ / "docs" / "data" / "custo_relatorios.json"
    if not p.exists():
        return False
    dados = json.loads(p.read_text(encoding="utf-8"))
    hoje = date.today().isoformat()
    teto = float(cfg.get("alerta_custo_usd_dia", 10))
    do_dia = [x for x in dados.get("relatorios", []) if x.get("gerado_em", "")[:10] == hoje]
    custo_dia = round(sum(x.get("custo_usd") or 0 for x in do_dia), 4)
    if custo_dia < teto or dados.get("alerta_enviado_em") == hoje:
        return False
    url, segredo = os.environ.get("WORKER_URL", "").rstrip("/"), os.environ.get("INTERNO_SECRET", "")
    if not url or not segredo:
        return False
    import urllib.request
    texto = (f"Custo das análises com IA hoje ({hoje}): US$ {custo_dia:.2f} em {len(do_dia)} relatório(s); teto de alerta US$ {teto:.2f}.\n"
             f"Total acumulado: US$ {dados.get('total_usd', 0):.2f}.\n"
             "Se for abuso, baixe LIMITE_DIA no Worker (wrangler.toml) ou pause o workflow relatorio.yml.")
    req = urllib.request.Request(f"{url}/interno/alerta", data=json.dumps({"assunto": f"custo do dia US$ {custo_dia:.2f}", "texto": texto}).encode("utf-8"),
                                 headers={"Content-Type": "application/json", "X-Interno": segredo, "User-Agent": "aysha-leiloes-relatorio"}, method="POST")
    with urllib.request.urlopen(req, timeout=30):
        pass
    dados["alerta_enviado_em"] = hoje
    p.write_text(json.dumps(dados, ensure_ascii=False, indent=1), encoding="utf-8")
    log.warning("alerta de custo enviado: US$ %.2f hoje", custo_dia)
    return True


if __name__ == "__main__":
    sys.exit(main())
