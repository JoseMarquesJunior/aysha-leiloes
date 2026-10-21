"""Diagnóstico da etapa de IA: mostra o estado e os erros de um lote, ou faz UMA chamada de teste.

Uso (precisa de ANTHROPIC_API_KEY no ambiente):
  python -m collector.ia_diag lote <id_do_lote>   # estado, contagens e mensagem de erro de cada resultado
  python -m collector.ia_diag teste               # uma mensagem síncrona com o mesmo formato do lote
"""

from __future__ import annotations

import json
import sys

import anthropic
import yaml

from . import ia


def main(argv=None) -> int:
    argv = argv or sys.argv[1:]
    if not argv:
        print(__doc__)
        return 2
    client = anthropic.Anthropic()
    if argv[0] == "lote" and len(argv) > 1:
        b = client.messages.batches.retrieve(argv[1])
        print("status:", b.processing_status, "| contagens:", b.request_counts.to_dict() if hasattr(b.request_counts, "to_dict") else b.request_counts)
        if b.processing_status == "ended":
            for res in client.messages.batches.results(argv[1]):
                tipo = res.result.type
                if tipo == "succeeded":
                    msg = res.result.message
                    texto = next((x.text for x in msg.content if x.type == "text"), "")
                    print(f"[{res.custom_id}] ok | uso={msg.usage.to_dict()} | {texto[:300]}")
                else:
                    err = getattr(res.result, "error", None)
                    print(f"[{res.custom_id}] {tipo} | {err.to_dict() if hasattr(err, 'to_dict') else err}")
        return 0
    if argv[0] == "teste":
        cfg = yaml.safe_load(open("collector/config.yaml", encoding="utf-8"))["ia"]
        entrada = ("Imóvel: apartamento em Vitória/ES; natureza: leilão judicial; lance mínimo: 100000.\n"
                   "Anúncio: Apartamento 2 quartos.\n\nTrechos do documento:\n"
                   "O imóvel encontra-se ocupado pelo executado.\nDébitos de IPTU serão de responsabilidade do arrematante.\n"
                   "Comissão da leiloeira de 5% sobre a arrematação.\nConsta penhora averbada na matrícula.")
        params = ia.montar_requisicao("teste", entrada, cfg)["params"]
        try:
            msg = client.messages.create(**params)
        except anthropic.APIStatusError as e:
            print("ERRO", e.status_code, e.message)
            return 1
        texto = next((x.text for x in msg.content if x.type == "text"), "")
        print("stop_reason:", msg.stop_reason, "| uso:", msg.usage.to_dict())
        print(texto)
        json.loads(texto)
        print("JSON válido; resultado limpo:", json.dumps(ia._limpar_resultado(json.loads(texto)), ensure_ascii=False)[:600])
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
