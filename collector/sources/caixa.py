"""Fonte Caixa Econômica Federal: lista oficial de imóveis por UF (CSV).

Arquivo real inspecionado em 2026-10-21 (venda-imoveis.caixa.gov.br/listaweb/Lista_imoveis_ES.csv):
- codificação latin-1, separador ';', sem aspas;
- linha 1 vazia; linha 2 ' Lista de Imóveis da Caixa;;Data de geração:;20/10/2026;...';
- linha 3 = cabeçalho; linha 4 vazia; depois uma linha por imóvel;
- colunas: N° do imóvel; UF; Cidade; Bairro; Endereço; Preço; Valor de avaliação; Desconto;
  Financiamento; Descrição; Modalidade de venda; Link de acesso
- Descrição: "Apartamento, 84.78 de área total, 67.20 de área privativa, 0.00 de área do terreno,
  2 qto(s), varanda, a.serv, WC, 1 sala(s), cozinha, 1 vaga(s) de garagem." (0.00 = desconhecido)
- Preço/avaliação em formato brasileiro (1.234,56); Desconto com ponto decimal (38.95), 0.00 quando o
  preço supera a avaliação (ocorre em leilões SFI, cujo lance mínimo é o saldo devedor).

A página de detalhe (detalhe-imovel.asp) fica atrás de CAPTCHA (Radware Bot Manager), então não é
consultada: data do leilão, edital, matrícula, ocupação e FGTS ficam null para esta fonte.
"""

from __future__ import annotations

import csv
import io
import logging
import re

from ..extract_regex import _num, extrair_tudo
from ..schema import completar, normalizar_tipo, novo_registro, preencher_derivados, titulo

log = logging.getLogger(__name__)

NOME = "caixa"
SITE = "https://venda-imoveis.caixa.gov.br/"

# Cabeçalhos esperados (sem acento, minúsculos) -> nome interno
_COLUNAS = {
    "n do imovel": "numero", "no do imovel": "numero", "n° do imovel": "numero", "nº do imovel": "numero",
    "uf": "uf", "cidade": "cidade", "bairro": "bairro", "endereco": "endereco",
    "preco": "preco", "valor de avaliacao": "avaliacao", "desconto": "desconto",
    "financiamento": "financiamento", "descricao": "descricao",
    "modalidade de venda": "modalidade", "link de acesso": "link",
}


URL_MATRICULA = "https://venda-imoveis.caixa.gov.br/editais/matricula/{uf}/{numero:0>13}.pdf"


def url_matricula_de(numero, uf: str | None) -> str | None:
    """A página de detalhe da Caixa fica atrás de CAPTCHA, mas o PDF da matrícula tem endereço previsível
    (UF + número do imóvel com 13 dígitos) e responde sem bloqueio, inclusive para o robô. Não há garantia de
    que exista para todo imóvel; quem lê trata o 404."""
    numero = str(numero or "").strip()
    if not numero.isdigit() or not uf:
        return None
    return URL_MATRICULA.format(uf=uf.upper(), numero=numero)


def _chave(cabecalho: str) -> str:
    from ..schema import sem_acentos
    c = sem_acentos(cabecalho).lower().strip()
    c = re.sub(r"[^a-z0-9° ]", "", c).strip()
    return c


def natureza_da_modalidade(modalidade: str | None) -> str | None:
    if not modalidade:
        return None
    m = modalidade.lower()
    if "leil" in m:
        return "leilão extrajudicial"
    if "licita" in m:
        return "licitação"
    if "venda" in m:
        return "venda direta"
    return None


def parsear_csv(conteudo: bytes, codificacao: str = "latin-1", separador: str = ";") -> tuple[list[dict], str | None]:
    """Devolve (linhas como dicts com chaves internas, data de geração informada no arquivo)."""
    texto = conteudo.decode(codificacao)
    linhas = texto.splitlines()
    data_geracao = None
    inicio = None
    for i, l in enumerate(linhas[:10]):
        m = re.search(r"Data de gera[çc][ãa]o:;(\d{2}/\d{2}/\d{4})", l)
        if m:
            d, mth, y = m.group(1).split("/")
            data_geracao = f"{y}-{mth}-{d}"
        if "UF;" in l and "Cidade;" in l:
            inicio = i
            break
    if inicio is None:
        raise ValueError("cabeçalho do CSV da Caixa não encontrado (formato mudou?)")
    leitor = csv.reader(io.StringIO("\n".join(linhas[inicio:])), delimiter=separador)
    cabecalho = [_COLUNAS.get(_chave(c)) for c in next(leitor)]
    faltam = {"numero", "uf", "cidade", "preco", "avaliacao", "descricao", "modalidade", "link"} - set(cabecalho)
    if faltam:
        raise ValueError(f"colunas ausentes no CSV da Caixa: {sorted(faltam)}")
    saida = []
    for linha in leitor:
        if len(linha) < len(cabecalho) or not linha[0].strip():
            continue
        d = {k: v.strip() for k, v in zip(cabecalho, linha) if k}
        saida.append(d)
    return saida, data_geracao


def registro_de_linha(d: dict) -> dict:
    desc = d.get("descricao") or ""
    tipo_fonte = desc.split(",", 1)[0].strip() if desc else None
    tipo = normalizar_tipo(tipo_fonte)
    fin = (d.get("financiamento") or "").strip().lower()
    uf = (d.get("uf") or "").upper() or None
    r = novo_registro(
        id=f"caixa-{d['numero']}",
        fonte=NOME,
        url_anuncio=d.get("link") or None,
        url_matricula=url_matricula_de(d["numero"], uf),
        tipo=tipo,
        uf=uf,
        cidade=titulo(d.get("cidade")) or None,
        bairro=titulo(d.get("bairro")) or None,
        endereco=(d.get("endereco") or "").strip() or None,
        valor_minimo=_num(d.get("preco")),
        valor_avaliacao=_num(d.get("avaliacao")),
        aceita_financiamento=True if fin == "sim" else (False if fin in ("nao", "não") else None),
        modalidade=d.get("modalidade") or None,
        natureza=natureza_da_modalidade(d.get("modalidade")),
        descricao_original=desc or None,
    )
    # Regex sobre a descrição: áreas, quartos, vagas (0.00 vira None dentro do extrator).
    completar(r, preencher_null_com=extrair_tudo(desc))
    return preencher_derivados(r)


# Preenchido a cada coleta; main.py grava em status_fontes.json.
ultima_info: dict = {}


def coletar(config: dict, cliente) -> list[dict]:
    cfg = config["fontes"]["caixa"]
    registros: list[dict] = []
    info = {"data_geracao": None, "por_uf": {}}
    ultima_info.clear()
    ultima_info.update(info)  # dicts partilhados: por_uf e data_geracao são atualizados abaixo
    for uf in config.get("ufs", []):
        url = cfg["url_lista"].format(uf=uf)
        r = cliente.get(url)
        linhas, data_geracao = parsear_csv(r.content, cfg.get("codificacao", "latin-1"), cfg.get("separador", ";"))
        info["data_geracao"] = data_geracao or info["data_geracao"]
        ultima_info["data_geracao"] = info["data_geracao"]
        info["por_uf"][uf] = len(linhas)
        log.info("caixa %s: %d imóveis (arquivo gerado em %s)", uf, len(linhas), data_geracao)
        for d in linhas:
            try:
                registros.append(registro_de_linha(d))
            except Exception as e:  # uma linha ruim não derruba a UF
                log.warning("caixa: linha ignorada (%s): %s", e, d)
    return registros
