"""Fonte SPU (Secretaria do Patrimônio da União) via portal VendasGov — imoveis.vendasgov.serpro.gov.br.

Inspecionado em 2026-10-21: aplicação Angular que consome uma API pública sem autenticação (não há
robots.txt; o caminho /robots.txt devolve a própria SPA):
- GET /api/public/imoveis?sala=venda|leilao&size=100&page=N -> página {content:[...], totalPages}
  (cada item: id, valor, tipoImovel, endereco{estado,cidade,bairro,completo}, dataSessao, situacao, fotos)
- GET /api/public/imoveis/<id> -> detalhe (matrícula, cartório, areaConstruida, areaTerreno, latitude,
  longitude, ocupacao, edital, avaliacao)
O parâmetro uf= responde 204, então filtramos por UF no cliente. A base nacional é pequena (unidades),
e a SPU-ES publica poucos imóveis por ano; editais em PDF ficam em /api/public/editais/... (não lidos).
"""

from __future__ import annotations

import logging

from ..extract_regex import extrair_tudo
from ..schema import completar, normalizar_tipo, novo_registro, preencher_derivados

log = logging.getLogger(__name__)

NOME = "spu"
SITE = "https://imoveis.vendasgov.serpro.gov.br/"
API = SITE.rstrip("/") + "/api"
ultima_info: dict = {}

_SALAS = {"venda": ("venda direta", "Venda direta SPU (VendasGov)"), "leilao": ("licitação", "Leilão SPU (VendasGov)")}


def registro_de_item(item: dict, sala: str, detalhe: dict | None = None) -> dict:
    det = detalhe or {}
    end = item.get("endereco") or det.get("endereco") or {}
    natureza, modalidade = _SALAS.get(sala, ("licitação", "SPU"))
    tipo_nome = (item.get("tipoImovel") or {}).get("nome") if isinstance(item.get("tipoImovel"), dict) else item.get("tipoImovel")
    fotos = item.get("fotos") or det.get("fotos") or []
    foto = None
    if fotos and isinstance(fotos[0], dict) and fotos[0].get("src"):
        foto = SITE.rstrip("/") + "/api" + fotos[0]["src"]
    aval = None
    if isinstance(det.get("avaliacao"), dict):
        aval = det["avaliacao"].get("valorEdital")
    descricao = det.get("descricao") or end.get("completo") or ""
    ocup = det.get("ocupacao")
    ocupado = None
    if isinstance(ocup, dict):
        nome = (ocup.get("nome") or "").lower()
        ocupado = True if "ocupado" in nome and "des" not in nome else (False if "desocupado" in nome or "vago" in nome else None)
    elif isinstance(ocup, bool):
        ocupado = ocup
    r = novo_registro(
        id=f"spu-{item.get('id')}",
        fonte=NOME,
        url_anuncio=f"{SITE.rstrip('/')}/imovel/{item.get('id')}",
        tipo=normalizar_tipo(tipo_nome),
        uf=(end.get("estado") or "").upper() or None,
        cidade=end.get("cidade") or None,
        bairro=end.get("bairro") or None,
        endereco=end.get("logradouro") or end.get("completo") or None,
        lat=float(det["latitude"]) if det.get("latitude") else None,
        lng=float(det["longitude"]) if det.get("longitude") else None,
        geo_precisao="endereco" if det.get("latitude") else None,
        area_privativa_m2=det.get("areaConstruida") or None,
        area_terreno_m2=det.get("areaTerreno") or None,
        valor_avaliacao=aval or item.get("valor") or None,
        valor_minimo=item.get("valor") or None,
        natureza=natureza,
        modalidade=modalidade,
        data_leilao=(item.get("dataSessao") or "")[:10] or None,
        ocupado=ocupado,
        matricula=str(det.get("matricula")) if det.get("matricula") else None,
        comitente="União (SPU)",
        descricao_original=descricao or None,
        url_foto=foto,
    )
    completar(r, preencher_null_com=extrair_tudo(descricao))
    return preencher_derivados(r)


def coletar(config: dict, cliente) -> list[dict]:
    ufs = set(config.get("ufs", []))
    registros: list[dict] = []
    ultima_info.clear()
    for sala in _SALAS:
        pagina, total_paginas, vistos = 0, 1, 0
        while pagina < total_paginas:
            r = cliente.get(f"{API}/public/imoveis", params={"sala": sala, "size": 100, "page": pagina}, api=True)
            if r.status_code == 204 or not r.content:
                break
            dados = r.json()
            total_paginas = dados.get("totalPages") or 1
            for item in dados.get("content", []):
                vistos += 1
                uf = ((item.get("endereco") or {}).get("estado") or "").upper()
                if ufs and uf not in ufs:
                    continue
                det = None
                try:
                    det = cliente.get(f"{API}/public/imoveis/{item['id']}", api=True).json()
                except Exception as e:
                    log.warning("spu: detalhe %s falhou: %s", item.get("id"), e)
                registros.append(registro_de_item(item, sala, det))
            pagina += 1
        ultima_info[sala] = vistos
    return registros
