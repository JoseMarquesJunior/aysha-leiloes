# Auditoria de SEO on-page — Ciclo 01 (antecipada de D5 para D3)

Data: 2026-10-31 · Autor: conversion-optimizer · Escopo: diagnóstico e proposta; nenhum arquivo de código alterado, nada de deploy.
Método: leitura dos geradores (`collector/paginas.py`, `site/index.js`), dos HTML estáticos de `docs/`, dos artefatos gerados (`docs/sitemap*.xml`, `docs/leiloes/`, `docs/data/`) e três requisições à produção (ficha real, ficha inexistente, `/leiloes/ES`). Não tenho acesso ao GSC: nenhuma taxa de indexação é afirmada, só o que o código e o HTML mostram.

## 1. Resumo executivo

A base técnica é boa (acima do que a maioria dos agregadores novos tem): título e descrição únicos por UF, cidade e ficha; canonical e Open Graph em tudo; JSON-LD em todos os tipos de página; sitemaps dentro dos limites; resumo da ficha renderizado no servidor. Os problemas que mais custam indexação são outros:

1. **Mais da metade das fichas não tem nenhum link interno** (só aparecem no sitemap). Medido: 11.024 fichas distintas linkadas em `docs/leiloes/**` contra 24.186 no sitemap (46%).
2. **`robots.txt` bloqueia `/data/`**, de onde o JS da ficha carrega os dados. Se o Googlebot renderizar a ficha, o JS falha e a página pode ficar com "carregando…" no lugar do resumo (hipótese a verificar no GSC, ver C2).
3. **Conteúdo fino e quase-duplicado nas 24 mil fichas** (uma lista de ~6 linhas por ficha, sem texto próprio). Risco real de ficar em "Rastreada, mas não indexada" no GSC.
4. **Hierarquia de títulos incoerente**: o único `<h1>` de todas as páginas é o logo "Aysha Leilões"; o título real da página é `<h2>`.
5. **Soft 404**: ficha inexistente/removida responde HTTP 200 com título genérico e canonical `imovel.html`.
6. **Ficha com URL por query string** (`imovel.html?id=…&uf=…`) e sem a palavra "leilão" no `<title>`.

## 2. Estado atual com evidência

### 2.1 Title, description e H1

| Página | Title | Description | H1 | Evidência |
|---|---|---|---|---|
| Home | "Aysha Leilões — imóveis em leilão, licitação e venda direta em todo o Brasil" | única, boa | logo | `docs/index.html:6-7`, h1 em `:35` |
| Índice `/leiloes/` | "Imóveis em leilão por estado — Aysha Leilões" | única | logo | `collector/paginas.py:260` |
| UF (27) | "Imóveis em leilão no {Estado} ({UF}) — Aysha Leilões" | única, com contagem, menor lance e desconto máx. | logo (o título real é `<h2>`) | `paginas.py:211-218`, template `:124-125,141,147` |
| Cidade (404) | "Imóveis em leilão em {Cidade}, {UF} — Aysha Leilões" | única, com resumo numérico | logo; título em `<h2>` | `paginas.py:229-236` |
| Ficha | "{Tipo} em {Bairro, Cidade}/{UF} por R$ X — Aysha Leilões" (Worker reescreve o título) | única por ficha, ex.: "Lance mínimo R$ 46.498 · 69% abaixo da avaliação · 600 m² · venda direta…" | logo; título em `<h2>` | `site/index.js:78-86,89-97`; confirmado ao vivo |
| Estatísticas | título com mês/ano, description com números | única | logo | `paginas.py:315-318` |
| Sobre / Exemplo | títulos próprios e canonical | únicas | logo (o H2 é a promessa) | `docs/sobre.html:6-9,24,32`; `docs/exemplo-analise.html:6-9,29,37` |

Pontos fracos:
- Todas as páginas têm `<h1>` = logo (`paginas.py:141`, `index.html:35`, `sobre.html:24`). O H1 deveria carregar a palavra-chave da página ("Imóveis em leilão em Vila Velha, ES").
- Title de ficha não contém "leilão", a palavra da busca de cauda longa ("leilão caixa apartamento <cidade>"). Hoje: "Apartamento em Centro, Vila Velha/ES por R$ 100.000". Descrição também começa por "Lance mínimo…" sem "leilão"/"Caixa". A fonte (Caixa etc.) existe no dado mas não entra no title nem na description (`og_*.json` não carrega `fonte`; chaves em `paginas.py:248-251`).
- Description de UF/cidade passa de 160 caracteres (ex.: Vila Velha tem ~270), será truncada no snippet. Não prejudica ranking, mas desperdiça o gancho final.
- Title de cidade/UF não traz o ano nem "Caixa/venda direta"; vale testar variações depois de ter dados de impressões.

### 2.2 Dados estruturados

- **UF e cidade**: `BreadcrumbList` + `ItemList` de até 10 `RealEstateListing` com `Offer` (`paginas.py:96-111,220-221,238-240`). Válido sintaticamente; `ItemList` sem `numberOfItems` (opcional).
- **Ficha**: `RealEstateListing` (+`address`, `offers`, `floorSize`, `numberOfRooms`, `image` quando há foto) e `BreadcrumbList` (`site/index.js:45-65`). Observações de validade:
  - `RealEstateListing` não gera rich result no Google (não há snippet de imóvel); serve como sinal semântico, sem ganho visual garantido. Não vale investir mais nisso.
  - `availability: InStock` é fixo (`index.js:52`), inclusive para leilões já encerrados (272 de 24.866 ativos na base, 1,1%, têm data passada: calculado sobre `docs/data/imoveis_*.json`). Inconsistência com o conteúdo.
  - Sem `priceValidUntil`/datas do leilão. Não existe `Event` para as datas (o modelo de dados tem `data_leilao` e `data_segunda_praca`). Rich result de Event não se aplica bem a leilão de imóvel (Google exige evento com local/participação); recomendo NÃO investir.
  - 24.550 de 24.866 imóveis (98,7%) não têm foto: a ficha cai em `og.png` genérica e sem `image` no JSON-LD. Sem foto, a ficha tem pouco diferencial visual.
- **Home**: `WebSite` simples (`index.html:19`), sem `SearchAction` (não faz sentido: a busca é por JS).
- **Estatísticas**: `Dataset` + `BreadcrumbList` (`paginas.py:379-382`). Bom para citação.

### 2.3 Canonical, Open Graph, robots, sitemaps, interligação

- **Canonical e OG**: presentes em UF, cidade, índice, estatísticas, home, sobre, exemplo, ficha (canonical com `id`+`uf`, reescrito pelo Worker, `site/index.js:87,95`). `conta.html`, `agenda.html` e `admin.html` têm `noindex` e ainda `Disallow` no robots (`robots.txt`). Observação: `Disallow` + `noindex` ao mesmo tempo é inócuo para conta/agenda (Google nem vê o noindex), mas inofensivo.
- **Host**: Worker redireciona `www` e `workers.dev` para o domínio canônico com 301 (`site/index.js:9,107`). `/leiloes/ES` → 301 para `/leiloes/ES/` (confirmado ao vivo).
- **Sitemap principal** `docs/sitemap.xml`: 435 URLs, 47 KB (home, sobre, exemplo, estatísticas, `/leiloes/`, 27 UFs, 404 cidades). Dentro dos limites (50 mil URLs / 50 MB).
- **Sitemap de fichas** `docs/sitemap-imoveis.xml`: 24.186 URLs, 3,0 MB. Dentro dos limites. Não há índice de sitemaps (aceitável; os dois estão listados no `robots.txt`).
- **`lastmod`**: todas as fichas recebem a data da coleta (`hoje`) a cada execução (`paginas.py:276`), mesmo sem mudança. Google tende a ignorar `lastmod` quando ele não é confiável. O correto seria só atualizar quando preço/estado mudar (o `historico.json` tem os eventos).
- **Cobertura do sitemap vs. base**: 24.186 fichas no sitemap (gerado em 29/10) vs. 24.866 ativos hoje na base; a diferença é só defasagem de geração. Fichas encerradas continuam no sitemap enquanto "ativas" (`paginas.py:184`).
- **Robots**: `Disallow: /data/` (`docs/robots.txt`). O `og_<UF>.json` que o Worker lê é buscado internamente (`ASSETS.fetch`), então a ficha SSR funciona; o bloqueio só afeta o rastreador externo (ver C2).
- **Interligação interna**:
  - Home → UF: só pelo rodapé (`index.html:142`, lista de 27 UFs). Home → cidade: nenhum link rastreável (a escolha de cidade é por `<select>` JS).
  - UF → cidade: lista completa de cidades (`paginas.py:203-210`); cidades com menos de 5 imóveis apontam para `/?uf=…&cidade=…` (URL de filtro JS, sem valor de indexação).
  - UF/cidade → ficha: tabela limitada a 60 linhas (`MAX_LINHAS = 60`, `paginas.py:31,163`) e só imóveis "abertos" com desconto > 0 (`_para_tabela`, `:64-69`). Resultado medido: **11.024 fichas distintas linkadas de 24.186 (46%)**; as ~13 mil restantes são órfãs (só o sitemap as descobre). RJ tem 8.363 imóveis e só 60 por UF mais 60 por cidade são linkados.
  - Ficha → UF: link "Mais imóveis em leilão em {UF}" no resumo SSR (`site/index.js:41`). Ficha → cidade e ficha → ficha vizinha: não existem.
  - Cidades abaixo de 5 imóveis (e imóveis sem bairro: 997) não têm página-pai própria.

### 2.4 Conteúdo renderizado

- **Home**: o HTML estático não tem nenhum imóvel; a tabela é montada por `app.js` (`index.html` tem `<tbody id="corpo">` vazio). Para SEO a home vale pela marca e pelo link às UFs; o HTML estático tem pouco texto indexável além da tagline (`index.html:35`) e do bloco "boas-vindas" escondido (`hidden`, `index.html:~95`).
- **UF e cidade**: HTML estático completo (tabela de até 60 imóveis, resumo numérico, links). Bom.
- **Ficha**: o shell estático é genérico (`docs/imovel.html:6-7`, title "Imóvel — Aysha Leilões"); o Worker injeta título, metas, canonical, JSON-LD e um resumo no `<main>` (`site/index.js:26-43,97`), mas o conteúdo completo (mapa, documentos, histórico, análise) só vem do JS `detalhe.js`, que busca `/data/imoveis_<UF>.json` (`detalhe.js:268-269`).
  - Risco: o SSR termina com "Ficha completa… — carregando…" (`index.js:40`). Se o Googlebot renderizar a página com `/data/` bloqueado pelo robots, o fetch falha e o texto "carregando…" pode permanecer como conteúdo renderizado. Não confirmei no GSC; verificar com "Inspeção de URL → Ver página rastreada" numa ficha.
  - Conteúdo SSR por ficha: ~6 linhas (lance, avaliação, desconto, data, área, quartos, endereço, natureza) + 2 links. Pouco texto único; muitas fichas parecem iguais exceto números. 98,7% sem foto.
- **Ficha inexistente**: `imovel.html?id=naoexiste-999&uf=AC` responde **200** com 2.929 bytes, title "Imóvel — Aysha Leilões" e canonical `imovel.html` (verificado ao vivo; `index.js:70-75` devolve o shell). O JS depois escreve "não encontrado". É soft 404; fichas removidas continuarão assim após saírem do sitemap.

### 2.5 Outros fatores

- **Peso**: HTML de ficha ~3-5 KB (leve). CSS 32 KB e `app.js` 52 KB só na home. Mas a ficha, para montar-se, baixa `imoveis_<UF>.json` inteiro (RJ: base grande; `og_RJ.json` sozinho tem 1,8 MB, o Worker o lê e parseia inteiro a cada requisição de ficha de RJ: `index.js:72-74`, impacto de TTFB e CPU do Worker em RJ/GO/SP). Core Web Vitals (LCP/INP) da ficha não foram medidos. Recomendo medir com PageSpeed antes de agir.
- **Cache**: HTML com `Cache-Control: public, max-age=0, must-revalidate` e `CF-Cache-Status: HIT` (ok).
- **Segurança/headers**: CSP rígida, não interfere com JSON-LD (`<script type="application/ld+json">` é dado). OK.
- **Duplicação**: `imovel.html` sem `id` (canonical genérico) e `?id=` com `uf` ausente caem no shell genérico; `?uf=` e `&cidade=` na home não têm canonical por parâmetro (a home canônica é `/`, correto). Fichas do mesmo imóvel em fontes diferentes foram deduplicadas na coleta (README), mas os ids mudam se a fonte mudar: não verifiquei.
- **Rótulo "Imóvel" no título da ficha** quando `tipo` é "outro" (`index.js:10`): títulos fracos.
- **Páginas por cidade/bairro**: não existem páginas por bairro nem por tipo (ex.: "apartamento em leilão em Vila Velha"). A busca de cauda longa-alvo ("leilão caixa apartamento <cidade>") só é atendida por uma página de cidade que mistura todos os tipos.
- **E-mail pessoal no rodapé de todas as páginas** (`paginas.py:151`): irrelevante para SEO; só registro.

## 3. Correções priorizadas (impacto × esforço)

Escala: impacto 1-5 (efeito esperado em indexação/cliques), esforço 1-5 (5 = dias). Score = impacto × (6 − esforço). Quem implementa: `collector/paginas.py` e `site/index.js` ficam com o builder-qa; HTML/JS de `docs/` comigo, depois de aprovado.

| # | Correção | Impacto | Esforço | Score | Quem |
|---|---|---|---|---|---|
| C1 | Aumentar links internos para as fichas: elevar `MAX_LINHAS` (60 → 200 em UF/cidade grandes) e/ou paginar a cidade (`vila-velha-2.html`…) para cobrir as ~13 mil órfãs; adicionar "outros imóveis em {cidade}" e 5 vizinhos na ficha SSR (via `og_<UF>.json`) | 5 | 3 | 15 | builder-qa (`paginas.py`, `site/index.js`) |
| C2 | Liberar no `robots.txt` `Allow: /data/imoveis_*.json` e `/data/og_*.json` (manter bloqueados os demais) e/ou trocar o texto "carregando…" por conteúdo útil; confirmar antes com Inspeção de URL | 4 | 1 | 20 | eu (`docs/robots.txt`) + builder-qa (`index.js:40`) |
| C3 | Corrigir hierarquia: `<h1>` com o título da página (UF/cidade/ficha/home/sobre); logo vira `<div>`/`<a>` | 3 | 2 | 12 | builder-qa (`paginas.py:141,147`, `index.js:38`) + eu (`docs/*.html`) |
| C4 | Soft 404: quando a ficha não existe em `og_<UF>.json`, responder 404 real (ou `noindex`) e tirar do sitemap as encerradas | 3 | 2 | 12 | builder-qa (`index.js:70-75`, `paginas.py:184,276`) |
| C5 | Title/description de ficha com "leilão" e fonte: "Apartamento em leilão em Centro, Vila Velha/ES — Caixa — R$ 100.000"; adicionar `fonte` ao mapa `og_*.json` (`paginas.py:248`) | 3 | 2 | 12 | builder-qa |
| C6 | Texto único por ficha/cidade: parágrafo gerado por regra (sem IA) com preço/m² vs mediana da cidade, desconto vs média da cidade, dias para o leilão, "aceita FGTS/financiamento"; na cidade, bloco por tipo (apartamentos, casas, terrenos) com contagem e menor lance | 4 | 3 | 12 | builder-qa |
| C7 | `lastmod` honesto: usar a data da última mudança de preço/dado (de `historico.json`) em vez de `hoje` | 2 | 2 | 8 | builder-qa (`paginas.py:276`) |
| C8 | `availability`/`validThrough` coerentes no JSON-LD (`SoldOut`/omitir em encerrados; `validThrough` = data do leilão) | 1 | 1 | 5 | builder-qa (`index.js:52`) |
| C9 | Link da home para `/leiloes/` e para as 10 maiores cidades em HTML estático (bloco "Cidades mais buscadas") | 2 | 1 | 10 | eu (`docs/index.html`) |
| C10 | Encurtar description de UF/cidade para ~155 caracteres (contagem + menor lance + "leilão") | 1 | 1 | 5 | builder-qa (`paginas.py:212,230`) |
| C11 | Páginas por tipo e cidade ("apartamentos em leilão em Vila Velha") quando houver ≥5 do tipo | 3 | 4 | 6 | builder-qa, só depois de ver impressões no GSC |

Ordem de ataque sugerida (um deploy único, aprovado pelo mantenedor): C2, C9 (horas); depois C1+C4+C5 juntos (Worker + gerador, 1-2 dias); C3 e C6 num segundo lote. C7, C8, C10 podem acompanhar qualquer lote.

## 4. Hipótese comercial e métrica (GSC) por correção

Linha de base a registrar antes do deploy (leitura manual do mantenedor, períodos fechados): em Desempenho → Páginas, cliques e impressões por dia nos últimos 7 dias; em Indexação → Páginas, contagem de "Indexadas" e de "Rastreada, mas não indexada" / "Descoberta, mas não indexada" para o sitemap `sitemap-imoveis.xml`. Domínio com 3 dias de vida e 1 clique: qualquer comparação nas primeiras semanas mede indexação, não ranking, e não deve ser lida como efeito de conversão.

| # | Hipótese | Métrica GSC | Leitura |
|---|---|---|---|
| C1 | Fichas linkadas a partir de páginas já indexadas são descobertas e priorizadas; menos "Descoberta, não indexada" | nº de URLs de ficha indexadas; "Descoberta, mas não indexada" no sitemap de fichas | 14 e 28 dias após o deploy |
| C2 | Googlebot passa a renderizar a ficha completa; some a divergência SSR vs. renderizado | Inspeção de URL (HTML renderizado) de 5 fichas antes/depois | imediato (teste manual) + 14 dias |
| C3 | H1 com palavra-chave melhora relevância para consultas "imóveis em leilão em {cidade}" | impressões e posição média para páginas `/leiloes/**` | 28 dias |
| C4 | Remover soft 404 e encerradas reduz "Soft 404" e "Rastreada, não indexada" | Relatório de cobertura: Soft 404 | 14 dias |
| C5 | Título com "leilão" + fonte casa melhor com buscas de cauda longa e aumenta o CTR | impressões e CTR de `imovel.html` por consulta (filtrar consultas com "leilão") | 28 dias |
| C6 | Texto único reduz classificação como conteúdo fino | % de fichas indexadas sobre as enviadas | 28 dias |
| C9 | Link na home dá mais autoridade às UFs/cidades | impressões de `/leiloes/UF/` | 28 dias |

Fecho comercial: a leitura útil para o funil é cliques orgânicos em páginas de cidade e ficha que chegam a `login-pedido`/`analise-credito` no Umami. Hoje não há volume para atribuir; não reportar conversão orgânica antes de acumular amostra (regra de amostra pequena em `metrics.md`).

## 5. O que NÃO fazer agora

- Não editar `docs/leiloes/**`, `docs/data/**` nem os sitemaps à mão (gerados).
- Não migrar a ficha para URL "limpa" (`/imovel/<id>`): custa dias, exige redirecionamentos e muda todo o sitemap; a URL com query e canonical correto indexa. Reavaliar só se o GSC mostrar problema de canonicalização.
- Não investir em `Event`/rich results de leilão, nem em `RealEstateListing` extra: sem rich result no Google, retorno baixo.
- Não gerar texto por IA para 24 mil fichas (custo e risco; a regra do projeto é IA último recurso). C6 usa regras.
- Não criar páginas por bairro ou por tipo antes de haver impressões que justifiquem (C11): multiplicaria conteúdo fino.
- Não ampliar o sitemap para URLs de filtro (`/?uf=…&cidade=…`) nem para `agenda`/`conta`.
- Não tratar os 24,6 mil URLs como "24,6 mil páginas indexadas": sem leitura do GSC isso é só a quantidade enviada.
- Não prometer ranking nem tráfego: domínio novo, sem backlinks; o canal é de médio prazo.
- Não remover o aviso legal do rodapé gerado (`paginas.py:150`) ao mexer nos templates.

## 6. Risco e rollback

Todas as correções são aditivas ou de template; rollback por `git revert` do commit e novo deploy. Riscos específicos: C2 expõe JSONs grandes ao rastreio (consumo de crawl e de largura de banda; mitigar liberando só `imoveis_*.json` por UF e mantendo `Cache-Control` de `/data/*`); C1 aumenta o tamanho das páginas de cidade (HTML de RJ a 200 linhas, ainda pequeno); C4 troca status 200 por 404 e precisa de teste local com `wrangler dev` antes de publicar.

## 7. Pendências para o mantenedor

1. Aprovar o escopo do primeiro lote (C2, C9; depois C1+C4+C5) e o deploy.
2. Ler no GSC e registrar a linha de base descrita na seção 4 e o resultado da Inspeção de URL em 3-5 fichas (confirma ou derruba a hipótese do C2).
3. Confirmar com o builder-qa que ele não está nos mesmos arquivos antes de eu editar `docs/index.html` e `docs/robots.txt` (regra 3 de `docs/business/README.md`).
