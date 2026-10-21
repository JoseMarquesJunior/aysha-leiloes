# Leilões em Tabela

Agregador estático e independente de imóveis em leilão, licitação e venda direta, com foco inicial no
Espírito Santo (prioridade na Grande Vitória) e em Minas Gerais. Cada imóvel é uma linha estruturada:
os filtros trabalham sobre campos extraídos (valor, desconto, R$/m², área, ocupação, débitos, FGTS),
não sobre texto solto.

Site: https://josemarquesjunior.github.io/aysha-leiloes/

> O site não tem vínculo com Caixa, Banestes, Bandes, SPU, leiloeiros ou tribunais. Os dados são
> extraídos automaticamente e podem conter erros ou estar desatualizados. Nada aqui é assessoria
> jurídica nem recomendação de investimento. Nomes de pessoas físicas nunca são armazenados.

## Arquitetura

```
collector/                 coletor em Python (roda no GitHub Actions todo dia às 06:00 de Brasília)
  main.py                  orquestra: fontes -> regex -> deduplicação -> histórico -> geocodificação -> JSON
  config.yaml              UFs, fontes ativas, limites, filtro e tetos da IA
  http_client.py           User-Agent identificado, 2 s entre requisições ao mesmo domínio, robots.txt, timeout, retries
  schema.py                esquema do imóvel, tipos, desconto % e R$/m²
  extract_regex.py         todas as expressões regulares (quartos, vagas, áreas, FGTS, ocupação, praças, comissão, débitos…)
  dedupe.py                duplicatas entre fontes (matrícula, ou endereço + cidade + área ±2 %)
  historico.py             eventos por id, snapshots diários, compactação mensal, retenção de removidos
  geocode.py               Nominatim (1 req/s) com cache em collector/cache/geo.json
  ia.py                    etapa de IA: só filtro, recorte de texto e ESTIMATIVA de custo (chamada à API não implementada)
  sources/<nome>.py        um módulo por fonte, mesma interface
  tests/                   pytest
  cache/geo.json           cache de geocodificação (commitado)
  cache/ia/<hash>.json     cache permanente da IA (commitado; vazio enquanto a IA estiver desligada)
docs/                      site estático servido pelo GitHub Pages (HTML, CSS e JS puro; Leaflet + markercluster no mapa)
  index.html, js/app.js    tabela / cards / mapa, filtros, comparação, CSV, filtros na URL
  imovel.html, js/detalhe.js  ficha completa, outras fontes, extração IA, histórico e gráfico (SVG)
  sobre.html, js/sobre.js  avisos, estado das fontes, campos em branco, custo da IA
  data/imoveis.json        base (ou imoveis_<UF>.json quando passa de 3 MB; meta.json lista os arquivos)
  data/historico.json      eventos: novo, mudou_preco, mudou_modalidade, mudou_data_leilao, removido, reativado
  data/snapshots/          AAAA-MM-DD.json (90 dias) e mensal/AAAA-MM.json (resumo)
  data/status_fontes.json  por fonte: última coleta OK, registros, último erro
  data/custo_ia.json       execuções da IA e estimativa atual
  data/meta.json           contagens e % de campos em branco
.github/workflows/coletar.yml  agendamento diário + disparo manual; cache do pip; commit só quando os dados mudam
```

Não há backend nem chaves no site. Se algum dia houver chave (IA), ela fica só em GitHub Secrets.

## Rodar localmente

```bash
pip install -r requirements.txt
python -m pytest -q collector/tests
python -m collector.main                 # todas as fontes ativas
python -m collector.main --fontes caixa  # só uma fonte
python -m collector.main --sem-geo       # pula o Nominatim
python -m http.server 8765 --directory docs   # abrir http://localhost:8765/
```

A primeira execução geocodifica tudo (cerca de 1 s por consulta; até 3 consultas por imóvel). As seguintes
só consultam imóveis novos, porque `collector/cache/geo.json` é commitado.

## Fontes

| Fonte | Estado | Observações |
|---|---|---|
| Caixa (`sources/caixa.py`) | **ativa** (ES, MG) | CSV oficial por UF em `venda-imoveis.caixa.gov.br/listaweb/Lista_imoveis_<UF>.csv` (latin-1, `;`). É a única fonte estruturada. A página de detalhe de cada imóvel está atrás de CAPTCHA (Radware Bot Manager), então **não** é consultada: data do leilão, edital, matrícula, ocupação e FGTS ficam em branco para a Caixa. O próprio CSV às vezes devolve a página de CAPTCHA; o cliente detecta e tenta de novo com espera crescente. `robots.txt` do site devolve 404 (tratado como permitido). |
| Resale (`sources/resale.py`) | esqueleto desativado | Pendente: ler os termos de uso e procurar API/feed/sitemap/JSON antes de qualquer parser. Se os termos proibirem coleta automatizada, continua desativada e o motivo fica registrado aqui. |
| Banestes, Bandes | não iniciadas | Próxima etapa: inspecionar as páginas reais (publicações legais / editais), checar robots e termos, mostrar a estrutura antes de escrever o parser. |
| Leiloeiros oficiais do ES, tribunais (JFES, TRT-17, TJES), SPU-ES | não iniciadas | Mesmo procedimento; só URLs verificadas (sem inventar). Diário oficial não será raspado. |
| Leiloeiros nacionais (Zuk, Mega, Sodré Santoro, Superbid, Leilão Vip, Frazão) | não iniciadas | Só depois de tudo acima estável, no máximo dois. |

### Mapeamento do CSV da Caixa para o esquema

| Coluna do CSV | Campo |
|---|---|
| N° do imóvel | `id` = `caixa-<número>` |
| UF, Cidade, Bairro, Endereço | `uf`, `cidade`, `bairro` (Title Case), `endereco` (como veio) |
| Preço | `valor_minimo` |
| Valor de avaliação | `valor_avaliacao` |
| Desconto | ignorado; `desconto_pct` é recalculado (fica negativo quando o lance mínimo supera a avaliação, caso comum em "Leilão SFI", onde a Caixa mostra 0.00) |
| Financiamento (Sim/Não) | `aceita_financiamento` |
| Descrição | `descricao_original`; dela saem `tipo` (1ª palavra, normalizada), `area_total_m2`, `area_privativa_m2`, `area_terreno_m2` (0.00 = null), `quartos` (`N qto(s)`), `vagas` (`N vaga(s)`) |
| Modalidade de venda | `modalidade` (texto da fonte) e `natureza`: "Leilão SFI…" → leilão extrajudicial; "Licitação Aberta" → licitação; "Venda Direta Online"/"Venda Online" → venda direta |
| Link de acesso | `url_anuncio` |

## Esquema de cada imóvel

Ver `collector/schema.py` (`CAMPOS`). Campos obrigatórios do projeto mais alguns auxiliares
(`area_total_m2`, `matricula`, `numero_processo`, `url_foto`, `geo_precisao`). Tudo que é desconhecido
é `null` e aparece como "—" no site.

Regra de preenchimento, nesta ordem: (1) dado estruturado da fonte; (2) regex sobre a descrição
(`extract_regex.py`); (3) IA, só para campos de alto valor que ainda estejam `null`, e só se ligada.
Nenhuma etapa sobrescreve o que a anterior preencheu.

## Deduplicação

Dois registros são o mesmo imóvel quando têm a mesma matrícula e cidade, ou o mesmo endereço normalizado
(abreviações expandidas, sem acentos/pontuação) na mesma cidade/UF com área igual dentro de 2 %. Fica como
principal o da fonte com menor prioridade em `prioridade_fontes` (banco/órgão antes de leiloeiro); os
demais vão para `outras_fontes` (fonte, id, URL, valor, modalidade) e aparecem na página de detalhe.

## Histórico

A cada coleta a base nova é comparada com a anterior (`docs/data/imoveis*.json`). Eventos vão para
`historico.json` (retidos por 365 dias). Imóveis que sumiram da fonte continuam na base com
`ativo: false` por 90 dias e não aparecem na tabela por padrão (há um checkbox "incluir removidos").
Fontes que falharam no dia não geram eventos de remoção. Snapshots diários guardam id, valor mínimo,
modalidade e data do leilão; com mais de 90 dias viram resumo mensal. O gráfico da página de detalhe é
montado a partir dos eventos de preço, sem baixar snapshots.

## Etapa de IA (desligada)

Nada chama a API hoje. `collector/ia.py` só calcula quem seria candidato (UF/cidades/desconto mínimo do
`config.yaml`, com algum campo de alto valor ainda `null`), recorta o texto relevante do edital (linhas
com palavras-chave + 2 de contexto, até 6.000 caracteres) e grava uma estimativa de tokens/custo em
`docs/data/custo_ia.json`, exibida na página Sobre. A implementação da chamada (Batch API, Haiku, prompt
de sistema fixo cacheável, uma chamada por imóvel, `max_tokens` ≈ 400, cache permanente por hash do
documento, tetos de chamadas e de custo por execução, descarte de nomes de pessoas físicas) só entra
depois da aprovação dessa estimativa. Para a Caixa a IA não tem o que ler: não há edital acessível.

## Adicionar uma fonte

1. Criar `collector/sources/<nome>.py` com `NOME`, `SITE`, `ultima_info = {}` e
   `coletar(config, cliente) -> list[dict]`, devolvendo registros criados com `schema.novo_registro(...)`
   e passados por `schema.preencher_derivados`. Use `cliente.get(url)` para toda requisição (ele já
   aplica User-Agent, ritmo, robots e timeout). Não baixe fotos; guarde só a URL em `url_foto`.
2. Registrar em `collector/sources/__init__.py` (`REGISTRO`) e em `config.yaml` (`fontes.<nome>.ativa`,
   `prioridade_fontes`).
3. Se a fonte publica PDF: baixar, extrair o texto, tentar `extract_regex.extrair_tudo` antes de pensar em IA.
4. Nunca guardar nomes de pessoas físicas (devedores, executados). Números de processo podem.
5. Escrever um teste em `collector/tests/` com um trecho real da fonte.

Uma fonte que falha não derruba as outras: o erro vai para `status_fontes.json` e para a página Sobre.

## Secrets e GitHub Actions

- O workflow `coletar.yml` roda às 09:00 UTC (06:00 em Brasília) e por disparo manual
  (`gh workflow run coletar.yml -f fontes=caixa`). Instala dependências com cache do pip, roda os testes,
  executa o coletor e commita `docs/data` e `collector/cache` apenas quando a lista de imóveis, o
  histórico, o status ou os caches mudaram.
- Hoje nenhum secret é necessário. Quando a IA for aprovada: `Settings → Secrets and variables → Actions →
  ANTHROPIC_API_KEY`; o workflow já repassa a variável, e `ia_habilitada: true` no config liga a etapa.
- GitHub Pages: `Settings → Pages → Deploy from a branch → main / docs`.
