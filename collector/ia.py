"""Etapa de IA — DESLIGADA por padrão e SEM chamada à API implementada.

O que já existe aqui é só a parte determinística e barata, para medir o que a IA teria de fazer:
- `candidatos()`: quais imóveis passariam no filtro (UF/cidade/desconto, campos de alto valor ainda null,
  documento com hash ainda não processado no cache);
- `trechos_relevantes()`: recorte do texto do edital em torno das palavras-chave (2 linhas de contexto),
  limitado a N caracteres, sem cabeçalhos/rodapés/linhas repetidas;
- `estimativa()`: tokens e custo estimados por imóvel e por execução, para aprovação antes de ligar.

A chamada real (Batch API da Anthropic, modelo Haiku, prompt de sistema fixo cacheável, uma chamada por
imóvel, max_tokens≈400, cache permanente em collector/cache/ia/<hash>.json, teto diário de chamadas e de
custo, registro em docs/data/custo_ia.json) só será implementada depois da aprovação da estimativa.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from collections import Counter
from datetime import datetime
from pathlib import Path

from .schema import sem_acentos

log = logging.getLogger(__name__)

# Preço de lista por milhão de tokens (US$) usado só na estimativa; confirmar na doc antes de ligar.
PRECO_ENTRADA_USD_POR_MTOK = 1.00
PRECO_SAIDA_USD_POR_MTOK = 5.00
DESCONTO_BATCH = 0.5
TOKENS_SISTEMA = 350  # prompt fixo + esquema de saída (cacheado após a 1ª chamada do dia)


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
    """Aproximação para português: ~3,5 caracteres por token."""
    return int(len(texto) / 3.5) + 1


def estimativa(registros: list[dict], cfg_ia: dict, caracteres_por_documento: int | None = None) -> dict:
    """Estimativa de tokens/custo por imóvel e por execução, com os limites do config."""
    lista = candidatos(registros, cfg_ia)
    chars = caracteres_por_documento or cfg_ia.get("max_caracteres_entrada", 6000)
    tokens_entrada_imovel = estimar_tokens("x" * chars) + 60  # texto + instrução curta variável
    tokens_saida_imovel = cfg_ia.get("max_tokens_saida", 400)
    n = min(len(lista), cfg_ia.get("limite_chamadas_por_execucao", 50))
    custo_imovel = (tokens_entrada_imovel * PRECO_ENTRADA_USD_POR_MTOK + tokens_saida_imovel * PRECO_SAIDA_USD_POR_MTOK) / 1e6
    custo_batch = custo_imovel * DESCONTO_BATCH
    return {
        "gerado_em": datetime.now().isoformat(timespec="seconds"),
        "modelo": cfg_ia.get("modelo"),
        "candidatos_hoje": len(lista),
        "chamadas_por_execucao_max": n,
        "tokens_sistema_cacheados": TOKENS_SISTEMA,
        "tokens_entrada_por_imovel": tokens_entrada_imovel,
        "tokens_saida_por_imovel_max": tokens_saida_imovel,
        "custo_usd_por_imovel_tempo_real": round(custo_imovel, 5),
        "custo_usd_por_imovel_batch": round(custo_batch, 5),
        "custo_usd_por_execucao_tempo_real": round(custo_imovel * n, 4),
        "custo_usd_por_execucao_batch": round(custo_batch * n, 4),
        "custo_usd_mes_batch_30_execucoes": round(custo_batch * n * 30, 2),
        "observacao": "Primeira execução processa a fila inteira (limitada ao teto diário); depois só imóveis novos ou com edital alterado.",
    }


def executar(registros: list[dict], cfg_ia: dict, pasta_saida: Path) -> dict:
    """Ponto de entrada chamado pelo main. Hoje só grava a estimativa; não chama API."""
    est = estimativa(registros, cfg_ia)
    (pasta_saida / "custo_ia.json").parent.mkdir(parents=True, exist_ok=True)
    custo_path = pasta_saida / "custo_ia.json"
    anterior = json.loads(custo_path.read_text(encoding="utf-8")) if custo_path.exists() else {"execucoes": []}
    anterior["estimativa_atual"] = est
    anterior["habilitada"] = bool(cfg_ia.get("ia_habilitada"))
    anterior["aviso"] = "Chamada à API ainda não implementada: aguarda aprovação da estimativa."
    custo_path.write_text(json.dumps(anterior, ensure_ascii=False, indent=1), encoding="utf-8")
    if cfg_ia.get("ia_habilitada"):
        log.warning("ia_habilitada=true, mas a chamada à API ainda não foi implementada (aguarda aprovação de custo)")
    return est
