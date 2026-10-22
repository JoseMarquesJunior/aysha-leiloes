"""Etapa de IA: preenche só os campos de alto valor que nem a fonte nem o regex resolveram.

Regras de economia (todas obrigatórias, ver README):
- desligada por padrão: só roda com ANTHROPIC_API_KEY no ambiente e `ia_habilitada: true` no config;
- modelo mais barato (Haiku), nunca Sonnet/Opus; pensamento desligado, effort baixo, max_tokens curto;
- só imóveis no filtro (UF/cidades/desconto mínimo) com algum campo de alto valor ainda null e com
  documento (edital/matrícula em PDF) legível; um documento nunca é processado duas vezes
  (cache permanente em collector/cache/ia/<hash>.json, commitado);
- entrada mínima: só trechos com palavras-chave (2 linhas de contexto), sem cabeçalhos/rodapés,
  limitada a `max_caracteres_entrada`;
- uma chamada por imóvel, prompt de sistema fixo e cacheável, saída JSON com esquema;
- Batch API (50 % de desconto): a fila do dia vira um lote; o resultado é lido na própria execução se
  ficar pronto em `esperar_lote_minutos`, senão na execução seguinte (lotes pendentes em
  collector/cache/ia/_lotes.json);
- tetos por execução: `limite_chamadas_por_execucao` e `limite_custo_usd_por_execucao`; o que sobra
  fica para o dia seguinte, priorizado por maior desconto;
- registro em docs/data/custo_ia.json (chamadas, tokens, cache hits, custo estimado por execução);
- a IA nunca sobrescreve campo já preenchido; nomes de pessoas físicas são removidos antes de salvar.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import time
from collections import Counter
from datetime import date, datetime
from pathlib import Path

from .schema import completar, sem_acentos

log = logging.getLogger(__name__)

# Preço de lista (US$ por milhão de tokens, prompts até 100K) e desconto da Batch API.
PRECOS_USD_MTOK = {"claude-haiku-5-5": (0.10, 0.50)}
DESCONTO_BATCH = 0.5
TOKENS_SISTEMA = 420  # prompt fixo + esquema (estimativa)
CARACTERES_POR_TOKEN = 3.5

CAMPOS_IA = ("ocupado", "debitos_iptu_por_conta_de", "debitos_condominio_por_conta_de",
             "aceita_financiamento", "aceita_fgts", "comissao_leiloeiro_pct")

SISTEMA = (
    "Você extrai dados de editais e matrículas de leilões de imóveis no Brasil. Receberá trechos do "
    "documento e responderá SOMENTE com um JSON no esquema pedido, sem explicações.\n"
    "Regras: use null quando o documento não disser; nunca invente; copie em cada trecho_fonte até 200 "
    "caracteres literais do documento que sustentam o valor; não inclua nomes de pessoas físicas "
    "(substitua por [nome]); valores possíveis para débitos: 'vendedor' (quem vende/comitente/credor "
    "assume), 'comprador' (arrematante/adquirente assume) ou null; comissao_leiloeiro_pct em número "
    "(5 para 5%); onus_na_matricula lista termos curtos como penhora, hipoteca, usufruto, "
    "indisponibilidade, alienação fiduciária, arresto; alertas lista frases curtas sobre riscos "
    "relevantes para quem compra (ocupação, débitos, ônus, prazos, restrições)."
)

ESQUEMA = {
    "type": "object",
    "properties": {
        "ocupado": {"type": ["boolean", "null"]},
        # enum + tipo nulo exige anyOf (a API rejeita enum junto com type ['string','null'])
        "debitos_iptu_por_conta_de": {"anyOf": [{"type": "string", "enum": ["vendedor", "comprador"]}, {"type": "null"}]},
        "debitos_condominio_por_conta_de": {"anyOf": [{"type": "string", "enum": ["vendedor", "comprador"]}, {"type": "null"}]},
        "aceita_financiamento": {"type": ["boolean", "null"]},
        "aceita_fgts": {"type": ["boolean", "null"]},
        "comissao_leiloeiro_pct": {"type": ["number", "null"]},
        "onus_na_matricula": {"type": "array", "items": {"type": "string"}},
        "alertas": {"type": "array", "items": {"type": "string"}},
        "trechos_fonte": {
            "type": "object",
            "properties": {c: {"type": ["string", "null"]} for c in CAMPOS_IA + ("onus_na_matricula",)},
            "required": list(CAMPOS_IA + ("onus_na_matricula",)),
            "additionalProperties": False,
        },
    },
    "required": list(CAMPOS_IA) + ["onus_na_matricula", "alertas", "trechos_fonte"],
    "additionalProperties": False,
}


# ---------------------------------------------------------------- seleção e recorte ----------

def hash_documento(texto: str | bytes) -> str:
    if isinstance(texto, str):
        texto = texto.encode("utf-8")
    return hashlib.sha256(texto).hexdigest()[:24]


def no_cache(pasta_cache: str | Path, h: str) -> dict | None:
    p = Path(pasta_cache) / f"{h}.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def passa_filtro(r: dict, filtro: dict) -> bool:
    ufs = filtro.get("ufs") or []
    if ufs and r.get("uf") not in ufs:
        return False
    cidades = [sem_acentos(c).lower() for c in (filtro.get("cidades") or [])]
    if cidades and sem_acentos(r.get("cidade") or "").lower() not in cidades:
        return False
    minimo = filtro.get("desconto_minimo_pct")
    if minimo is not None and (r.get("desconto_pct") is None or r["desconto_pct"] < minimo):
        return False
    return True


def precisa_de_ia(r: dict, campos_alto_valor: list[str]) -> bool:
    for c in campos_alto_valor:
        if c == "onus_na_matricula":
            if not (r.get("extracao_ia") or {}).get("onus_na_matricula"):
                return True
        elif r.get(c) is None:
            return True
    return False


def candidatos(registros: list[dict], cfg_ia: dict) -> list[dict]:
    """Imóveis que iriam para a IA, ordenados por maior desconto (prioridade da fila)."""
    campos = cfg_ia.get("campos_alto_valor", [])
    lista = [r for r in registros if r.get("ativo", True) and passa_filtro(r, cfg_ia.get("filtro", {}))
             and precisa_de_ia(r, campos)]
    lista.sort(key=lambda r: -(r.get("desconto_pct") or 0))
    return lista


def _limpar_linhas(texto: str) -> list[str]:
    linhas = [re.sub(r"\s+", " ", l).strip() for l in texto.splitlines()]
    contagem = Counter(l for l in linhas if l)
    saida = []
    for l in linhas:
        if not l:
            continue
        if contagem[l] > 2:  # cabeçalho/rodapé repetido em cada página
            continue
        if re.fullmatch(r"(p[áa]gina\s*)?\d+(\s*(de|/)\s*\d+)?", l, re.I):  # numeração
            continue
        saida.append(l)
    return saida


def trechos_relevantes(texto: str, palavras_chave: list[str], max_caracteres: int = 6000, contexto: int = 2) -> str:
    """Só as linhas com palavra-chave e `contexto` linhas ao redor, sem repetições, até max_caracteres."""
    if not texto:
        return ""
    linhas = _limpar_linhas(texto)
    chaves = [sem_acentos(p).lower() for p in palavras_chave]
    marcadas: set[int] = set()
    for i, l in enumerate(linhas):
        ln = sem_acentos(l).lower()
        if any(c in ln for c in chaves):
            for j in range(max(0, i - contexto), min(len(linhas), i + contexto + 1)):
                marcadas.add(j)
    partes = []
    anterior = -2
    for i in sorted(marcadas):
        if i != anterior + 1 and partes:
            partes.append("…")
        partes.append(linhas[i])
        anterior = i
    recorte = "\n".join(partes)
    return recorte[:max_caracteres]


def estimar_tokens(texto: str) -> int:
    return int(len(texto) / CARACTERES_POR_TOKEN) + 1


def texto_de_entrada(r: dict, textos_documentos: list[str], cfg_ia: dict) -> str:
    """Cabeçalho curto com o que já se sabe + trechos relevantes dos documentos."""
    cab = (f"Imóvel: {r.get('tipo') or '?'} em {r.get('cidade') or '?'}/{r.get('uf') or '?'}; "
           f"natureza: {r.get('natureza') or '?'}; lance mínimo: {r.get('valor_minimo') or '?'}; "
           f"data do leilão: {r.get('data_leilao') or '?'}.")
    desc = (r.get("descricao_original") or "")[:800]
    recorte = trechos_relevantes("\n".join(textos_documentos), cfg_ia.get("palavras_chave", []),
                                 cfg_ia.get("max_caracteres_entrada", 6000))
    return f"{cab}\nAnúncio: {desc}\n\nTrechos do documento:\n{recorte}".strip()


# ---------------------------------------------------------------- nomes de pessoas -----------

_PREFIXOS_OK = r"(?:rua|r\.|avenida|av\.|travessa|praca|alameda|estrada|rodovia|bairro|loteamento|edificio|ed\.|condominio|cond\.|residencial|jardim|vila|cartorio|oficio|comarca|vara|juizo|tribunal|justica|banco|caixa|banestes|bandes|cooperativa|sicoob|leiloeir[oa]|leiloes|municipio|cidade|estado)"
_ENTIDADE = re.compile(r"\b(condominio|conj|res|residencial|edificio|parque|jardim|vila|praia|mata|bosque|morro|centro|fazenda|nacional|uniao|procuradoria|banco|caixa|banestes|bandes|leil|juizado|vara|cartorio|oficio|tribunal|justica|federal|estadual|municipal|prefeitura|secretaria|cooperativa|sicoob|companhia|cia|ltda|s\.?a\.?|empreendimentos|incorporadora|construtora|imobiliaria|shopping|hospital|escola|igreja|associacao|sindicato|instituto|fundacao)\b")
_NOME = re.compile(r"\b([A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]{2,}(?:\s+(?:d[aeo]s?\s+)?[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]{2,}){1,4})\b")


def remover_nomes(texto: str | None) -> str | None:
    """Substitui sequências que parecem nome de pessoa (2+ palavras capitalizadas fora de contexto de
    endereço/órgão) por [nome] e apaga CPFs. Conservador: pode deixar passar nomes em caixa alta e
    pode mascarar nomes de ruas sem prefixo; o campo é só apoio e aponta para o documento original."""
    if not texto:
        return texto
    t = re.sub(r"\bCPF\s*(?:n[ºo.]?\s*)?[\d.\-]{11,14}\b", "[CPF]", texto, flags=re.I)
    t = re.sub(r"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b", "[CPF]", t)

    def troca(m):
        primeira = sem_acentos(m.group(0).split()[0]).lower()
        if re.fullmatch(_PREFIXOS_OK, primeira):  # "Rua Monte Castelo", "Caixa Econômica Federal"
            return m.group(0)
        if _ENTIDADE.search(sem_acentos(m.group(0)).lower()):  # "Conj. Res. Mata da Praia III", "Procuradoria da Fazenda Nacional"
            return m.group(0)
        antes = sem_acentos(t[max(0, m.start() - 40):m.start()]).lower()
        if re.search(_PREFIXOS_OK + r"\s*(?:d[aeo]s?\s+)?$", antes):
            return m.group(0)
        return "[nome]"
    return _NOME.sub(troca, t)


def _limpar_resultado(res: dict) -> dict:
    limpo = {}
    for c in CAMPOS_IA:
        v = res.get(c)
        if c in ("debitos_iptu_por_conta_de", "debitos_condominio_por_conta_de") and v not in ("vendedor", "comprador"):
            v = None
        if c == "comissao_leiloeiro_pct" and v is not None:
            try:
                v = float(v)
            except (TypeError, ValueError):
                v = None
        if c in ("ocupado", "aceita_financiamento", "aceita_fgts") and not isinstance(v, bool):
            v = None
        limpo[c] = v
    limpo["onus_na_matricula"] = [remover_nomes(str(x))[:80] for x in (res.get("onus_na_matricula") or []) if x][:10]
    limpo["alertas"] = [remover_nomes(str(x))[:200] for x in (res.get("alertas") or []) if x][:8]
    trechos = res.get("trechos_fonte") or {}
    limpo["trechos_fonte"] = {k: remover_nomes(str(v))[:200] for k, v in trechos.items() if v}
    return limpo


def aplicar_resultado(r: dict, item_cache: dict) -> None:
    """Preenche só o que estava null; guarda tudo em extracao_ia."""
    res = item_cache.get("resultado") or {}
    completar(r, preencher_null_com={c: res.get(c) for c in CAMPOS_IA})
    r["extracao_ia"] = {
        **{c: res.get(c) for c in CAMPOS_IA},
        "onus_na_matricula": res.get("onus_na_matricula") or [],
        "alertas": res.get("alertas") or [],
        "trechos_fonte": res.get("trechos_fonte") or {},
        "modelo": item_cache.get("modelo"),
        "processado_em": item_cache.get("processado_em"),
        "hash_documento": item_cache.get("hash"),
    }


# ---------------------------------------------------------------- documentos ------------------

def textos_dos_documentos(r: dict, cliente, config: dict) -> list[str]:
    """Texto (em cache) dos PDFs de edital e matrícula do imóvel; vazio se não houver PDF legível."""
    from .sources.jfes import texto_do_pdf
    textos = []
    for url in (r.get("url_edital"), r.get("url_matricula")):
        if not url or not url.lower().split("?")[0].endswith(".pdf") and "/documentos/" not in url and "/anexo/" not in url:
            continue
        try:
            t = texto_do_pdf(cliente, url, config)
        except Exception as e:
            log.warning("ia: documento %s ilegível (%s)", url, e)
            continue
        if t and len(t.strip()) > 200:
            textos.append(t)
    return textos


# ---------------------------------------------------------------- custo / estimativa ----------

def _precos(modelo: str) -> tuple[float, float]:
    return PRECOS_USD_MTOK.get(modelo, (0.10, 0.50))


def custo_usd(modelo: str, tokens_entrada: int, tokens_saida: int, batch: bool = True) -> float:
    pe, ps = _precos(modelo)
    c = (tokens_entrada * pe + tokens_saida * ps) / 1e6
    return round(c * (DESCONTO_BATCH if batch else 1), 6)


def estimativa(registros: list[dict], cfg_ia: dict) -> dict:
    lista = candidatos(registros, cfg_ia)
    modelo = cfg_ia.get("modelo", "claude-haiku-5-5")
    chars = cfg_ia.get("max_caracteres_entrada", 6000)
    tok_in = estimar_tokens("x" * chars) + 250 + TOKENS_SISTEMA
    tok_out = cfg_ia.get("max_tokens_saida", 900)
    n = min(len(lista), cfg_ia.get("limite_chamadas_por_execucao", 50))
    por_imovel = custo_usd(modelo, tok_in, tok_out, batch=True)
    return {
        "gerado_em": datetime.now().isoformat(timespec="seconds"),
        "modelo": modelo,
        "candidatos_hoje": len(lista),
        "chamadas_por_execucao_max": n,
        "tokens_sistema_cacheados": TOKENS_SISTEMA,
        "tokens_entrada_por_imovel": tok_in,
        "tokens_saida_por_imovel_max": tok_out,
        "custo_usd_por_imovel_tempo_real": round(custo_usd(modelo, tok_in, tok_out, batch=False), 5),
        "custo_usd_por_imovel_batch": round(por_imovel, 5),
        "custo_usd_por_execucao_tempo_real": round(custo_usd(modelo, tok_in, tok_out, batch=False) * n, 4),
        "custo_usd_por_execucao_batch": round(por_imovel * n, 4),
        "custo_usd_mes_batch_30_execucoes": round(por_imovel * n * 30, 2),
        "observacao": "Teto, com entrada no máximo permitido; na prática só imóveis novos ou com edital alterado entram, e imóveis sem PDF legível não são enviados.",
    }


# ---------------------------------------------------------------- lotes (Batch API) ----------

def _pasta_cache(cfg_ia: dict) -> Path:
    raiz = Path(__file__).resolve().parent.parent
    return raiz / cfg_ia.get("cache", "collector/cache/ia")


def _ler_lotes(pasta: Path) -> dict:
    p = pasta / "_lotes.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {"pendentes": []}


def _gravar_lotes(pasta: Path, dados: dict) -> None:
    (pasta / "_lotes.json").write_text(json.dumps(dados, ensure_ascii=False, indent=1), encoding="utf-8")


def montar_requisicao(h: str, entrada: str, cfg_ia: dict) -> dict:
    """Parâmetros de uma mensagem do lote (sem SDK, para teste); o sistema fixo vai no bloco cacheável."""
    return {
        "custom_id": h,
        "params": {
            "model": cfg_ia.get("modelo", "claude-haiku-5-5"),
            "max_tokens": cfg_ia.get("max_tokens_saida", 900),
            "thinking": {"type": "disabled"},
            "output_config": {"effort": "low", "format": {"type": "json_schema", "schema": ESQUEMA}},
            "system": [{"type": "text", "text": SISTEMA, "cache_control": {"type": "ephemeral"}}],
            "messages": [{"role": "user", "content": entrada}],
        },
    }


def _parsear_mensagem(msg) -> dict | None:
    texto = next((b.text for b in msg.content if b.type == "text"), "")
    try:
        return json.loads(texto)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", texto, re.S)
        return json.loads(m.group(0)) if m else None


def _colher_lote(client, lote: dict, pasta: Path, modelo: str) -> dict | None:
    """Se o lote terminou, grava um arquivo de cache por resultado e devolve o resumo de uso."""
    b = client.messages.batches.retrieve(lote["id"])
    if b.processing_status != "ended":
        return None
    tok_in = tok_out = ok = erro = 0
    for res in client.messages.batches.results(lote["id"]):
        h = res.custom_id
        if res.result.type == "succeeded":
            msg = res.result.message
            dados = _parsear_mensagem(msg)
            if dados is None:
                erro += 1
                continue
            u = msg.usage
            tok_in += (u.input_tokens or 0) + (u.cache_read_input_tokens or 0) + (u.cache_creation_input_tokens or 0)
            tok_out += u.output_tokens or 0
            item = {"hash": h, "modelo": msg.model, "processado_em": datetime.now().isoformat(timespec="seconds"),
                    "lote": lote["id"], "resultado": _limpar_resultado(dados),
                    "uso": {"entrada": u.input_tokens, "saida": u.output_tokens,
                            "cache_lido": u.cache_read_input_tokens, "cache_criado": u.cache_creation_input_tokens}}
            (pasta / f"{h}.json").write_text(json.dumps(item, ensure_ascii=False, indent=1), encoding="utf-8")
            ok += 1
        else:
            erro += 1
            detalhe = getattr(res.result, "error", None)
            log.warning("ia: resultado %s do lote %s: %s %s", h, lote["id"], res.result.type,
                        detalhe.to_dict() if hasattr(detalhe, "to_dict") else detalhe)
    return {"tipo": "lote_concluido", "data": date.today().isoformat(), "lote_id": lote["id"], "chamadas": ok,
            "erros": erro, "tokens_entrada": tok_in, "tokens_saida": tok_out, "cache_hits": 0,
            "custo_usd": custo_usd(modelo, tok_in, tok_out, batch=True)}


# ---------------------------------------------------------------- ponto de entrada ------------

def executar(registros: list[dict], cfg_ia: dict, pasta_saida: Path, cliente=None, config: dict | None = None) -> dict:
    """Chamado pelo main a cada coleta. Sem chave ou com ia_habilitada=false só grava a estimativa."""
    est = estimativa(registros, cfg_ia)
    custo_path = pasta_saida / "custo_ia.json"
    ledger = json.loads(custo_path.read_text(encoding="utf-8")) if custo_path.exists() else {"execucoes": []}
    ledger.setdefault("execucoes", [])
    ledger["estimativa_atual"] = est
    ligada = bool(cfg_ia.get("ia_habilitada")) and bool(os.environ.get("ANTHROPIC_API_KEY"))
    ledger["habilitada"] = ligada
    ledger["aviso"] = None if ligada else ("ia_habilitada=true mas ANTHROPIC_API_KEY ausente: etapa pulada"
                                           if cfg_ia.get("ia_habilitada") else "Etapa desligada no config.")
    pasta = _pasta_cache(cfg_ia)
    pasta.mkdir(parents=True, exist_ok=True)
    modelo = cfg_ia.get("modelo", "claude-haiku-5-5")

    # 1. aplica o que já está no cache (vale mesmo com a IA desligada: resultado pago não se perde)
    filtro = cfg_ia.get("filtro", {})
    campos = cfg_ia.get("campos_alto_valor", [])
    cache_hits = 0
    fila: list[tuple[dict, str, str]] = []   # (registro, hash, entrada)
    sem_documento = 0
    if ligada or any(p.name != "_lotes.json" for p in pasta.glob("*.json")):
        for r in registros:
            if not r.get("ativo", True) or not passa_filtro(r, filtro):
                continue
            textos = textos_dos_documentos(r, cliente, config or {}) if cliente else []
            if not textos:
                sem_documento += 1
                continue
            entrada = texto_de_entrada(r, textos, cfg_ia)
            # a chave do cache é o documento + anúncio, não a entrada inteira: lance e data mudam entre
            # coletas e não justificam reprocessar o mesmo edital
            h = hash_documento("\n".join(textos) + "\n" + (r.get("descricao_original") or "")[:800])
            item = no_cache(pasta, h)
            if item:
                aplicar_resultado(r, item)
                cache_hits += 1
            elif ligada and precisa_de_ia(r, campos):
                fila.append((r, h, entrada))

    resumo = {"tipo": "execucao", "data": date.today().isoformat(), "chamadas": 0, "cache_hits": cache_hits,
              "tokens_entrada": 0, "tokens_saida": 0, "custo_usd": 0.0, "pendentes": 0, "sem_documento": sem_documento}
    if not ligada:
        ledger["execucoes"].append(resumo)
        ledger["execucoes"] = ledger["execucoes"][-400:]
        custo_path.write_text(json.dumps(ledger, ensure_ascii=False, indent=1), encoding="utf-8")
        if cache_hits:
            log.info("ia: %d imóveis preenchidos pelo cache (etapa desligada)", cache_hits)
        return est

    import anthropic  # import tardio: só quem liga a IA precisa do SDK
    client = anthropic.Anthropic()
    lotes = _ler_lotes(pasta)

    # 2. colhe lotes pendentes de execuções anteriores
    ainda_pendentes = []
    for lote in lotes.get("pendentes", []):
        try:
            uso = _colher_lote(client, lote, pasta, modelo)
        except Exception as e:
            log.warning("ia: não foi possível consultar o lote %s: %s", lote.get("id"), e)
            ainda_pendentes.append(lote)
            continue
        if uso is None:
            ainda_pendentes.append(lote)
        else:
            ledger["execucoes"].append(uso)
            log.info("ia: lote %s concluído: %d ok, %d erros, US$ %.4f", lote["id"], uso["chamadas"], uso["erros"], uso["custo_usd"])
    lotes["pendentes"] = ainda_pendentes
    em_andamento = {h for lote in ainda_pendentes for h in lote.get("hashes", [])}

    # 3. aplica resultados recém-colhidos e monta a fila do dia (sem repetir o que está em andamento)
    fila_final = []
    vistos: set[str] = set()
    for r, h, entrada in sorted(fila, key=lambda x: -(x[0].get("desconto_pct") or 0)):
        item = no_cache(pasta, h)
        if item:
            aplicar_resultado(r, item)
            cache_hits += 1
            continue
        if h in em_andamento or h in vistos:
            continue
        vistos.add(h)
        fila_final.append((r, h, entrada))
    limite_n = cfg_ia.get("limite_chamadas_por_execucao", 50)
    limite_usd = cfg_ia.get("limite_custo_usd_por_execucao", 0.5)
    enviar, custo_prev = [], 0.0
    for r, h, entrada in fila_final:
        c = custo_usd(modelo, estimar_tokens(entrada) + TOKENS_SISTEMA, cfg_ia.get("max_tokens_saida", 900), batch=True)
        if len(enviar) >= limite_n or custo_prev + c > limite_usd:
            break
        enviar.append((r, h, entrada))
        custo_prev += c
    pendentes = len(fila_final) - len(enviar)

    # 4. envia o lote
    lote_id = None
    if enviar:
        from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
        from anthropic.types.messages.batch_create_params import Request
        requests = [Request(custom_id=h, params=MessageCreateParamsNonStreaming(**montar_requisicao(h, entrada, cfg_ia)["params"]))
                    for _, h, entrada in enviar]
        try:
            batch = client.messages.batches.create(requests=requests)
            lote_id = batch.id
            lotes["pendentes"].append({"id": lote_id, "criado_em": datetime.now().isoformat(timespec="seconds"),
                                       "hashes": [h for _, h, _ in enviar], "imoveis": [r["id"] for r, _, _ in enviar]})
            log.info("ia: lote %s enviado com %d imóveis (custo previsto US$ %.4f); %d ficaram para amanhã",
                     lote_id, len(enviar), custo_prev, pendentes)
        except Exception as e:
            log.exception("ia: falha ao enviar o lote")
            resumo["erro"] = f"{type(e).__name__}: {e}"[:300]

    # 5. espera um pouco: lotes pequenos costumam terminar em minutos
    espera = cfg_ia.get("esperar_lote_minutos", 10)
    if lote_id and espera:
        fim = time.monotonic() + espera * 60
        while time.monotonic() < fim:
            time.sleep(30)
            lote = lotes["pendentes"][-1]
            try:
                uso = _colher_lote(client, lote, pasta, modelo)
            except Exception as e:
                log.warning("ia: consulta ao lote falhou: %s", e)
                break
            if uso:
                ledger["execucoes"].append(uso)
                lotes["pendentes"].pop()
                for r, h, _ in enviar:
                    item = no_cache(pasta, h)
                    if item:
                        aplicar_resultado(r, item)
                log.info("ia: lote %s concluído nesta execução (%d ok, US$ %.4f)", lote_id, uso["chamadas"], uso["custo_usd"])
                break

    _gravar_lotes(pasta, lotes)
    resumo.update({"chamadas": len(enviar), "cache_hits": cache_hits, "custo_usd": round(custo_prev, 5),
                   "custo_previsto": True, "pendentes": pendentes, "lote_id": lote_id,
                   "lotes_pendentes": [l["id"] for l in lotes["pendentes"]]})
    ledger["execucoes"].append(resumo)
    ledger["execucoes"] = ledger["execucoes"][-400:]
    ledger["lotes_pendentes"] = [l["id"] for l in lotes["pendentes"]]
    custo_path.write_text(json.dumps(ledger, ensure_ascii=False, indent=1), encoding="utf-8")
    return est
