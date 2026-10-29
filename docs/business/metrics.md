# Métricas comerciais e financeiras

Definições únicas para toda a equipe. Quem citar uma métrica usa o nome e a definição daqui.
Regra geral: **separar sempre número observado de projeção**. Observado tem fonte e data; projeção tem premissas escritas e três cenários (conservador / base / otimista).

## Fontes de dados (onde medir)

| Fonte | O que dá | Acesso |
|---|---|---|
| Umami Cloud | visitas, visitantes únicos, páginas, origem do tráfego, eventos do funil | painel cloud.umami.is (Website ID em `docs/js/config.js`) |
| Worker D1 (`worker/schema.sql`) + `admin.html` | contas, créditos, compras, análises, alertas | página admin (só ADMIN_EMAILS) |
| Mercado Pago | pagamentos aprovados, taxas reais, estornos | painel do MP |
| `docs/data/custo_relatorios.json` | custo real de cada análise (tokens e US$) | repositório |
| `docs/data/custo_ia.json` | custo da extração em lote (Haiku) | repositório |
| Google Search Console / Bing | impressões, cliques, posição por página | painéis (verificados em 2026-10-29) |

## Funil (eventos já instrumentados no Umami)

Ordem do funil de receita. Nomes exatos dos eventos (enviados por `docs/js/common.js` e páginas):

1. **Visita** — pageview (caminho sem query string; ficha = `/imovel/<id>`)
2. `login-pedido` — pediu o link mágico
3. `conta-nova` — primeira entrada (ganha 1 crédito grátis)
4. `login-ok` — entrou (nova ou recorrente)
5. `analise-credito` — pediu uma análise (gastou crédito, inclusive o grátis)
6. `compra-iniciada` — abriu o checkout do Mercado Pago
7. `compra-paga` — webhook confirmou o pagamento ✅ **a métrica que importa**
8. Secundários: `agenda-salva`, `agenda-ics`, `alerta-criado` (engajamento/retenção)

Taxas de conversão derivadas (medir por período, ex.: semana):
- **Visita → conta** = contas novas / visitantes únicos
- **Conta → 1ª análise** = contas que usaram o crédito grátis / contas novas
- **Análise grátis → compra** = compradores pagantes / contas que usaram o grátis ("a conversão do produto")
- **Checkout** = `compra-paga` / `compra-iniciada` (proteção: queda indica problema técnico ou de confiança)

## Receita

- **Receita bruta** — soma dos pagamentos aprovados no MP no período (R$). Observada, nunca estimada.
- **Receita líquida** — bruta − taxa do MP (medida por transação: Pix ≈ 1 %, cartão ≈ 5 %; usar a taxa real do extrato).
- **Cliente pagante** — conta com ≥ 1 `compra-paga`. Cadastro grátis, visita, elogio ou análise grátis **não** contam.
- **Ticket médio** — receita bruta / nº de compras.
- **MRR / ARR** — só se aplicam quando existir cobrança recorrente (assinatura). Hoje o modelo é avulso (créditos); não usar MRR para receita de pacotes. Se assinatura for lançada: MRR = soma das mensalidades ativas; ARR = MRR × 12.

## Custos

- **Custo variável por análise** — custo da chamada ao Opus 5 + extração Haiku. Observado até 2026-10-29: **US$ 0,1747–0,5146 por parecer, mediana US$ 0,3478** (12 registros, 6 imóveis, 22–29/10, todos provavelmente testes do mantenedor; fonte `custo_relatorios.json`, levantado em [baseline-ciclo-01.md](baseline-ciclo-01.md)). O intervalo anterior citado aqui (US$ 0,24–0,45) estava desatualizado. O README cita teto de US$ 0,73 com 3 buscas e esforço médio, usado como pior caso nos tetos. Converter pelo câmbio do dia e anotar o câmbio usado.
- **Custo de pagamento** — taxa do MP por transação (acima).
- **Custos fixos** — hoje ≈ 0: domínio (~R$ 40/ano), Cloudflare Workers/D1, Umami, Brevo e GitHub Actions nos planos gratuitos. Reavaliar se o volume estourar algum free tier (anotar os limites quando o primeiro alerta de cota chegar).
- **Custo de aquisição (CAC)** — gasto de aquisição no canal / clientes pagantes vindos do canal, no período. Canais sem gasto direto (SEO, alertas) têm CAC monetário ≈ 0 mas custo de esforço — registrar horas gastas no experimento.

## Unidade econômica

- **Margem de contribuição por crédito** = preço por crédito − taxa MP proporcional − custo variável por análise.
  Preços vigentes (hipótese, sem teste de preço): R$ 14,90 (1), R$ 59 (5 → R$ 11,80/cr), R$ 199 (20 → R$ 9,95/cr).
  Exemplo base (câmbio R$ 5,40, análise US$ 0,45 ≈ R$ 2,43, cartão 5 %): crédito avulso ≈ R$ 14,90 − 0,75 − 2,43 ≈ **R$ 11,72 (79 %)**; crédito do pacote 20 ≈ R$ 9,95 − 0,50 − 2,43 ≈ **R$ 7,02 (71 %)**. Recalcular com números reais a cada análise.
  Atenção: créditos grátis consumidos também custam (≈ R$ 2,43 cada) — contam como custo de aquisição.
- **Payback de CAC** = CAC / margem de contribuição média por cliente. Com produto avulso, medir por safra (cohort) de clientes.
- **Ponto de equilíbrio** = custos fixos / margem média por venda. Com fixos ≈ 0, o ponto de equilíbrio operacional é trivial; a meta relevante é de **tração**, não de equilíbrio (defina meta de clientes pagantes/mês no plano vigente).
- **Clientes para meta de receita** = meta mensal (R$) / ticket médio esperado. Apresentar nos três cenários.

## Regras de qualidade do dado

1. Todo número reportado vem com **fonte e data**. Sem fonte = não existe.
2. Período fechado (semana/mês) antes de comparar; não comparar semana parcial com semana cheia.
3. Compras de teste do mantenedor são excluídas das métricas (marcar no admin).
4. Amostras pequenas: com menos de ~30 eventos na etapa, reportar números absolutos, não porcentagem com cara de verdade estatística.
5. Projeções sempre em três cenários com premissas explícitas e nunca misturadas com observados na mesma tabela sem rótulo.

---
Baseline do ciclo 01 e teto de gasto: [baseline-ciclo-01.md](baseline-ciclo-01.md)
