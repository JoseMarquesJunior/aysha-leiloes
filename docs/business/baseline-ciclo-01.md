# Baseline do ciclo 01 e teto de gasto (Plano de 14 dias nº 1, item 1)

Autor: unit-economics-analyst · data: 2026-10-29 (D1) · status: **proposta aguardando aprovação do mantenedor** (teto de gasto e metas dependem dele, conforme decision-log).
Definições de métricas: [metrics.md](metrics.md). Seção 1 e 2 são **observado/pendente**; seção 3 em diante é **PROJEÇÃO** (cada número é "premissa" ou conta sobre premissa).

Calendário do ciclo (D1 = 2026-10-29): D5 = 2026-11-02 (início do EXP-2026-01), D12 = 2026-11-09, D13–14 = 2026-11-10/11.

## 1. Observado no repositório

| # | Valor | Fonte | Data |
|---|---|---|---|
| 1 | 12 registros de análise (Opus 5) em 6 imóveis distintos (`id` se repete: refações com `--refazer`) | `docs/data/custo_relatorios.json` | 2026-10-22 a 2026-10-29 (último registro 29/10 13:59) |
| 2 | Custo por análise, mínimo: US$ 0,1747 | idem | idem |
| 3 | Custo por análise, mediana: US$ 0,3478 | idem (cálculo sobre os 12 registros) | idem |
| 4 | Custo por análise, máximo: US$ 0,5146 | idem | idem |
| 5 | Custo total das análises: US$ 4,1348 (campo `total_usd`, confere com a soma dos 12) | idem | 2026-10-29 |
| 6 | Nenhum registro chegou a US$ 0,73 (teto citado no README, "US$ 0,45 a 0,73"); maior com 3 buscas: US$ 0,5146 | idem; `README.md` linha ~340 | 2026-10-29 |
| 7 | Extração Haiku, custo realizado (soma dos eventos `lote_concluido`): US$ 0,2314 em 21–29/10; por dia: 22/10 US$ 0,2056 (carga inicial), 29/10 US$ 0,0176, 26/10 US$ 0,0043, demais dias < US$ 0,001 | `docs/data/custo_ia.json` | 2026-10-21 a 2026-10-29 |
| 8 | Extração Haiku, teto estimado: US$ 0,344 por execução em batch (US$ 10,32/mês com 30 execuções), sobre 24.866 candidatos; "na prática só imóveis novos ou com edital alterado entram" | `custo_ia.json` → `estimativa_atual` | 2026-10-29 16:25 |
| 9 | Preços: R$ 14,90 (1) / R$ 59 (5 = R$ 11,80/cr) / R$ 199 (20 = R$ 9,95/cr); 1 crédito grátis por conta nova (`usuarios.creditos DEFAULT 1`) | `metrics.md`; `worker/schema.sql` | 2026-10-29 |
| 10 | Análise já gerada para um imóvel é entregue sem nova chamada de IA, mas o crédito é debitado (a tabela `relatorios` tem `id_imovel` como chave; `worker/src/index.js` ~linha 315 devolve `status: pronto`). Logo, o custo de IA por crédito consumido é **no máximo** o custo por análise nova | `worker/src/index.js` | 2026-10-29 |
| 11 | Marcos (git, horário de Brasília): contagem de visitas GoatCounter 2026-10-21 13:27; contas/créditos/Mercado Pago/funil no GoatCounter 2026-10-23 09:05 (`1d3e88b`); domínio próprio ayshaleiloes.com.br 2026-10-28 18:19 (`0698270`); Umami Cloud ligado 2026-10-29 09:33 (`18486ff`); alertas de imóveis 2026-10-29 10:10; e-mail Brevo no domínio 2026-10-29 10:32 | `git log` | 2026-10-29 |
| 12 | Eventos do funil confirmados no código: `login-pedido` (common.js), `conta-nova` / `login-ok` (conta.js, mesmo ponto: nova conta ou não), `analise-credito` (detalhe.js), `compra-iniciada` e `compra-paga` (conta.js), secundários `agenda-salva`, `agenda-ics`, `alerta-criado`. Coincide com metrics.md. Website ID Umami em `docs/js/config.js` | `docs/js/*.js`, `config.js` | 2026-10-29 |

**Testes x uso real nas análises (não dá para separar com segurança).** `custo_relatorios.json` não tem campo de usuário nem de origem. Evidência indireta: 10 dos 12 registros são de 22 a 24/10 e correspondem a commits de relatório/`--refazer` do mantenedor (`git log`: `relatórios: --refazer caixa-10208367` etc.), portanto são teste de desenvolvimento; os 2 de 29/10 (`caixa-8444401780792`, `caixa-8444416916504`) têm commits "relatórios:" do mesmo dia e provavelmente também são do mantenedor, mas isso é **inferência, não fato**. Conclusão: os custos acima são um retrato de testes, com buscas e esforço escolhidos pelo mantenedor; use-os como faixa de custo, não como média de uso de clientes.

**Divergência de documentação.** `metrics.md` diz "US$ 0,24–0,45 até 2026-10-29"; o arquivo atual mostra US$ 0,1747–0,5146 (12 registros). O intervalo do metrics.md está desatualizado (não editei; fica para o orquestrador/mantenedor corrigir).

### Tabelas do D1 que medem o funil (lista para o mantenedor consultar no admin)

Fonte: `worker/schema.sql`. Admin: `docs/admin.html` (só ADMIN_EMAILS); a consulta de pedidos lista até 300 pedidos com e-mail (`worker/src/index.js` ~linha 671).

| Pergunta | Tabela.coluna |
|---|---|
| Contas criadas no período | `usuarios.criado_em` |
| Créditos restantes por conta (quem ainda não usou o grátis) | `usuarios.creditos` |
| Análises pedidas / liberadas por conta | `acessos` (`usuario_id`, `id_imovel`, `liberado_em`, `origem`) |
| Análises pendentes | `analises_pendentes` |
| Compras | `pedidos` (`status` = `criado` / `pago` / `cancelado` / `cortesia`; `valor_centavos`, `pacote`, `creditos`, `pago_em`, `mp_payment_id`) |
| Custo real das análises no servidor | `relatorios.custo_usd`, `relatorios.gerado_em` |
| Engajamento secundário | `alertas.criado_em`, `agenda.criado_em` |

**Limitações de medição (importantes):**
1. `acessos.origem` é gravado sempre como `'credito'` na análise comum (`index.js` linha ~310); o valor `'gratis'` do comentário do schema não é usado. **Não dá para separar crédito grátis de pago só por `acessos.origem`.** Contornar: créditos grátis consumidos = contas novas do período com ≥ 1 linha em `acessos` (cada conta nova nasce com 1 crédito); ou `usuarios.creditos` = 0 sem nenhum `pedidos.status='pago'`.
2. Ajustes manuais e testes entram em `pedidos` com `status='cortesia'` e `valor_centavos=0`: excluir. A compra de teste do mantenedor (`status='pago'`, cartão) deve ser excluída por e-mail do mantenedor ou `pago_em` ≤ 2026-10-29.
3. Contas do mantenedor (ADMIN_EMAILS e e-mails de teste) devem ser excluídas das contagens de contas e de créditos grátis.

## 2. A preencher pelo mantenedor

Regra: copiar número absoluto, com o período e a data/hora da leitura. Não arredondar, não estimar. Fazer duas leituras: **L0 = até o fim de D4 (2026-11-01), antes do primeiro post** (baseline) e **L1 = D13 (2026-11-10)**.

**Coleta automatizada (2026-10-29):** `python scripts/coleta_metricas.py --rotulo L0` (e `--rotulo L1 --ate 2026-11-10`) preenche tudo abaixo — Umami pelo link de compartilhamento (Settings → Share; o plano grátis não tem chave de API), admin e taxa real do Mercado Pago via `GET /interno/metricas` do Worker (ou D1 direto pelo wrangler autenticado, sem a taxa) — e grava a leitura em `docs/business/leituras/`. Só o Google Search Console continua manual (copiar do painel). Configuração: `UMAMI_SHARE_URL` (ou `--share-url`) e, opcional, `INTERNO_SECRET` (cabeçalho do script explica). Não existe semana fechada com Umami ainda (ligado em 2026-10-29 09:33); a primeira semana cheia é 2026-10-30 a 2026-11-05, que atravessa o início do experimento, então o baseline útil é a janela D1–D4.

| Campo | Valor L0 (até 2026-11-01) | Valor L1 (D13) | Instrução |
|---|---|---|---|
| Câmbio R$/US$ | **R$ 5,00 — FIXADO pelo mantenedor em 2026-10-29**, vale para o ciclo todo | R$ 5,00 (fixo) | decisão do mantenedor (decision-log); não consultar cotação |
| Visitantes únicos desde 2026-10-29 09:33 | PENDENTE — mantenedor: copiar do painel Umami (cloud.umami.is → site → Overview, período "Custom" 29/10 a hoje) | PENDENTE — mantenedor: idem | |
| Pageviews desde 2026-10-29 09:33 | PENDENTE — mantenedor: copiar do painel Umami (Overview) | PENDENTE — mantenedor: idem | |
| Visitantes e pageviews da última semana fechada | PENDENTE — mantenedor: copiar do painel Umami (Overview, semana fechada; só existirá a partir de 2026-11-06 para 30/10–05/11) | PENDENTE — mantenedor: idem | |
| Top origens de tráfego (Referrers) e países | PENDENTE — mantenedor: copiar do painel Umami (Overview → Referrers) | PENDENTE — mantenedor: idem | para atribuir ao EXP |
| Evento `login-pedido` (contagem) | PENDENTE — mantenedor: copiar do painel Umami (Events) | PENDENTE | |
| Evento `conta-nova` | PENDENTE — mantenedor: copiar do painel Umami (Events) | PENDENTE | |
| Evento `login-ok` | PENDENTE — mantenedor: copiar do painel Umami (Events) | PENDENTE | |
| Evento `analise-credito` | PENDENTE — mantenedor: copiar do painel Umami (Events) | PENDENTE | |
| Evento `compra-iniciada` | PENDENTE — mantenedor: copiar do painel Umami (Events) | PENDENTE | |
| Evento `compra-paga` | PENDENTE — mantenedor: copiar do painel Umami (Events) | PENDENTE | atenção: a compra de teste do mantenedor, se ocorreu após ligar o Umami, entra aqui; informar |
| Contas totais e contas novas no período, sem as do mantenedor | PENDENTE — mantenedor: copiar do admin (`docs/admin.html`, contas) | PENDENTE | `usuarios.criado_em` |
| Contas que consumiram o crédito grátis (≥ 1 análise), sem as do mantenedor | PENDENTE — mantenedor: copiar do admin (contas/créditos; ver limitação 1) | PENDENTE | |
| Créditos grátis ainda não usados (contas novas com `creditos` = 1 e sem compra) | PENDENTE — mantenedor: copiar do admin (contas) | PENDENTE | exposição de custo em aberto |
| Compras `pago` sem teste/cortesia: nº, valor bruto, pacote de cada uma | PENDENTE — mantenedor: copiar do admin (compras) | PENDENTE | |
| Custo real das análises do período no servidor (`relatorios.custo_usd`) | PENDENTE — mantenedor: copiar do admin (relatórios) | PENDENTE | |
| Pagamentos aprovados no Mercado Pago (nº e valor bruto) e taxa real cobrada por transação (R$ e meio: Pix/cartão) | PENDENTE — mantenedor: copiar do painel do Mercado Pago (Atividade/Vendas → detalhe do pagamento → "Tarifa"; caminho exato pode variar, confirmar na tela) | PENDENTE | confirmar a taxa de ~1 % Pix e ~5 % cartão; não registrar dados de cartão nem do pagador |
| Impressões e cliques no Google Search Console (propriedade ayshaleiloes.com.br, desde 28/10) | PENDENTE — mantenedor: copiar do Google Search Console (Desempenho → Resultados da pesquisa → período personalizado; cliques totais e impressões totais) | PENDENTE | domínio verificado em 2026-10-29 |
| Alertas criados (`alertas`) e agendas salvas | PENDENTE — mantenedor: copiar do admin | PENDENTE | secundárias |

**Câmbio: o mantenedor fixou R$ 5,00 por US$ 1,00 em 2026-10-29** (vale para todo o ciclo; sem consulta de cotação). As seções 3 em diante foram calculadas **antes** disso, com a premissa antiga de R$ 5,40: os valores em R$ ali estão ~7–8 % acima do que dá com 5,00 (a direção das conclusões não muda — margens ficam ligeiramente maiores, custos menores). Recalcular com 5,00 na tarefa 1b (recalcular o baseline com a leitura L0).

## 3. PROJEÇÃO — Margem de contribuição por crédito

Fórmula (metrics.md): preço por crédito − taxa MP proporcional − custo variável por análise. Câmbio R$ 5,40 (premissa). Custo variável em três níveis, todos **observados** em US$ (seção 1) e convertidos pela premissa de câmbio: mediana US$ 0,3478 = R$ 1,88; máximo observado US$ 0,5146 = R$ 2,78; teto do README US$ 0,73 = R$ 3,94. Taxa MP: premissa 1 % Pix / 5 % cartão (a confirmar no extrato). A extração Haiku é desprezível por análise (< US$ 0,01, README) e não foi somada.

| Item | Custo R$ 1,88 (mediana) | Custo R$ 2,78 (máx. observado) | Custo R$ 3,94 (teto README) |
|---|---|---|---|
| Avulso R$ 14,90, Pix | R$ 12,87 (86 %) | R$ 11,97 (80 %) | R$ 10,81 (73 %) |
| Avulso R$ 14,90, cartão | R$ 12,28 (82 %) | R$ 11,38 (76 %) | R$ 10,21 (69 %) |
| Pacote 5 (R$ 11,80/cr), Pix | R$ 9,80 (83 %) | R$ 8,90 (75 %) | R$ 7,74 (66 %) |
| Pacote 5, cartão | R$ 9,33 (79 %) | R$ 8,43 (71 %) | R$ 7,27 (62 %) |
| Pacote 20 (R$ 9,95/cr), Pix | R$ 7,97 (80 %) | R$ 7,07 (71 %) | R$ 5,91 (59 %) |
| Pacote 20, cartão | R$ 7,57 (76 %) | R$ 6,67 (67 %) | R$ 5,51 (55 %) |

Leitura: mesmo no pior caso (pacote 20, cartão, custo no teto), cada crédito pago deixa R$ 5,51; a margem não é o gargalo, a demanda é. Custo de aquisição embutido: cada crédito grátis consumido custa R$ 1,88 a R$ 3,94 (mediana a teto); **um avulso pago em cartão no custo mediano paga cerca de 6 créditos grátis** (12,28 / 1,88 = 6,5), e no custo teto cerca de 2 (10,21 / 3,94 = 2,6). Fixos ≈ 0, então o ponto de equilíbrio operacional é trivial (metrics.md).

Ressalva: o custo observado vem de testes do mantenedor (seção 1), não de clientes; revisar com `relatorios.custo_usd` do admin em L1.

## 4. PROJEÇÃO — Teto de gasto global do ciclo (14 dias, D1–D14)

Todas as linhas são premissas/propostas; câmbio R$ 5,40 (premissa). Precisa de aprovação do mantenedor.

| Linha | Teto proposto | Conta |
|---|---|---|
| IA dos créditos grátis (EXP-2026-01 e orgânico do ciclo) | **R$ 100,00** | 25 créditos grátis consumidos × US$ 0,73 (teto do README) × 5,40 = R$ 98,55, arredondado. Na mediana observada (US$ 0,3478) o mesmo teto aguenta ~53 créditos; no máximo observado (US$ 0,5146), ~36. O teto de contagem usa o pior caso, por prudência. |
| Extração Haiku do período | R$ 10,00 | Realizado recente ≈ US$ 0,0176/dia (29/10) × 14 × 5,40 ≈ R$ 1,33; metrics.md cita ≈ US$ 0,02/dia (R$ 1,51 em 14 dias); teto do pior caso diário é US$ 0,344 por execução (R$ 26 em 14 execuções, improvável pois só entram imóveis novos). R$ 10 cobre ~7x o realizado. Já é gasto existente, não do experimento. |
| Mídia paga | R$ 0,00 | não prevista no plano |
| Custos fixos (domínio) | R$ 2,00 | R$ 40/ano × 14/365 = R$ 1,53; demais serviços em planos gratuitos |
| **Total** | **R$ 112,00** | |

Fora do teto (variável com a venda): taxa do Mercado Pago e custo de IA dos créditos **pagos** (já descontados na margem da seção 3 e cobertos pela receita da própria venda).

O teto do experimento é a linha "IA dos créditos grátis": **R$ 100,00 = 25 créditos grátis consumidos**. Perda máxima aceitável do ciclo (se não vender nada): R$ 112,00.

### Regra de parada (objetiva)

Contagem: "créditos grátis consumidos" = contas novas do período, sem as do mantenedor, com ≥ 1 análise (admin; ver limitação 1 da seção 1). "Exposição" = consumidos + créditos grátis ainda não usados de contas novas do período.

1. **Gatilho de alerta**: se **15 créditos grátis forem consumidos e houver 0 `compra-paga`** (de conta que não seja do mantenedor), **pausar a publicação em novas comunidades** e avaliar antes de continuar (custo nesse ponto: R$ 28 na mediana observada, R$ 59 no teto).
2. **Gatilho de parada**: **exposição ≥ 25 créditos** (R$ 98,55 no teto) = parar de divulgar. Retomar só com aprovação do mantenedor, e apenas se houver ≥ 1 `compra-paga` real (a margem da seção 3 mostra que 1 avulso paga ~2 a 6 grátis).
3. Se algum registro de análise nova passar de US$ 0,73, ou se o custo médio por análise do período passar de US$ 0,60, avisar o mantenedor antes de seguir (usa a folga entre o máximo observado e o teto).
4. Se o admin mostrar mais de 5 contas novas por dia vindas de uma única origem, revisar abuso (contas descartáveis); o crédito grátis é por e-mail, não por pessoa. Não é medido hoje; apenas observar.

## 5. PROJEÇÃO — Metas de tração do ciclo (três cenários)

Tudo abaixo é **premissa** (P). Não há referência de mercado nem dado do funil para ancorá-las: o baseline (seção 2) é zero conhecido ou pendente. Servem para definir o que seria "bom o bastante" e devem ser revistas com a leitura L0. Duração do experimento: D5–D12 (8 dias).

| Etapa | Conservador | Base | Otimista |
|---|---|---|---|
| Alcance nas comunidades (pessoas que veem o post, P) | 1.000 | 3.000 | 4.000 |
| Alcance → visita (P) | 2 % → 20 | 3 % → 90 | 4 % → 160 |
| Visita → conta nova (P) | 25 % → 5 | 30 % → 27 | 30 % → 48 |
| Conta → 1ª análise (usa o grátis) (P) | 80 % → 4 | 80 % → 22 (21,6) | 85 % → 41 |
| Análise grátis → compra (P) | 25 % → 1 | 10 % → 2 | 12 % → 5 |
| **Clientes pagantes (absoluto)** | **1** | **2** | **5** |
| Compras assumidas (P) | 1 avulso, cartão | 1 avulso Pix + 1 pacote 5 cartão | 2 avulsos Pix, 1 avulso cartão, 1 pacote 5 Pix, 1 pacote 20 cartão |
| Receita bruta | R$ 14,90 | R$ 73,90 | R$ 302,70 |
| Taxa MP (P: 1 % Pix, 5 % cartão) | R$ 0,75 | R$ 3,10 | R$ 11,58 |
| **Receita líquida** | **R$ 14,16** | **R$ 70,80** | **R$ 291,12** |
| Créditos grátis consumidos (P) | 4 | 22 | 41 |
| Créditos pagos consumidos (P: todos usados) | 1 | 6 | 28 |
| IA total no custo mediano R$ 1,88/análise | R$ 9,39 | R$ 52,58 | R$ 129,57 |
| **Líquido após IA (não inclui fixos de R$ 2)** | **R$ 4,77** | **R$ 18,22** | **R$ 161,54** |
| Dentro do teto de 25 créditos grátis? | sim (4) | sim (22) | **não (41)**: a regra de parada seria acionada |

Contas de conferência (reproduzíveis): base: bruto 14,90 + 59,00 = 73,90; taxa 14,90 × 1 % + 59 × 5 % = 0,149 + 2,95 = 3,10; líquido 70,80; IA (22 + 6) × 1,878 = 52,58. Otimista: bruto 14,90 × 3 + 59 + 199 = 302,70; taxa = 0,149 × 2 + 0,745 + 0,59 + 9,95 = 11,58; IA (41 + 28) × 1,878 = R$ 129,57 (créditos pagos: 1 + 1 + 1 + 5 + 20 = 28).

Observações:
- O número relevante é o de **clientes pagantes, em absoluto**; com 1 a 5 compras, qualquer taxa de conversão é indicativa, não estatística (metrics.md, regra 4). As taxas de conversão acima são suposições de trabalho, não previsões.
- No cenário otimista o teto de IA grátis (R$ 100) seria excedido; a regra de parada é um freio, não a meta. Se o otimista ocorrer (≥ 1 compra com 25 créditos consumidos), o mantenedor pode elevar o teto com base na margem da seção 3.
- Este ciclo não paga CAC em dinheiro; o custo de aquisição monetário é o IA dos grátis. CAC por canal = custo de IA dos créditos grátis do canal / clientes pagantes do canal: conservador ≈ R$ 7,51 / 1 (4 grátis × 1,878), base ≈ R$ 41,32 / 2 = R$ 20,66, mesmo sem contar o esforço (horas do mantenedor: registrar no experimento).

### Meta mínima recomendada para o critério "perseverar" (D13–14)

Recomendo **o cenário base como mínimo para "perseverar": ≥ 2 clientes pagantes, de 2 contas distintas, ambas independentes do mantenedor (`pedidos.status = 'pago'`, `compra-paga` e pagamento aprovado no MP concordando)**, dentro do teto de 25 créditos grátis.
- 1 cliente pagante (conservador) = sinal fraco: **ajustar** (preço, segmento ou texto) e repetir, não perseverar; um comprador só pode ser conhecido/indicado.
- 0 clientes pagantes com ≥ 15 créditos grátis consumidos = **mudar canal ou segmento** (coerente com o gatilho 1).
- 0 clientes com poucas contas (< 5) = o experimento não testou a oferta (alcance insuficiente); estender o canal, não concluir sobre preço.
- Justificativa: com fixos ≈ 0, qualquer venda é lucrativa; o que está em jogo é a evidência de disposição a pagar de gente que não conhece o mantenedor. Duas compras independentes é o menor número que não depende de um único caso.

## 6. Riscos financeiros

1. **Custo por análise cresce** (3 buscas, documentos maiores): máximo observado já subiu de US$ 0,45 (citado no metrics.md) para US$ 0,5146; teto README US$ 0,73. Monitorar por `relatorios.custo_usd`.
2. **Abuso do crédito grátis** (várias contas por pessoa): custo de IA sem receita; mitigado pelo teto de contagem e pelo gatilho 4. O sistema não limita por pessoa.
3. **Taxa do MP real diferente de 1 %/5 %**, ou impostos sobre a receita: não modelados; metrics.md não registra impostos. **Pergunta ao mantenedor:** há tributação (MEI/Simples) a considerar na margem? Não presumi.
4. **Falta de medição de grátis x pago** (`acessos.origem` sempre `credito`): atrasa a leitura do experimento; sugerir ao builder-qa registrar `origem='gratis'` na primeira análise de uma conta (mudança de código; só com aprovação do mantenedor).
5. **Projeção sem âncora**: seção 5 é premissa pura; não usar como previsão de receita.

## 7. Delegações recomendadas

- **builder-qa** (com aprovação do mantenedor, mudança em `worker/`): gravar `acessos.origem = 'gratis'` quando o crédito consumido for o inicial, e registrar a origem de aquisição (UTM ou `ref`) na criação da conta; permitiria medir o EXP-2026-01 diretamente no admin em vez de inferir.
- **growth-marketer**: usar o teto (25 créditos grátis) e as regras de parada ao desenhar as 2–3 comunidades e a quantidade de posts; incluir link com parâmetro de origem rastreável pelo Umami.
- **orquestrador**: corrigir em metrics.md o intervalo de custo observado (US$ 0,1747–0,5146) e registrar o teto e as metas deste documento no decision-log depois da aprovação do mantenedor.
- **market-researcher**: opcionalmente fornecer âncoras externas de conversão e preço para substituir as premissas da seção 5 (hoje sem referência de mercado).
