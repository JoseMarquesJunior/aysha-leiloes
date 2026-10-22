"""Análise detalhada de um imóvel com IA (relatório sob demanda), no estilo de um parecer para quem compra.

Diferente da etapa de extração (collector/ia.py, Haiku, campos estruturados), aqui o modelo lê o edital,
a matrícula e o laudo inteiros, pesquisa comparáveis de mercado na web e escreve um parecer em Markdown:
resumo do lote, conta de custos no lance, referência de mercado, sinais vermelhos, veredito e checklist
de diligência. Modelo: Opus 5 (pedido do mantenedor), com busca na web.

Economia: o relatório de cada imóvel é gerado UMA vez e guardado em docs/data/relatorios/<id>.json
(servido estaticamente pelo site). Um novo clique só recupera o arquivo. O custo real (tokens, buscas)
fica registrado no próprio arquivo e em docs/data/custo_relatorios.json.

Uso:  python -m collector.relatorio <id> [<id> ...]   (precisa de ANTHROPIC_API_KEY)
      python -m collector.relatorio --fila             (gera para os ids em docs/data/relatorios/_fila.json)
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

log = logging.getLogger(__name__)

RAIZ = Path(__file__).resolve().parent.parent
PASTA = RAIZ / "docs" / "data" / "relatorios"
MODELO = "claude-opus-5"
PRECOS_USD_MTOK = {"claude-opus-5": (5.0, 25.0), "claude-opus-5-5": (4.0, 20.0)}
PRECO_BUSCA_USD = 0.01  # US$ 10 por mil buscas na web
MAX_BUSCAS = 3   # cada busca devolve páginas inteiras: 6 buscas levaram a 120 mil tokens de entrada no 1º teste
MAX_TOKENS = 9000
MAX_CHARS_DOCUMENTO = 60000  # ~17 mil tokens por documento; acima disso o texto é cortado no fim

SISTEMA = """Você é um analista experiente de leilões de imóveis no Brasil, escrevendo para investidores e pessoas do ramo que vão decidir se dão lance. Você recebe os dados do anúncio e o texto dos documentos (edital, matrícula, laudo) e pode pesquisar na web preços de mercado do bairro e do prédio.

Escreva em português do Brasil, em Markdown, direto e opinativo, no formato abaixo (use exatamente estes títulos de seção):

## Resumo do lote
Endereço, tipo, área, quartos, vaga (própria ou rotativa), estado de conservação, ocupação, matrícula, processo/vara ou comitente, datas e valores (avaliação, 1º e 2º leilão, incremento, comissão, forma de pagamento).

## Conta no lance mínimo
Tabela Markdown com lance, comissão, ITBI (~2%) + registro, reforma estimada (R$/m² por padrão do imóvel), débitos que ficam com o arrematante quando o edital diz isso, e total.

## Referência de mercado
Use a busca na web para achar o preço do m² no bairro e, se possível, anúncios no mesmo prédio ou na mesma rua. Cite as fontes com link. Diga se a avaliação está inflada ou é preço de mercado e qual seria o valor de saída depois de reformado. Seja honesto se não achar comparáveis.

## Sinais vermelhos
Liste e explique os riscos concretos encontrados nos documentos: titularidade irregular (direitos aquisitivos, venda não registrada), terceiros interessados, ônus e penhoras, dívida pequena demais em relação ao bem (risco de remição), processo muito antigo (prescrição intercorrente), débitos propter rem, preço vil, ocupação e desocupação, vaga rotativa, documentos ilegíveis ou ausentes.

## Veredito
Sua leitura: vale entrar, em qual leilão, com qual teto de lance e sob quais condições. Depois, uma lista numerada de diligências antes do lance (certidão atualizada da matrícula com cartório e número, consulta ao processo, IPTU com inscrição, declaração de débitos do condomínio, visita), dizendo o que em cada uma mudaria a decisão.

Regras: nunca invente dados; quando o documento não diz, escreva que não diz. NUNCA escreva nomes de pessoas físicas (executados, terceiros, depositários, titulares): use "o executado", "o terceiro interessado", "o titular registral", "o depositário". Nomes de empresas, bancos, cartórios, condomínios e leiloeiros podem aparecer. Termine com uma linha avisando que não é assessoria jurídica nem recomendação de investimento e que a parte jurídica deve ser validada por um profissional."""


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


def montar_mensagem(r: dict, textos: list[str]) -> str:
    docs = []
    for i, t in enumerate(textos, 1):
        t = re.sub(r"[ \t]+", " ", t)
        if len(t) > MAX_CHARS_DOCUMENTO:
            t = t[:MAX_CHARS_DOCUMENTO] + "\n[... documento cortado por tamanho ...]"
        docs.append(f"### Documento {i}\n{t}")
    return (f"## Dados do anúncio\n{_campos_do_anuncio(r)}\n\n## Documentos (texto extraído dos PDFs)\n"
            + ("\n\n".join(docs) if docs else "(nenhum documento legível)")
            + "\n\nEscreva o parecer no formato pedido.")


def custo_usd(modelo: str, tokens_in: int, tokens_out: int, buscas: int) -> float:
    pe, ps = PRECOS_USD_MTOK.get(modelo, (5.0, 25.0))
    return round((tokens_in * pe + tokens_out * ps) / 1e6 + buscas * PRECO_BUSCA_USD, 4)


_GATILHOS_PESSOA = re.compile(r"\b(executad[oa]s?|exequentes?|terceir[oa]s?|deposit[áa]ri[oa]s?|titular(?:es)?|propriet[áa]ri[oa]s?|c[ôo]njuge|herdeir[oa]s?|esp[óo]lio|adquirente|devedor(?:a|es)?|CPF|falecid[oa]|inventariante|usufrutu[áa]ri[oa]s?|vendedor(?:a|es)?|comprador(?:a|es)?|em nome de|por conta de)\b", re.I)
_CPF = re.compile(r"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b")


def anonimizar(markdown: str) -> str:
    """Segunda barreira contra nomes de pessoas (a primeira é a instrução ao modelo). Só mexe nas linhas que
    falam de partes (executado, terceiro, depositário, titular, CPF...): aplicar o filtro ao texto inteiro
    mascarava condomínios, leiloeiros e varas ("Conj. Res. Mata da Praia III", "5º Juizado")."""
    saida = []
    for linha in markdown.splitlines():
        if "](http" in linha or linha.lstrip().startswith(("http", "Sources", "Fontes")):
            saida.append(linha)  # links e fontes ficam como estão
        elif _GATILHOS_PESSOA.search(linha):
            saida.append(remover_nomes(linha) or "")
        else:
            saida.append(_CPF.sub("[CPF]", linha))
    return "\n".join(saida)


def _usage_total(msg, acumulado: dict) -> None:
    u = msg.usage
    acumulado["entrada"] += (u.input_tokens or 0) + (getattr(u, "cache_read_input_tokens", 0) or 0) + (getattr(u, "cache_creation_input_tokens", 0) or 0)
    acumulado["saida"] += u.output_tokens or 0
    stu = getattr(u, "server_tool_use", None)
    acumulado["buscas"] += (getattr(stu, "web_search_requests", 0) or 0) if stu else 0


def gerar(r: dict, textos: list[str], client, modelo: str = MODELO) -> dict:
    """Chama o modelo (com busca na web) e devolve {markdown, uso, custo_usd, fontes}."""
    mensagens = [{"role": "user", "content": montar_mensagem(r, textos)}]
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
    markdown = anonimizar(texto_final.strip())
    if fontes and "Fontes" not in markdown[-600:] and "Sources" not in markdown[-600:]:
        markdown += "\n\nFontes:\n" + "\n".join(f"- [{f['titulo']}]({f['url']})" for f in fontes[:10])
    return {"markdown": markdown, "uso": uso, "custo_usd": custo_usd(modelo, uso["entrada"], uso["saida"], uso["buscas"]), "fontes": fontes}


def gerar_e_gravar(id_: str, base: dict | None = None, forcar: bool = False) -> dict:
    PASTA.mkdir(parents=True, exist_ok=True)
    base = base or _carregar_base()
    if id_ not in base:
        raise KeyError(f"imóvel {id_} não está na base")
    r = base[id_]
    id_ = r["id"]  # id principal, quando o pedido veio com o id de uma fonte absorvida
    destino = PASTA / f"{_nome_arquivo(id_)}.json"
    if destino.exists() and not forcar:
        log.info("relatório de %s já existe; nada a fazer", id_)
        return json.loads(destino.read_text(encoding="utf-8"))
    config = yaml.safe_load((RAIZ / "collector" / "config.yaml").read_text(encoding="utf-8"))
    cliente = cliente_do_config(config)
    textos = textos_dos_documentos(r, cliente, config)
    import anthropic
    client = anthropic.Anthropic()
    res = gerar(r, textos, client)
    item = {"id": id_, "gerado_em": datetime.now().isoformat(timespec="seconds"), "modelo": MODELO,
            "documentos_lidos": len(textos), "uso": res["uso"], "custo_usd": res["custo_usd"], "fontes": res["fontes"],
            "markdown": res["markdown"]}
    destino.write_text(json.dumps(item, ensure_ascii=False, indent=1), encoding="utf-8")
    _registrar_custo(item)
    _atualizar_indice()
    log.info("relatório de %s gerado: %d docs, %d/%d tokens, %d buscas, US$ %.4f", id_, len(textos),
             res["uso"]["entrada"], res["uso"]["saida"], res["uso"]["buscas"], res["custo_usd"])
    return item


def _nome_arquivo(id_: str) -> str:
    return re.sub(r"[^\w.\-]", "_", id_)


def _registrar_custo(item: dict) -> None:
    p = RAIZ / "docs" / "data" / "custo_relatorios.json"
    dados = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {"relatorios": []}
    dados["relatorios"].append({k: item[k] for k in ("id", "gerado_em", "modelo", "uso", "custo_usd")})
    dados["total_usd"] = round(sum(x["custo_usd"] for x in dados["relatorios"]), 4)
    dados["hoje"] = {"data": date.today().isoformat(), "n": sum(1 for x in dados["relatorios"] if x["gerado_em"][:10] == date.today().isoformat())}
    p.write_text(json.dumps(dados, ensure_ascii=False, indent=1), encoding="utf-8")


def _atualizar_indice() -> None:
    ids = sorted(p.stem for p in PASTA.glob("*.json") if not p.name.startswith("_"))
    (PASTA / "_indice.json").write_text(json.dumps({"ids": ids, "atualizado_em": datetime.now().isoformat(timespec="seconds")},
                                                   ensure_ascii=False), encoding="utf-8")


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
    config = yaml.safe_load((RAIZ / "collector" / "config.yaml").read_text(encoding="utf-8")).get("relatorios", {})
    teto = config.get("maximo_por_dia", 100)
    ids = list(argv)
    if argv[0] == "--fila":
        fila = PASTA / "_fila.json"
        ids = json.loads(fila.read_text(encoding="utf-8")).get("ids", []) if fila.exists() else []
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
            gerar_e_gravar(id_, base)
            ok += 1
        except Exception:
            log.exception("relatório de %s falhou", id_)
    if argv[0] == "--fila":
        (PASTA / "_fila.json").write_text(json.dumps({"ids": [i for i in ids if not (PASTA / f"{_nome_arquivo(i)}.json").exists()]}), encoding="utf-8")
    return 0 if ok or not ids else 1


if __name__ == "__main__":
    sys.exit(main())
