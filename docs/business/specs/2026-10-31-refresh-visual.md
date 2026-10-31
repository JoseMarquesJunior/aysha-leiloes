# Spec: refresh visual (identidade de marca, menos "branco")

Data: 2026-10-31 · Autor: conversion-optimizer · Status: especificação para implementação (aprovada pelo mantenedor no escopo; **não implementada**; deploy = push em `docs/`, depende de aprovação).
Escopo de arquivos: `docs/css/style.css` (quase tudo) e **zero a três linhas de HTML** (ver seção 6). Sem JS, sem assets novos, sem fontes novas, CSP intacta (`style-src 'self' 'unsafe-inline'`, sem `url()` externo).

## 1. Problema e racional de conversão

Feedback: "não tem cara profissional, está muito branco". Diagnóstico (conferido no CSS): `--bg #f4f6f8` × `--panel #fff` = razão de luminância 1,07 (quase indistinguíveis); cabeçalho branco; `#0b5fff` cru; primeira dobra abre em filtros.

Racional (heurística declarada, não há dado de funil que o prove): o visitante decide em segundos se confia o bastante para (1) criar conta `login-pedido`, (2) gastar a 1ª análise e (3) pagar `compra-iniciada` → `compra-paga`. Produto vende *análise de risco de imóvel de leilão*; aparência amadora reduz a confiança exatamente na etapa em que se pede e-mail e dinheiro. Efeito esperado: sinal de marca/credibilidade na primeira visita e hierarquia visual (CTA âmbar/azul sobre superfícies distintas). **Não** prometer lift: medir (seção 8).

## 2. Decisões-chave

1. **A faixa escura cobre só `.linha1`** (marca, resumo, nav, tagline). A `.filtros` permanece em fundo claro (`--panel`) logo abaixo. Motivo: os controles (inputs, pílulas `.ms-botao`, `.segmentado`, `.badge`, chips, menus `.ms-menu`) foram desenhados para fundo claro; reestilizá-los para escuro dobraria o risco e o diff, e a densidade/legibilidade da busca é o que o investidor usa. A faixa escura funciona como "âncora" da marca; a transição escuro→claro é a borda âmbar de 3px.
2. Azul próprio `#1558d6` (mais profundo e frio que `#0b5fff`; branco sobre ele = 6,18:1, contra ~5,0 do original). O `#0b5fff` fica só no próprio logo.
3. Navy de marca `#0f1b36` (família do azul, mais escuro que o azul do logo, harmoniza com a pálpebra `#1b1f24`). O tile azul do logo sobre o navy dá 3,33:1 (elemento gráfico, exigência é 3:1: passa).
4. Âmbar do logo (`#f2b134`/`#f7c24a`) com parcimônia: **apenas** (a) linha de 3px sob o cabeçalho, (b) selo "melhor" em sobre.html, (c) CTA principal dentro do hero de sobre.html, (d) anel de foco no cabeçalho. Texto sobre âmbar é sempre `#1b1f24` (8,76:1).
5. Contraste fundo × painel: `--bg` passa a `#e6ecf5` (tingido de azul) e bordas sobem; razão painel/fundo só vai de 1,07 para 1,19, então **o ganho perceptivo vem de borda + sombra + tinta, não da luminância**. Isso é intencional (continua leve para leitura de tabela).
6. Corrigidos de passagem: `--ok` e `--warn` ficariam abaixo de 4,5:1 sobre o novo `--bg` (4,28 e 3,98), então escurecem (ver tokens). `#fff` literal em controles vira `var(--panel)` (conserta também inputs brancos no modo escuro).
7. Densidade da tabela preservada: nenhum `padding`, `font-size` ou largura de coluna muda.

## 3. Tokens

### 3.1 Claro (`:root`)

| Token | Antes | Depois | Observação |
|---|---|---|---|
| `--bg` | #f4f6f8 | **#e6ecf5** | fundo tingido |
| `--panel` | #ffffff | #ffffff | |
| `--text` | #1b1f24 | #1b1f24 | |
| `--muted` | #5f6b76 | **#56626f** | mantém ≥5,2:1 sobre o novo bg |
| `--border` | #d8dee5 | **#c3cddb** | |
| `--border-forte` | #b9c2cc | **#8190a6** | 3,24:1 sobre painel (controles, WCAG 1.4.11) |
| `--accent` | #0b5fff | **#1558d6** | |
| `--accent-escuro` | #0847bf | **#0d3fa6** | |
| `--accent-soft` | #e8efff | **#e1eaf9** | |
| `--ok` | #1a7f37 | **#17702f** | |
| `--warn` | #b35c00 | **#944a00** | |
| `--bad` | #b42318 | #b42318 | |
| `--new` | #0b7a5a | #0b7a5a | |
| `--row-alt` | #f9fafc | **#f4f7fc** | |
| `--row-hover` | #eef3ff | **#e8effb** | |
| `--sombra` | 0 4px 16px rgba(16,24,40,.12) | **0 6px 20px rgba(16,24,40,.18)** | menus/hover |
| `--sombra-card` (novo) | n/d | **0 1px 2px rgba(16,24,40,.10), 0 2px 8px rgba(16,24,40,.08)** | cards em repouso |
| `--marca` (novo) | n/d | **#0f1b36** | navy do cabeçalho |
| `--marca-2` (novo) | n/d | **#1a3f8f** | fim do gradiente do hero |
| `--marca-texto` (novo) | n/d | **#eaf0fc** | texto/nav sobre navy |
| `--marca-suave` (novo) | n/d | **#b4c2de** | texto secundário sobre navy |
| `--ambar` (novo) | n/d | **#f2b134** | |
| `--ambar-2` (novo) | n/d | **#f7c24a** | foco e hover sobre navy |
| `--ambar-soft` (novo) | n/d | **#fff3d6** | fundo de destaque suave (reservado) |
| `--ambar-texto` (novo) | n/d | **#6b4400** | texto sobre `--ambar-soft` |
| `--th` (novo) | #eef1f5 literal | **#dfe6f1** | cabeçalho de tabela |
| `--th-hover` (novo) | #e3e8ee literal | **#d3dcea** | |
| `--th-texto` (novo) | #3b4652 literal | **#2f3b4a** | |

### 3.2 Escuro (`@media (prefers-color-scheme: dark)` → `:root`)

| Token | Antes | Depois |
|---|---|---|
| `--bg` | #0f1419 | **#0b111a** |
| `--panel` | #171d24 | **#141c27** |
| `--text` | #e6e9ed | #e6e9ed |
| `--muted` | #9aa5b1 | #9aa5b1 |
| `--border` | #2a333d | **#2f3b4a** |
| `--border-forte` | #3a4654 | **#52637a** |
| `--accent` | #5b9bff | **#6aa5ff** |
| `--accent-escuro` | #8ab8ff | **#9cc2ff** |
| `--accent-soft` | #1b2b45 | **#18294a** |
| `--ok` / `--warn` / `--bad` / `--new` | #4cc47b / #e2a04a / #ff7b72 / #47c69a | iguais |
| `--row-alt` | #141a21 | **#111822** |
| `--row-hover` | #1e2a3d | **#1c2a40** |
| `--sombra` | 0 4px 16px rgba(0,0,0,.5) | **0 6px 20px rgba(0,0,0,.6)** |
| `--sombra-card` | n/d | **0 1px 2px rgba(0,0,0,.5), 0 2px 8px rgba(0,0,0,.35)** |
| `--marca` | n/d | **#060a12** |
| `--marca-2` | n/d | **#16336e** |
| `--marca-texto` | n/d | **#e6ecf7** |
| `--marca-suave` | n/d | **#a9b6cc** |
| `--ambar`, `--ambar-2` | n/d | iguais ao claro |
| `--ambar-soft` | n/d | **#33270f** |
| `--ambar-texto` | n/d | **#f7c24a** |
| `--th` / `--th-hover` / `--th-texto` | n/d | **#1c2633 / #26303b / #c5ced8** |

Observação: no escuro o cabeçalho (`#060a12`) é mais escuro que o fundo (`#0b111a`); a diferença é pequena, por isso a linha âmbar de 3px é o que marca a faixa nos dois modos.

## 4. Mudanças por seletor em `docs/css/style.css`

### 4.1 `:root` e bloco escuro
Aplicar as tabelas 3.1 e 3.2 (adicionar os tokens novos no `:root` e no bloco escuro).

### 4.2 Cabeçalho (substitui as linhas 42-52)

```css
header.topo { background: var(--panel); border-bottom: 1px solid var(--border); }
.topo .linha1 { background: var(--marca); color: var(--marca-texto); border-bottom: 3px solid var(--ambar); /* + grid existente, sem alterar */ }
.topo h1 a, .topo .marca a { color: #fff; }
.topo .logo { box-shadow: 0 0 0 1px rgba(255,255,255,.18); }   /* ring do tile azul sobre o navy */
.topo .tagline { color: var(--marca-suave); }
.topo .resumo { color: var(--marca-suave); }
.topo .resumo a, .topo nav a { color: var(--marca-texto); }
.topo nav a:hover, .topo .resumo a:hover { color: var(--ambar-2); text-decoration: underline; }
.topo .linha1 :focus-visible { outline-color: var(--ambar-2); }
.fontes-status { color: var(--marca-suave); }
.fontes-status .ok { background: #4cc47b; } .fontes-status .falha { background: #ff7b72; }
```

Manter a declaração de `grid`/`padding` já existente em `.topo .linha1` (apenas acrescentar as propriedades acima na mesma regra). Quando o `.linha1` ganha fundo, o `padding: 10px 16px 8px` existente já cria o respiro; aumentar para `12px 16px 10px` (e `10px 12px 8px` no celular, ver 4.9) para a faixa não parecer apertada.

`header.topo` continua `--panel` + `border-bottom`: é o fundo da área `.filtros` (que fica fora do `.linha1`). Em páginas sem `.filtros` (sobre, conta, agenda, estatisticas, imóvel, admin, páginas SEO), o `header.topo` é só o `.linha1`; a borda de baixo do header some visualmente atrás da linha âmbar, sem problema.

Elementos de `nav` com classes próprias (`#nav-conta`, `#nav-agenda`, badge de saldo se existir): herdam `a {color}` sobrescrito acima. Implementador: grep por `.topo` em `docs/js/*.js` e `collector/paginas.py` (linha ~175 gera o mesmo `<header class="topo">`; **não precisa mudar o gerador**, o CSS é global) e conferir se algum elemento injetado em `nav` usa `background` claro ou `.btn` (um `.btn` dentro do header ficaria com fundo `--panel` e texto `--text`, legível; aceitável).

### 4.3 Controles (trocar `#fff` literal por token)
`.ms-botao`, `.faixa input`, `.btn`, `.segmentado`: `background: #fff` → `background: var(--panel)`. A regra escura `.ms-botao, .btn { background: var(--panel) }` fica redundante e pode ser removida (opcional). `.filtros-linha.secundaria` mantém `background: var(--bg)`; com o novo bg tingido ela passa a ter mais presença sem mudança de código. `.btn.ativo, .btn.primario` e `.segmentado .modo.ativo` herdam o novo `--accent`.

### 4.4 Tabela
```css
.tabela-wrap { border: 1px solid var(--border-forte); box-shadow: var(--sombra-card); }
.tabela th { background: var(--th); color: var(--th-texto); border-bottom: 2px solid var(--border-forte); }
.tabela th:hover { background: var(--th-hover); }
```
Remover as linhas escuras `.tabela th`/`.tabela th:hover` do bloco dark (passam a vir dos tokens). `tr.selecionado` (#fff6d6 / #3a3417) permanece.

### 4.5 Cards, KPIs, blocos, pacotes, painéis (um degrau a mais)
Seletores: `.card, .kpi, .bloco, .pacote, .numeros div, .passo, .confianca .grade3 > div, .preco, .faq details, .agenda-item, .cal, .boas-vindas`.
- `border: 1px solid var(--border)` → `1px solid var(--border-forte)` **apenas** em `.card, .kpi, .bloco, .pacote, .numeros div, .passo, .confianca .grade3 > div, .preco`; mantém `--border` (já mais escuro que antes) em `.faq details`, `.agenda-item`, `.cal`, para não pesar listas longas.
- Adicionar `box-shadow: var(--sombra-card)` em todos os acima, **exceto** `.preco.melhor` e `.boas-vindas`, que mantêm o anel `0 0 0 3px var(--accent-soft)` (somar: `box-shadow: 0 0 0 3px var(--accent-soft), var(--sombra-card)`).
- `.card:hover { box-shadow: var(--sombra); border-color: var(--accent); }`.
- `.relatorio` (análise) idem: `box-shadow: 0 0 0 3px var(--accent-soft), var(--sombra-card)`.
- Filtros `.ms-menu`, `.colunas-menu .lista`, `.mapa-filtros` já usam `--sombra` (ficam mais fortes pelo token).
- `.pacote` (compra): adicionar `border-top: 3px solid var(--accent)` para dar presença ao bloco de checkout; sem outras mudanças de layout.
- Rodapé: `footer { background: var(--panel); border-top: 1px solid var(--border-forte); }`. Texto `--muted` sobre `--panel` = 6,23:1.

### 4.6 Hero de `sobre.html` (faixa de cor)
Como `.sobre` tem `max-width: 900px`, não usar full-bleed (exigiria hack de largura); o hero vira um **cartão-faixa** com gradiente, raio 12px:

```css
.vendas .hero { background: linear-gradient(135deg, var(--marca) 0%, var(--marca-2) 100%); color: #fff; border-radius: 12px; padding: 26px 24px 22px; box-shadow: var(--sombra-card); border-bottom: 4px solid var(--ambar); }
.vendas .hero h1, .vendas .hero h2 { color: #fff; }
.vendas .hero > p { color: #dbe5fb; }
.vendas .hero .cta .btn.primario { background: var(--ambar); border-color: var(--ambar); color: #1b1f24; }
.vendas .hero .cta .btn.primario:hover { background: var(--ambar-2); border-color: var(--ambar-2); }
.vendas .hero .cta .btn:not(.primario) { background: var(--panel); color: var(--text); }
.vendas .hero .cta .btn:not(.primario):hover { background: var(--accent-soft); }
.vendas .hero .cta .btn:focus-visible { outline-color: var(--ambar-2); }
.vendas .hero .numeros div { border-color: transparent; }
```
`.numeros` (os 4 números) permanecem dentro do hero com painéis `--panel` (texto escuro/claro conforme o modo, já legível); o `.hero { padding: 22px 0 8px }` antigo é substituído. No celular (≤760px) manter `padding: 20px 16px 16px` e `border-radius: 10px`; `.numeros` já cai para 2 colunas.
Remover a regra dark `.preco .selo { color: #0f1419 }` (o selo passa a ser âmbar com texto escuro nos dois modos); manter `.passo .num` no dark.

### 4.7 Selo "melhor" (âmbar)
```css
.preco .selo { background: var(--ambar); color: #1b1f24; }
.preco.melhor { border-color: var(--ambar); box-shadow: 0 0 0 3px var(--ambar-soft), var(--sombra-card); }
```
No escuro `--ambar-soft #33270f`: anel discreto. Texto do selo `#1b1f24` sobre `#f2b134`: 8,76:1 (os dois modos).

### 4.8 Tag "novo" e hover (âmbar pontual, opcional)
Manter `.tag.novo` verde (semântica de "bom/novo", já AA 4,64:1 com `#0b7a5a` sobre `#dcf5ea`). Âmbar **não** entra em tags de dados. `.btn-ia` (botão "IA ✦") continua azul `--accent`: é a ação de monetização principal e deve se destacar no azul, não no âmbar.

### 4.9 Celular (≤760px), dentro do bloco existente
```css
.topo .linha1 { padding: 10px 12px 8px; }   /* era 8px 12px 4px; faixa escura precisa de respiro embaixo */
```
`.tagline` segue `display:none` e `.resumo` segue `width:100%` (já definido), com cor `--marca-suave` (9,52:1 sobre `#0f1b36`). Resultado esperado a 360px: faixa navy com logo+marca à esquerda, nav à direita (grid `auto 1fr auto`; "Agenda" e "Minha conta" cabem em 360px porque o `.resumo` quebra para linha abaixo, `grid-area` já trata). Verificar a 320px: se marca + nav transbordarem, aplicar `.topo nav { gap: 10px; font-size: .85rem; }` em `@media (max-width: 380px)`. Alvos de toque do nav: já são links de texto; adicionar `.topo nav a { padding: 6px 2px; }` no mobile (≥ 32px de altura; o mínimo de 44px do projeto não vale para links de texto no cabeçalho hoje, não piorar).

### 4.10 Itens do modo escuro (bloco existente)
- `.btn.ativo, .btn.primario, .segmentado .modo.ativo, .btn-ia`: `color: #0f1419` → `#0b111a` sobre `#6aa5ff` = 7,61:1.
- `.barra-selecao` mantém.
- Remover (agora via tokens): `.tabela th`, `.tabela th:hover` do bloco dark.
- `.aviso`, `.leaflet-*`, `.tag.*` inalterados.

## 5. Ordem de implementação sugerida (diffs pequenos, reversíveis)
1. Tokens (3.1/3.2) + 4.3 + 4.4 → commit "tokens". Já muda a cara do site inteiro.
2. Cabeçalho 4.2 + 4.9 → commit.
3. Cards/blocos 4.5 + rodapé → commit.
4. Hero/selo 4.6-4.7 → commit.
Rollback: `git revert` do commit específico; nada depende de JS ou HTML.

## 6. Mudanças de HTML (mínimas; nenhuma obrigatória)
- Nenhuma obrigatória: tudo é por seletor existente (`header.topo`, `.linha1`, `.hero`).
- Opcional: `<meta name="theme-color" content="#0f1b36">` nos `<head>` (barra do navegador no celular combina com o cabeçalho). Se for feito, é nas ~8 páginas + gerador de `collector/paginas.py` (delegar ao builder-qa); pode ficar de fora da v1 sem perda.
- Conferir o `logo.svg`: não alterar.

## 7. Critérios de aceitação (verificáveis)

### 7.1 Contraste (razões calculadas com a fórmula WCAG 2.x; mínimo 4,5:1 texto, 3:1 elementos gráficos/bordas de controle)

| Par (texto / fundo) | Modo | Razão | Mín. |
|---|---|---|---|
| `#eaf0fc` nav / `#0f1b36` header | claro | 14,93 | 4,5 |
| `#b4c2de` resumo, tagline / `#0f1b36` | claro | 9,52 | 4,5 |
| `#f7c24a` hover/foco / `#0f1b36` | claro | 10,38 | 4,5 / 3 |
| `#e6ecf7` nav / `#060a12` | escuro | 16,71 | 4,5 |
| `#a9b6cc` resumo / `#060a12` | escuro | 9,67 | 4,5 |
| `#f7c24a` / `#060a12` | escuro | 12,05 | 4,5 / 3 |
| `#4cc47b` ponto ok / `#0f1b36` | claro | 7,71 | 3 |
| `#ff7b72` ponto falha / `#0f1b36` | claro | 6,77 | 3 |
| `#0b5fff` tile do logo / `#0f1b36` | claro | 3,33 | 3 (gráfico) |
| `#fff` / `#1558d6` (btn primário, `.badge`, `.passo .num`) | claro | 6,18 | 4,5 |
| `#1558d6` link / `#fff` painel | claro | 6,18 | 4,5 |
| `#1558d6` link / `#e6ecf5` bg | claro | 5,20 | 4,5 |
| `#0d3fa6` / `#e1eaf9` (chip, `.ms-botao.ativo`) | claro | 7,61 | 4,5 |
| `#1b1f24` texto / `#e6ecf5` | claro | 13,94 | 4,5 |
| `#56626f` muted / `#e6ecf5` | claro | 5,24 | 4,5 |
| `#56626f` muted / `#fff` | claro | 6,23 | 4,5 |
| `#17702f` ok / `#e6ecf5` ; / `#fff` ; / `#dcf5ea` | claro | 5,21 ; 6,19 ; 5,39 | 4,5 |
| `#944a00` warn / `#e6ecf5` ; / `#fff1dc` | claro | 5,46 ; 5,83 | 4,5 |
| `#b42318` bad / `#e6ecf5` ; / `#fde8e6` | claro | 5,54 ; 5,59 | 4,5 |
| `#2f3b4a` th / `#dfe6f1` | claro | 9,06 | 4,5 |
| `#8190a6` borda de controle / `#fff` | claro | 3,24 | 3 |
| `#1b1f24` / `#f2b134` (CTA hero, selo) | ambos | 8,76 | 4,5 |
| `#1b1f24` / `#f7c24a` (hover CTA) | ambos | 10,07 | 4,5 |
| `#fff` título / `#0f1b36` início do gradiente | claro | 17,07 | 4,5 |
| `#fff` título / `#1a3f8f` fim do gradiente | claro | 9,76 | 4,5 |
| `#dbe5fb` parágrafo hero / `#1a3f8f` (pior ponto) | claro | 7,72 | 4,5 |
| `#fff` / `#16336e` (fim do gradiente) | escuro | 12,12 | 4,5 |
| `#dbe5fb` parágrafo hero / `#16336e` (fim do gradiente; `#cfdcf5` mede 8,78, `#dbe5fb` é mais claro e passa com folga) | escuro | > 8,78 | 4,5 |
| btn secundário do hero: `--text` / `--panel` (`#1b1f24`/`#fff` no claro; `#e6e9ed`/`#141c27` no escuro) | ambos | 16,56 ; > 11 | 4,5 |
| `#e6e9ed` texto / `#0b111a` bg | escuro | 15,54 | 4,5 |
| `#9aa5b1` muted / `#141c27` panel ; / `#0b111a` | escuro | 6,85 ; 7,56 | 4,5 |
| `#6aa5ff` link / `#141c27` | escuro | 6,89 | 4,5 |
| `#0b111a` / `#6aa5ff` (btn primário, `.btn-ia`) | escuro | 7,61 | 4,5 |
| `#9cc2ff` / `#18294a` (chip) | escuro | 7,96 | 4,5 |
| `#c5ced8` th / `#1c2633` | escuro | 9,60 | 4,5 |
| `#4cc47b` ok / `#0b111a` ; `#e2a04a` warn / `#141c27` ; `#ff7b72` bad / `#141c27` | escuro | 8,55 ; 7,64 ; 6,80 | 4,5 |
| `#52637a` borda controle / `#141c27` | escuro | 2,80 | **ver nota** |

Nota: no escuro a borda de controle fica em 2,80:1 (abaixo de 3:1). Se a checagem exigir 3:1 rigoroso, usar `--border-forte: #5a6c84` no escuro (a validar com o script). Hoje (`#3a4654`) já está abaixo e o projeto nunca exigiu; é melhoria, não regressão.

Texto sobre `--bg` com `.ai-quando.perto` (warn sobre `#fff1dc`) e `.tag.alta` seguem os valores da linha warn acima.

### 7.2 Visuais e funcionais (teste manual)
1. Servidor local `python -m http.server 8765 --directory docs`; abrir `index.html`, `sobre.html`, `conta.html`, `agenda.html`, `estatisticas.html`, `imovel.html?id=<qualquer>`, `exemplo-analise.html` e uma página `leiloes/<uf>/` já gerada. Em todas: faixa navy com linha âmbar, logo visível, nav legível, sem texto azul-escuro sobre navy.
2. Em `index.html`: a faixa escura contém só marca/resumo/nav (e tagline no desktop); `.filtros` permanece clara logo abaixo; busca, pílulas, faixas de preço, `.segmentado` e menus `.ms-menu` funcionam e continuam legíveis.
3. Linha da tabela: altura, padding e colunas idênticos a antes (comparar captura de tela antes/depois a 1440px e 360px).
4. Largura 360px e 320px: sem rolagem horizontal da página; header não quebra o grid; `.tagline` oculta; `.resumo` em largura total, com texto claro.
5. Alternar o tema do SO para escuro: todas as páginas acima legíveis; nenhum bloco branco residual (`grep -n "#fff" docs/css/style.css` deve restar só em `.barra-selecao`, textos sobre `--accent`/gradiente e `.btn` contextuais).
6. `Tab` pelo cabeçalho: anel de foco âmbar visível; no corpo, anel azul visível.
7. Console sem erros; zero violações de CSP (nenhuma fonte/URL nova).
8. Fluxo de compra em `conta.html` (login mock/real, pacotes, botão Comprar) visualmente íntegro: botão primário legível, `.pacote` com topo azul. Nenhuma mudança em JS, então `compra-iniciada` não pode ser afetada; confirmar enviando um clique de teste e vendo o evento no Umami.
9. `docs/index.html` ainda exibe o aviso legal do rodapé e `sobre.html` os termos (nenhum aviso removido).

## 8. Métrica e decisão
Hipótese: aparência de marca eleva confiança e melhora a passagem visitante → `login-pedido` e `login-ok` → `analise-credito`. Sem dado de funil neste documento: pedir ao mantenedor/unit-economics-analyst a leitura de `login-pedido / visitantes` e `compra-iniciada / login-ok` dos 7 dias anteriores ao deploy (período fechado). Comparar com os 7 dias seguintes (fechados); com tráfego pequeno o efeito não será estatisticamente detectável (regra de amostra pequena de `metrics.md`), então a leitura é direcional e **não** pode ser atribuída ao refresh isoladamente se houver mudança de aquisição no período. Complementar com 3 a 5 pessoas do público (investidores) vendo antes/depois e respondendo "você confiaria em inserir seu e-mail aqui?" (teste qualitativo, sem coleta de dados pessoais). Guardrails: taxa `compra-iniciada → compra-paga` estável; tempo até a 1ª interação com a tabela (já existe via eventos de busca) não piora.

Risco: baixo (CSS puro). Principal risco: regressão de contraste em páginas geradas/rotas não testadas (cobertas pelo critério 7.2.1) e contraste de componentes injetados por JS dentro do `nav`. Rollback: `git revert` por commit.
