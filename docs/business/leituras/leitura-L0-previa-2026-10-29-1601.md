# Leitura L0-previa — métricas do baseline (ciclo 01)

Gerada por `scripts/coleta_metricas.py` em 2026-10-29 16:01 (Brasília).
Período: 2026-10-29 09:33 a 2026-10-29 16:01 (Brasília).
Câmbio: **R$ 5,00 por US$ 1,00, fixado pelo mantenedor em 2026-10-29** (decision-log); não é cotação do dia.

| Campo | Valor | Fonte |
|---|---|---|
| Visitantes únicos | 2 | Umami (share) |
| Pageviews | 2 | Umami (share) |
| Semana fechada 30/10–05/11 (visitantes / pageviews) | ainda não existe (só a partir de 2026-11-06) | Umami (share) |
| Top referrers | (nenhum) | Umami (share) |
| Top países | BR: 2 | Umami (share) |
| Evento `login-pedido` | 0 | Umami (share) |
| Evento `conta-nova` | 0 | Umami (share) |
| Evento `login-ok` | 0 | Umami (share) |
| Evento `analise-credito` | 0 | Umami (share) |
| Evento `compra-iniciada` | 0 | Umami (share) |
| Evento `compra-paga` | 0 | Umami (share) |
| Evento `agenda-salva` | 0 | Umami (share) |
| Evento `agenda-ics` | 0 | Umami (share) |
| Evento `alerta-criado` | 0 | Umami (share) |
| Contas totais / novas no período (sem as do mantenedor) | 1 / 1 | D1 via wrangler |
| Créditos grátis consumidos (contas novas com ≥ 1 análise) | 1 | D1 via wrangler (limitação 1 do baseline) |
| Créditos grátis em aberto (contas novas, crédito parado, sem compra) | 0 | D1 via wrangler |
| Análises liberadas no período (sem as do mantenedor) | 1 | D1 via wrangler (`acessos`) |
| Compras pagas de clientes: nº / valor bruto | 0 / R$ 0,00 | D1 via wrangler (`pedidos`, sem cortesia nem mantenedor) |
| Compras de teste do mantenedor no período | 1 | D1 via wrangler |
| Compra 1 (TESTE do mantenedor) | pacote 1, R$ 14,90, taxa MP ? (rodar com INTERNO_SECRET ou ver no painel do MP), meio ?, pago em 2026-10-29T12:55:04.931Z | D1 via wrangler |
| Custo real das análises no período (`relatorios.custo_usd`) | US$ 0.3909 = R$ 1,95 (1 relatórios) | D1 via wrangler |
| Alertas criados / agendas salvas no período | 0 / 0 | D1 via wrangler |
| Análises pendentes agora | 0 | D1 via wrangler |
| Google Search Console: cliques / impressões | PENDENTE — **manual**: copiar do painel (Desempenho → Resultados da pesquisa, período personalizado) e colar aqui | GSC (sem API configurada) |

Dados crus no `.json` ao lado. Próximo passo: colar o valor do GSC e usar esta leitura no baseline (seção 2).
