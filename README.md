# Aysha Leilões

Agregador estático e independente de imóveis em leilão, licitação e venda direta, com foco inicial no
Espírito Santo (prioridade na Grande Vitória), em Minas Gerais e, desde 2026-10-22, nos outros 25 estados (a Caixa publica uma lista por UF). Cada imóvel é uma linha estruturada:
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
docs/                      site estático servido pela Cloudflare (HTML, CSS e JS puro; Leaflet + markercluster locais em vendor/)
  _headers                 cabeçalhos de segurança (CSP, nosniff, Referrer-Policy, Permissions-Policy)
  conta.html, js/conta.js  conta por link mágico: créditos, compra (Mercado Pago), histórico, sair, apagar conta
  exemplo-analise.html     um parecer real, aberto, para quem quer ver o que a análise com IA entrega
  leiloes/<UF>/*.html      páginas estáticas por estado e cidade (buscadores), geradas na coleta; sitemap.xml, robots.txt
  og.png                   imagem da pré-visualização de links (Open Graph)
site/                      Worker que serve docs/ na Cloudflare: /api/uf (UF do visitante) e prévia de link por imóvel
worker/                    Worker da API: contas, créditos, relatórios (D1), Mercado Pago, e-mail (Brevo)
  index.html, js/app.js    tabela / cards / mapa; filtros em menus compactos com busca, chips dos filtros ativos,
                           "Mais filtros" recolhível, linha clicável, renderização incremental, comparação, CSV, URL
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

Não há chaves no site. As chaves ficam em GitHub Secrets (coleta e relatórios) e nos segredos do Worker
(`worker/`, contas e pagamentos).

## Hospedagem (Cloudflare)

O site saiu do GitHub Pages em 2026-10-23: os termos do Pages proíbem sites de comércio, e o site vende
créditos. Hoje ele é um Worker da Cloudflare com arquivos estáticos (`site/wrangler.toml`, pasta `docs/`),
em `https://aysha-leiloes.aysha-leiloes-analise.workers.dev` até o domínio próprio entrar. O endereço
antigo redireciona (`urlSite` em `docs/js/config.js`). Publicar à mão, na raiz:
`npx wrangler deploy -c site/wrangler.toml`. O workflow `publicar.yml` faz isso a cada push em `docs/` ou
`site/` e no fim da coleta diária, quando os secrets `CLOUDFLARE_API_TOKEN` (permissão Workers Scripts:
Edit) e `CLOUDFLARE_ACCOUNT_ID` existem; sem eles, o passo é pulado.

O script do site (`site/index.js`) só entra em três casos: `/api/uf` devolve a UF do visitante pela
geolocalização de rede da Cloudflare (o celular carrega só esse estado na primeira visita, em vez dos 23 MB
da base inteira); `/imovel.html?id=…&uf=…` recebe título, descrição e Open Graph do imóvel (mapa compacto
`data/og_<UF>.json`, gerado na coleta), para o link colado no WhatsApp mostrar o que é; e `/` ou `pasta/`
caem no `index.html`. Cabeçalhos de segurança vêm de `docs/_headers`.

Ao ativar o domínio próprio: trocar `SITE`/`ORIGENS` em `worker/wrangler.toml`, `urlSite` em
`docs/js/config.js`, `saida.url_site` em `collector/config.yaml`, os `canonical`/`og:url` dos HTML de `docs/`
e o `Sitemap:` de `docs/robots.txt`; depois ligar o domínio ao Worker `aysha-leiloes` no painel da Cloudflare
e configurar SPF/DKIM/DMARC do Brevo no DNS.

## Páginas por estado e cidade (buscadores)

`collector/paginas.py` roda no fim de cada coleta e gera `docs/leiloes/<UF>/index.html` e
`docs/leiloes/<UF>/<cidade>.html` (cidades com 5 ou mais imóveis ativos; as outras ficam listadas na página
da UF com link para a tabela filtrada), com título e descrição próprios, tabela dos maiores descontos e links
para as fichas, mais `docs/sitemap.xml`. Páginas de cidades que caíram abaixo do mínimo são apagadas.

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

### Coleta local das fontes bloqueadas no CI

Sites que devolvem 403 ao IP do GitHub Actions (hoje só o Colodete) ficam com `bloqueado_no_ci: true` no
config e o Action os pula. `scripts/coleta-local.ps1` faz `git pull`, roda `python -m collector.main
--fontes <essas fontes>` e commita/envia os dados; na máquina do mantenedor ele está registrado no
Agendador de Tarefas do Windows como "aysha-leiloes coleta local", diário às 07:30 (depois da coleta do
Action, às 06:00), com log em `coleta-local.log`. O coletor mantém os registros das fontes que não rodam
numa execução parcial e deduplica os novos contra eles.

## Todos os estados (desde 2026-10-22)

A Caixa lista cerca de 8.700 imóveis no RJ, 3.200 em GO, 2.700 em SP e entre 700 e 1.100 em PE, RS, PI e BA; os 27 estados somam perto de 23 mil imóveis. Três ajustes
mantêm o site leve e o coletor dentro das políticas das fontes:

- **JSON dividido por UF e carga sob demanda.** Acima de 3 MB o coletor grava `imoveis_<UF>.json`; o site
  abre com as UFs de `saida.ufs_carregadas_por_padrao` (lista vazia = todas, que é a configuração atual) e
  carrega as demais quando a pessoa as escolhe no filtro UF (o seletor marca "carregar" nas UFs ainda não baixadas). Links para a ficha levam a
  UF, então a ficha baixa só o arquivo certo.
- **Geocodificação por bairro nos estados grandes** (`geocodificacao.precisao_maxima_por_uf`): o endereço completo
  exigiria dezenas de milhares de consultas ao Nominatim; bairro + cidade repete muito, cabe no cache e
  respeita o limite de 1 consulta/segundo. ES e MG continuam no endereço. O mapa mostra esses pontos com o
  marcador de localização aproximada.
- **Snapshots diários em delta**: só os imóveis novos ou com valor/modalidade/data alterados; snapshot
  completo no dia 1 de cada mês (`saida.snapshot_completo_dia`).

O filtro da etapa de IA segue restrito à Grande Vitória (`ia.filtro`), por custo e por foco.

## Fontes

Inspeção feita em 2026-10-21 (robots.txt, termos de uso e estrutura real de cada site). Nenhuma URL foi inventada:
as que não foram encontradas estão marcadas.

| Fonte | Estado | Como funciona / por quê |
|---|---|---|
| Caixa (`sources/caixa.py`) | **ativa** (ES, MG) | CSV oficial por UF em `venda-imoveis.caixa.gov.br/listaweb/Lista_imoveis_<UF>.csv` (latin-1, `;`). Única fonte estruturada. A página de detalhe está atrás de CAPTCHA (Radware), então data do leilão, edital, matrícula, ocupação e FGTS ficam em branco; o CSV às vezes devolve a página de CAPTCHA e o cliente tenta de novo. `robots.txt` dá 404. Os lotes da Caixa também aparecem no site do leiloeiro (Em Leilão) e a deduplicação junta as duas ocorrências, trazendo data do leilão, edital e matrícula. |
| Banestes (`sources/banestes.py`) | **ativa** (só editais) | Página HTML "Publicações legais → Leilão de Bens Imóveis" lista os editais com datas e PDF. O `robots.txt` do Banestes proíbe todos os PDFs (`Disallow: /*.pdf$`), então o edital não é baixado. Os lotes entram pelo leiloeiro que conduz cada leilão (2026: Em Leilão, Buaiz, VIX), com `comitente` = Banestes. Os editais ficam em `docs/data/editais.json` (página Sobre). |
| Bandes (`sources/bandes.py`) | **ativa** (venda direta) | `bandes.com.br/Site/Dinamico/Show/978/Leilao-de-Imoveis` lista um PDF por cidade com os imóveis em venda direta (blocos "Lote / Lance mínimo / BNU / Localização / Situação / Descrição / Registro / Endereço / Coordenadas"). O parser lê esses blocos; "Confrontações" (nomes de vizinhos) não é guardada. O servidor derruba conexões com frequência, por isso o texto de cada PDF fica em `collector/cache/pdf/` e é reaproveitado quando o site não responde. A página 979 ("Leilão de Imóveis") nunca respondeu. Sem robots.txt. |
| SPU / VendasGov (`sources/spu.py`) | **ativa** | API pública da SPA `imoveis.vendasgov.serpro.gov.br` (`/api/public/imoveis?sala=venda|leilao`, `/api/public/imoveis/<id>`), sem autenticação. A base nacional tem poucas unidades; filtro por UF no cliente (o parâmetro `uf` da API responde 204). |
| JFES — Justiça Federal no ES (`sources/jfes.py`) | **ativa** | `trf2.jus.br/jfes/transparencia/listagem` lista os leilões unificados com um PDF por vara (robots do TRF2 permite). O texto é extraído com pypdf e cada bloco "NN - PROCESSO ... BEM ... AVALIAÇÃO ... LOCALIZAÇÃO ... ÔNUS" vira um registro (veículos descartados). Nomes de partes não são guardados. Texto dos PDFs em cache (`collector/cache/pdf/`). |
| Em Leilão, Buaiz, ES Leilões (`sources/suporteleiloes.py`) | **ativa** | Leiloeiros do ES na plataforma Suporte Leilões: Ayrton de Souza Porto Filho (emleilao.com.br, JUCEES 058/2014; conduz Caixa e Banestes em 2026), Alexandre Buaiz Neto (buaizleiloes.com.br; hoje só veículos) e Sérgio de Paula Pereira (esleiloes.com.br, JUCEES 008/1984). `GET /buscador?uf=<UF>&page=N` lista os lotes; a página do lote embute `var lote = {...}` com avaliação, lance, datas e documentos. Robots: sem restrição a HTML. |
| VIX Leilões (`sources/vixleiloes.py`) | **ativa** | Gabriel Fardin Pereira (vixleiloes.com.br, JUCEES 055/2013), citado no site do Banestes; leilões judiciais do TJES. Páginas `/leiloes?status=...` → leilão → lote com JSON-LD (schema.org/Product). Robots proíbe só `/api/` e `/login`. |
| Colodete Leilões (`sources/colodete.py`) | **ativa, só local** | Mauro Colodete (colodeteleiloes.com.br, JUCEES 051/2006). Plataforma própria: `/leiloes` → `/leilao/<id>/lotes` → `/item/<id>/detalhes` (comissão, avaliação, datas, PDF da matrícula). Robots: `Allow: /` com `Content-Signal: search=yes, ai-train=no`. O site devolve **403 a IPs de datacenter** (GitHub Actions), então está marcada `bloqueado_no_ci` e é coletada da máquina do mantenedor com `python -m collector.main --fontes colodete` (os registros antigos são mantidos enquanto a fonte não roda). |
| HD Leilões (`sources/hdleiloes.py`) | **ativa** | Hidirlene Duszeiko (hdleiloes.com.br), leiloeira dos leilões unificados da JFES e de varas estaduais. A SPA consome uma API JSON própria sem autenticação: `POST /core/api/get-lotes` (tipo=3 Imóveis, estado=UF, 40 por página) e `GET /core/api/get-leiloes` (datas do 2º leilão). Os Termos de Uso ficam num Zendesk que devolve 403 ao robô; o mantenedor leu e autorizou o uso por POST em 2026-10-21. Cada lote traz laudo de avaliação, matrícula e edital em PDF (só os links). Os mesmos imóveis aparecem nos PDFs da JFES e a deduplicação os junta. |
| Resale (`sources/resale.py`) | esqueleto desativado | Os Termos de Uso de resale.com.br (12/09/2025) vedam expressamente "engenharia reversa, scraping ou mineração de dados" e a reprodução do conteúdo. Não há API pública nem feed (sitemap só com páginas institucionais). Não será implementada. |
| TRT-17 (Justiça do Trabalho no ES) | não viável | `trt17.jus.br` devolve 403 (CloudFront) ao User-Agent do projeto, inclusive na página de serviços. Não encontramos página central de leilões nem lista de leiloeiros. |
| Sued Peter Leilões | **ativa** (via `suporteleiloes`) | suedpeterleiloes.com.br está na plataforma Suporte Leilões, então entrou na lista de sites do adaptador (`slug: suedpeter`). Conduz leilões de varas cíveis, juizados e Justiça do Trabalho no ES; a maior parte dos lotes é de bens móveis, filtrados pela categoria. |
| Luiz Lessa | não encontrado | O domínio luizlessa.lel.br, citado na página do Banestes, não resolve no DNS (2026-10-21). |
| TJES (Justiça Estadual) | sem página central | Os editais de leilão judicial saem só no Ediário (diário oficial, que não raspamos) e cada um indica o leiloeiro. Leiloeiros vistos em editais do TJES: Colodete, Buaiz, VIX, Sued Peter e HD, todos cobertos. |
| JUCEES (lista de leiloeiros) | não encontrada | `leiloeiros.jucees.es.gov.br/leiloeiros` devolve 404; a lista oficial de 2024 tinha 42 leiloeiros. |
| Leiloeiros nacionais (Zuk, Mega, Sodré Santoro, Superbid, Leilão Vip, Frazão) | não iniciadas | Só depois de tudo acima estável, no máximo dois. |

Nome de pessoa física nunca entra na base: os módulos guardam só o nome profissional do leiloeiro oficial
(informação pública da JUCEES) e descartam exequentes, executados e depositários.

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

## Etapa de IA (`collector/ia.py`)

Estimativa aprovada em 2026-10-21. Só roda quando existem **as duas** condições: `ANTHROPIC_API_KEY` no
ambiente (segredo do repositório, repassado pelo workflow) e `ia_habilitada: true` no `config.yaml`. Sem a
chave, a etapa só aplica resultados já em cache e grava a estimativa; o site funciona completo sem ela.

Como funciona, a cada coleta:

1. **Candidatos**: imóveis ativos dentro do filtro (`ia.filtro`: UFs, cidades, desconto mínimo) que ainda
   têm algum campo de alto valor em branco (`ocupado`, débitos de IPTU/condomínio, ônus na matrícula) e
   que têm edital ou matrícula em PDF legível (texto extraído com pypdf e guardado em
   `collector/cache/pdf/`). Imóveis sem PDF, como os da Caixa, não são enviados.
2. **Entrada mínima**: cabeçalho de uma linha com o que já se sabe, o anúncio (800 caracteres) e só as
   linhas do documento com palavras-chave (ocupa, IPTU, condomínio, débito, ônus, penhora, hipoteca,
   usufruto, indisponibilidade, comissão, FGTS, financiamento) com 2 linhas de contexto, sem cabeçalhos,
   rodapés e numeração repetidos, até `max_caracteres_entrada` (6.000).
3. **Cache permanente**: o hash dessa entrada identifica o documento. Se `collector/cache/ia/<hash>.json`
   existe, o resultado é aplicado sem chamada. O cache é commitado pelo Action.
4. **Uma chamada por imóvel**, pelo **Batch API** (50 % de desconto): modelo `claude-haiku-5-5`, pensamento
   desligado, `effort: low`, prompt de sistema fixo no bloco cacheável, saída JSON com esquema
   (`output_config.format`), `max_tokens` 900 (cabe o JSON com sete trechos-fonte de até 200 caracteres).
   Campos devolvidos: ocupado, débitos de IPTU e de condomínio (vendedor/comprador/null), aceita
   financiamento, aceita FGTS, comissão %, ônus na matrícula (lista), alertas (lista) e um
   `trecho_fonte` por campo. O lote é consultado por até `esperar_lote_minutos`; se não terminar, o
   resultado entra na execução seguinte (`collector/cache/ia/_lotes.json` guarda os lotes pendentes).
5. **Tetos por execução**: `limite_chamadas_por_execucao` (50) e `limite_custo_usd_por_execucao`
   (US$ 0,50, calculado antes de enviar). O que sobra fica para o dia seguinte, por maior desconto.
6. **Nunca sobrescreve**: a IA só preenche campo `null`; tudo o que ela devolveu fica em `extracao_ia`
   (com os trechos-fonte, mostrados na ficha do imóvel). Nomes de pessoas físicas e CPFs são removidos
   antes de salvar (`remover_nomes`), além da instrução ao modelo de não os incluir.
7. **Custo**: `docs/data/custo_ia.json` registra cada execução (chamadas, cache hits, pendentes) e cada
   lote concluído (tokens reais de entrada/saída e custo). O registro é interno: a página Sobre não exibe a etapa de IA; os resultados aparecem na ficha de cada imóvel.

Com os preços do Haiku 5.5 (US$ 0,10/0,50 por milhão de tokens, metade no Batch), 50 imóveis por dia
custam cerca de US$ 0,02 e um mês no teto fica abaixo de US$ 1.

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

## Link de apoio (Buy Me a Coffee)

Viável. A página oficial de países com repasse do Buy Me a Coffee lista o Brasil (Stripe Standard
Connect); a plataforma cobra 5 % por transação mais a taxa do Stripe, e o repasse cai numa conta Stripe
brasileira. Alternativas sem taxa própria: um link Pix/QR ou o Ko-fi. O site já tem o botão pronto:
preencha `urlApoio` em `docs/js/config.js` (ex.: `https://buymeacoffee.com/<usuario>`) e ele aparece no
rodapé da tabela e na página Sobre; vazio, não aparece. Criar a conta é um passo manual do mantenedor.

## Contagem de visitas (GoatCounter)

O site conta visitas com o [GoatCounter](https://www.goatcounter.com/): gratuito para uso não comercial,
sem cookies, sem banner de consentimento, com painel de visitas por dia, visitantes únicos, páginas mais
vistas e origem do tráfego. Para ligar:

1. Crie a conta em https://www.goatcounter.com/signup escolhendo um código (ex.: `leiloes-em-tabela`);
   o painel fica em `https://<código>.goatcounter.com`.
2. Em `docs/js/config.js`, preencha `goatcounter: "<código>"` e publique.
3. Em "Settings → Sites", confira que o domínio `josemarquesjunior.github.io` está permitido (o
   GoatCounter aceita qualquer origem por padrão).

O que é enviado: o caminho da página (sem a query string, ou seja, sem os filtros da busca), a ficha do
imóvel como `/imovel/<id>` (mostra os imóveis mais abertos), referência (de onde veio) e tamanho da tela.
Acessos em `localhost` não são contados. O painel pode ser tornado público em "Settings → Public".

## Análise detalhada com IA (relatório por imóvel)

Diferente da extração de campos (Haiku, acima), o botão "IA ✦" de cada linha abre a ficha do imóvel na
seção "Análise com IA", um parecer em Markdown no estilo de analista de leilões: resumo do lote, conta de
custos no lance, referência de mercado pesquisada na web, sinais vermelhos, veredito e diligências.
`collector/relatorio.py` gera o parecer com `claude-opus-5` (pensamento adaptativo, `effort: medium`, até 3
buscas na web, bloco de documentos em cache) lendo edital, matrícula e laudo inteiros.

- **Produto pago, com a primeira análise grátis.** Quem quer uma análise entra com o e-mail (link mágico,
  sem senha); toda conta nova ganha 1 crédito (a primeira análise é grátis) e cada análise custa 1 crédito. Pacotes de créditos
  (1 / 5 / 20) são vendidos pelo Mercado Pago (Pix, cartão, boleto) com confirmação por webhook e recibo por
  e-mail. Página `conta.html`: saldo, compra, histórico de análises e de compras. Termos e privacidade em
  `sobre.html#contas`.
- **Gerado uma vez, entregue só a quem tem acesso.** O texto do parecer fica no banco D1 do Worker
  (`worker/`), nunca no site público. O repositório guarda só metadados e custo
  (`collector/cache/relatorios/<id>.json`, `docs/data/custo_relatorios.json`). Um pedido para um imóvel já
  analisado devolve o texto na hora e não chama o modelo.
- **A análise também estrutura a ficha.** Junto com o parecer, uma chamada barata ao Haiku (saída
  estruturada) extrai os campos do esquema que a fonte não informou (área, endereço, bairro, cidade, quartos,
  vagas, matrícula, processo, ocupação, débitos, comissão, datas, comitente). Eles ficam nos metadados e a
  coleta diária (`relatorio.aplicar_campos_guardados`, logo depois do regex) os aplica ao registro só onde
  está vazio; endereço/bairro novos zeram a geocodificação de baixa precisão para o ponto no mapa melhorar.
- **Como o pedido chega ao robô.** O Worker valida a sessão, cobra (grátis ou crédito) e, se o parecer
  não existe, dispara `relatorio.yml` (`workflow_dispatch`, token fine-grained do GitHub com Actions:
  write). O workflow gera, envia o texto ao Worker (`POST /interno/relatorio`, segredo `INTERNO_SECRET`) e
  commita os metadados. A ficha consulta o Worker a cada 20 s até o parecer aparecer (3 a 6 minutos). A
  chave da Anthropic não passa pelo Worker. Teto diário de gerações: `LIMITE_DIA` no Worker e
  `relatorios.maximo_por_dia` no config.
- **Sem nomes de pessoas**: o prompt proíbe, `anonimizar()` passa um segundo filtro no parecer e
  `limpar_campos()` descarta campos estruturados com nomes.
- **Funil no GoatCounter**: além das visitas, eventos sem dados pessoais (`evento/login-pedido`,
  `conta-nova`, `login-ok`, `analise-credito`, `compra-iniciada`, `compra-paga`) mostram
  no painel quantos visitantes viram conta, pedem análise e compram.
- **Migração dos pareceres antigos** (gerados quando ainda eram servidos pelo site):
  `python -m collector.relatorio --migrar` (ou o workflow com `ids = --migrar`) envia o texto ao Worker,
  extrai os campos estruturados e apaga `docs/data/relatorios/`.

Custo medido com o Opus 5 (US$ 5/25 por milhão de tokens, busca US$ 0,01) nos primeiros pareceres, já com
cache do bloco de documentos, 3 buscas e esforço médio: **US$ 0,45 a 0,73 por imóvel** (a extração de campos
com o Haiku soma menos de US$ 0,01). Com créditos a R$ 14,90 (1) / R$ 59 (5) / R$ 199 (20), a margem cobre
o modelo, a taxa do Mercado Pago (~1 % Pix, ~5 % cartão) e as análises grátis.

## Secrets e GitHub Actions

- O workflow `coletar.yml` roda às 09:00 UTC (06:00 em Brasília) e por disparo manual
  (`gh workflow run coletar.yml -f fontes=caixa`). Instala dependências com cache do pip, roda os testes,
  executa o coletor e commita `docs/data` e `collector/cache` apenas quando a lista de imóveis, o
  histórico, o status ou os caches mudaram.
- Secrets: `ANTHROPIC_API_KEY` e `INTERNO_SECRET` (o mesmo valor configurado no Worker; o workflow
  `relatorio.yml` usa os dois). `ANTHROPIC_API_KEY` (`Settings → Secrets and variables → Actions` ou
  `gh secret set ANTHROPIC_API_KEY`). O workflow já repassa a variável; com `ia_habilitada: true` no
  config a etapa de IA roda. Sem o secret, a coleta continua normal e a IA fica inerte.
- `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`: publicação automática do site (`publicar.yml`).
- GitHub Pages continua ligado (`main / docs`) só para redirecionar o endereço antigo.
