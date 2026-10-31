# Registro de decisões

Toda decisão comercial relevante entra aqui: o que foi decidido, por quem, com base em quê, e o que a reverteria. Decisões de experimento também apontam para a entrada correspondente em [experiment-log-template.md](experiment-log-template.md).

Formato de cada entrada:

```markdown
## AAAA-MM-DD — <decisão em uma linha>
- **Contexto**: o problema ou oportunidade
- **Alternativas consideradas**: o que foi descartado e por quê
- **Evidência**: dados/fatos que sustentaram (com fonte) — ou "nenhuma; decisão por hipótese"
- **Decisão**: o que foi feito; quem aprovou (mantenedor / agente)
- **Reverteria se**: condição observável que faria voltar atrás
```

---

## Decisões anteriores à criação da equipe (reconstruídas do README e do histórico git)

As entradas abaixo foram reconstruídas em 2026-10-29 a partir da documentação do repositório; servem de contexto, não de registro contemporâneo.

## 2026-10-21 — Ligar a etapa de IA de extração com teto de custo
- **Evidência**: estimativa de custo apresentada e aprovada (Batch API do Haiku; ~US$ 0,02/dia para 50 imóveis).
- **Decisão**: IA só preenche campos nulos, com cache permanente e tetos de US$ 0,50/execução.

## 2026-10-22/23 — Modelo de negócio: análise paga por créditos, 1ª grátis
- **Contexto**: monetizar o parecer gerado pelo Opus 5 (custo US$ 0,24–0,73/análise).
- **Decisão**: créditos a R$ 14,90 (1) / R$ 59 (5) / R$ 199 (20), via Mercado Pago, 1 crédito grátis por conta nova. **Preços são hipótese: nunca passaram por teste com clientes reais.**
- **Reverteria se**: a conversão grátis→pago ficar nula com tráfego relevante, ou teste de preço indicar outro ponto.

## 2026-10-23 — Sair do GitHub Pages para Cloudflare Workers
- **Evidência**: termos do GitHub Pages proíbem sites de comércio; o site vende créditos.
- **Decisão**: Worker com assets estáticos; deploy via `publicar.yml`.

## 2026-10-28 — Domínio próprio ayshaleiloes.com.br
- **Decisão**: registro e migração completa (301 dos hosts antigos, Search Console e Bing verificados, sitemaps processados: 435 + 24.186 páginas).

## 2026-10-29 — Analytics: GoatCounter → Umami Cloud
- **Evidência**: GoatCounter hospedado é para sites não comerciais.
- **Decisão**: Umami Cloud (grátis até ~100 mil eventos/mês), eventos do funil instrumentados.

## 2026-10-29 — Funil de compra validado tecnicamente
- **Evidência**: compra real de teste com cartão (webhook + crédito ok); chave Pix cadastrada; e-mail transacional no domínio via Brevo; alertas de imóveis por e-mail no ar.
- **Decisão**: funil técnico considerado pronto; o gargalo passa a ser **demanda**, não infraestrutura.

---

## Decisões da equipe

## 2026-10-31 — Criação da equipe técnica: 9 agentes de engenharia + docs/tech/; destino do builder-qa proposto
- **Contexto**: o mantenedor pediu (prompt_agentes_tecnologia.md) uma equipe técnica integrada à comercial, com cadeia `startup-orchestrator` → `cto-architect` → engenheiros (3 níveis, o máximo da instalação).
- **Decisão** (mantenedor, 2026-10-31, ao executar o prompt): criados em `.claude/agents/`: `cto-architect` (opus, único técnico com `Agent`; decide COMO, atribui donos de arquivos por rodada neste log, revisa, escreve ADRs, não edita código), `backend-engineer`, `frontend-engineer`, `database-engineer`, `data-engineer`, `devops-sre`, `qa-engineer` (só edita teste), `security-engineer` (revisão, sem Bash, não edita produção) e `performance-engineer` (só edita o que o CTO atribuir). Todos opus, com o bloco comum técnico (validação comercial, stack fixa, planos grátis, LGPD, segredos, testes, lista de aprovações, nunca push). Criado `docs/tech/` (README com o mapa, `adr/` numerado com modelo, `runbooks/`), **interno** via `docs/.assetsignore`. O `startup-orchestrator` passou a delegar trabalho técnico ao `cto-architect` (não mais direto ao builder-qa); `conversion-optimizer` especifica interface e `frontend-engineer` implementa.
- **Destino do `builder-qa` — DECIDIDO (mantenedor, 2026-10-31): opção (b)** — mantido como implementador genérico de tarefas pequenas e isoladas, chamadas direto da sessão principal (sem passar pela cadeia CTO → engenheiro). Tarefas maiores ou de área sensível vão ao cto-architect. Arquivo do agente atualizado nesse sentido; a alternativa (a), aposentar em `_arquivados/`, foi descartada.
- **Proposta de `.claude/settings.json` com regras deny — RECUSADA (mantenedor, 2026-10-31)**: arquivo não criado; deploy, push, secrets e comandos remotos seguem protegidos pelas regras de comportamento dos agentes e pelas permissões normais da sessão, não por deny no harness.
- **Evidência**: nenhuma; decisão organizacional do mantenedor.
- **Reverteria se**: a cadeia de 3 níveis gerar mais latência/custo que qualidade (sinal: tarefas pequenas levando dias ou estouro de custo de agentes) — voltar a um implementador único.

## 2026-10-31 — Todas as 8 correções de SEO on-page implementadas e aprovadas para deploy
- **Contexto**: a auditoria ([auditoria-seo-onpage-ciclo-01.md](auditoria-seo-onpage-ciclo-01.md)) listou 8 correções priorizadas. O mantenedor aprovou **todas** ("pode prosseguir com todas as sugestões") e dispensou a linha de base do GSC por estar ≈ zero.
- **Decisão**: builder-qa implementou as 8 (robots liberando `imoveis_*/og_*/meta.json`; resumo servidor-side no lugar do "carregando…"; links de cidades na home; listagens paginadas a 100 + `outras-cidades` + vizinhos na ficha → **0 fichas órfãs** de 24.591 no sitemap, antes 54% órfãs; 404 real com `X-Robots-Tag: noindex` e sitemap sem encerradas; "leilão"+fonte no title/description; H1 correto em todas as páginas indexáveis; comparação preço/m² e desconto por regra, sem IA; `lastmod` honesto e `availability` coerente). Commit e deploy aprovados pelo mantenedor nesta data.
- **Evidência**: 84 testes pytest + 8 testes Node passando; geração validada com os dados reais (24.827 ativos) em diretório temporário; Worker medido localmente em 24–45 ms/ficha com o og de RJ (1,8 MB).
- **Efeito**: parte vale no deploy (Worker, robots, home, HTML estático); listagens paginadas, sitemap limpo e lastmod só na **próxima coleta**.
- **Acompanhamento (mantenedor)**: após deploy + coleta, reenviar sitemaps no GSC, inspecionar 3–5 fichas (HTML renderizado) e ler aos 14 e 28 dias: indexadas, Soft 404, "Descoberta/Rastreada, não indexada". Observar CPU do Worker.
- **Reverteria se**: erro no site após deploy (`git revert` + novo deploy; mudanças separáveis), CPU do Worker estourar, ou as ~250 páginas novas de listagem ficarem "Rastreada, não indexada" (reavaliar paginação).

## 2026-10-31 — Publicação antecipada pelo mantenedor; GSC ≈ zero; auditoria SEO on-page antecipada para D3
- **Contexto**: D3. O cronograma proposto (posts em 02/04/06-11) existia só pela atribuição por janela de horário (≥ 48 h entre posts, seção e dos rascunhos), não por exigência externa.
- **Decisões** (mantenedor, 2026-10-31):
  1. **Publicação do EXP-2026-01 antecipada**: o mantenedor já começou a postar em grupos de Facebook e também no **LinkedIn** (canal adicional, fora do plano original). Pendente: ele anotar **data, hora e grupo/canal de cada post** já feito e dos próximos — sem isso a atribuição por janela de tempo não funciona. Recomendação mantida: ≥ 48 h entre posts em grupos *diferentes* quando possível.
  2. **Leitura manual do GSC (31/10)**: 1 clique acumulado, provavelmente o próprio mantenedor testando. Tráfego de busca ≈ zero — esperado para domínio registrado em 28/10; a autoexclusão `#nao-contar` vale só para o Umami, não para o GSC.
  3. **Auditoria de SEO on-page antecipada de D5 para D3** (conversion-optimizer): só diagnóstico e proposta, sem deploy; relatório em `auditoria-seo-onpage-ciclo-01.md`.
- **Evidência**: posts iniciados (informado pelo mantenedor); GSC lido por ele em 31/10.
- **Reverteria se**: reclamação de spam ou remoção de post (mitigação da seção f dos rascunhos) → pausar publicações e voltar ao protocolo espaçado.

## 2026-10-30 — Entrevistas canceladas; taxa MP fixa de 5 %; triagem concluída (8 grupos, todos permitem)
- **Contexto**: D2 do ciclo. O mantenedor fez a triagem das comunidades e passou três decisões nesta sessão.
- **Decisões** (mantenedor, 2026-10-30):
  1. **Item 3 do plano (5 entrevistas) CANCELADO.** Consequência: a evidência de disposição a pagar deste ciclo vem só do EXP-2026-01 (`compra-paga`); o benchmark de preço/grátis de D10 (tarefa F1) usa os dados do experimento, não entrevistas; a contingência "sem comunidade elegível → sinal vem das entrevistas" perde o objeto (todas as comunidades permitem postar).
  2. **Taxa do Mercado Pago: fixa de 5 % por transação, em qualquer meio** (informado pelo mantenedor). `metrics.md` atualizado; as linhas com "Pix 1 %" do baseline (seções 3 e 5) serão recalculadas na tarefa 1b (D5).
  3. **Triagem concluída**: 8 grupos públicos de Facebook, todos permitem postar — tabela e proposta das 3 comunidades finais (C1 118,3 mil · C2 12,4 mil SP judicial · C3 16,9 mil) na seção g de [rascunhos-exp-2026-01.md](rascunhos-exp-2026-01.md), aguardando confirmação do mantenedor e verificação de atividade dos grupos.
  4. **Textos V1/V2 revisados** a pedido do mantenedor para valorizar a comparação de preço da IA (preço do m² no bairro; anúncio na mesma rua/prédio quando encontra — `collector/relatorio.py:63`).
- **Evidência**: triagem feita pelo mantenedor nos grupos; taxa informada por ele (confirmável no extrato do MP); capacidade da IA conferida no código.
- **Reverteria se**: o EXP terminar sem compra e sem aprendizado acionável — reavaliar conversas diretas com clientes (entrevistas) no ciclo 2.

## 2026-10-29 — Teto de gasto e meta do ciclo 01 APROVADOS; leitura L0/L1 fica por conta da coleta automática
- **Contexto**: a rodada D1–2 deixou propostas aguardando aprovação (baseline, seções 4–5) e a tarefa 1 (leitura L0 até 2026-11-01) atribuída ao mantenedor.
- **Decisão** (mantenedor, 2026-10-29, nesta sessão):
  1. **Teto de gasto do ciclo APROVADO: R$ 112** (R$ 100 de IA dos créditos grátis = 25 créditos no pior caso, R$ 10 de Haiku, R$ 2 de fixos, R$ 0 de mídia), com as regras de parada do baseline (15 grátis consumidos sem `compra-paga` → pausar novas comunidades; exposição ≥ 25 créditos → parar).
  2. **Meta de tração APROVADA**: ≥ 2 clientes pagantes independentes até 2026-11-09 → perseverar; 1 → ajustar; 0 com ≥ 15 grátis consumidos → mudar canal ou segmento.
  3. **Leituras L0 e L1 pela coleta automática** (`scripts/coleta_metricas.py`), não à mão: L0 em 2026-11-01 (fim do dia) e L1 em 2026-11-10.
- **Evidência**: proposta fundamentada em [baseline-ciclo-01.md](baseline-ciclo-01.md), seções 4–6.
- **Operacional**: com autorização expressa do mantenedor (2026-10-29), as duas leituras foram registradas no Agendador de Tarefas do Windows: "aysha leitura L0" (2026-11-01 23:50) e "aysha leitura L1" (2026-11-10 23:50), com `StartWhenAvailable` (se o computador estiver desligado no horário, roda ao ligar). Elas geram os arquivos em `docs/business/leituras/`; transferir os números para a tabela do baseline é parte da tarefa 1b (recálculo, D5). Continuam manuais: taxa real do MP (definir `INTERNO_SECRET` nas variáveis de ambiente do usuário para automatizar) e Google Search Console.
- **Reverteria se**: regra de parada acionada, custo por análise acima de US$ 0,73, ou câmbio real fora de ±10 % dos R$ 5,00 fixados.
- **Contexto**: a tarefa 1 do plano (preencher os PENDENTES do baseline) era manual: copiar números de 4 painéis (Umami, admin, Mercado Pago, GSC) e informar o câmbio do dia.
- **Decisão** (mantenedor, 2026-10-29): (a) **câmbio fixo de R$ 5,00 por US$ 1,00 em todas as contas e coletas** — sem consulta a PTAX ou fatura; (b) automatizar a coleta: novo `GET /interno/metricas` no Worker (header `X-Interno`, só agregados, sem e-mail de ninguém; a taxa real por compra vem da API do Mercado Pago, consultada pelo próprio Worker com o token que já é segredo dele) + `scripts/coleta_metricas.py`, que junta Umami e Worker numa leitura em `docs/business/leituras/` (rotulada L0/L1). O Umami é lido pelo **link de compartilhamento** (Settings → Share): o plano grátis do Umami Cloud não emite chave de API ("API access requires a Pro plan", constatado pelo mantenedor em 2026-10-29), e o script troca o link pelo token somente-leitura da própria página pública. Sem `INTERNO_SECRET` no ambiente, o script consulta o D1 direto pelo wrangler autenticado (mesmos números, sem a taxa real do MP). Nenhum segredo novo no repositório.
- **Alternativas consideradas**: consultar PTAX automaticamente (descartado: o mantenedor preferiu valor fixo, mais simples e estável no ciclo); automatizar também o Google Search Console (descartado neste ciclo: exigiria OAuth/projeto no Google Cloud para 2 números — continua cópia manual do painel).
- **Evidência**: nenhuma; decisão operacional do mantenedor.
- **Pendências para valer**: nenhuma — Worker publicado (aprovado pelo mantenedor em 2026-10-29) e Share do Umami ativado no mesmo dia; o link fica em `scripts/.umami_share_url` (fora do git).
- **Complementos de 2026-10-29 (tarde)**: criada a variável `EMAILS_TESTE` no `wrangler.toml` (contas do mantenedor usadas só para testar o funil, sem acesso de admin) — a compra de teste de 29/10 (R$ 14,90, conta hotmail do mantenedor) agora conta como teste, não como cliente (limitação 3 do baseline). Primeira leitura automatizada (`leituras/leitura-L0-previa-2026-10-29-1601.md`): **1 conta nova real em 29/10, que consumiu o crédito grátis** (primeiro usuário externo do funil); 0 compras de clientes; custo de análises do dia US$ 0,3909. **Discrepância explicada em parte**: o Umami mostra 2 visitantes e **zero eventos** no período, embora a conta nova real tenha sido criada depois de o Umami ser ligado — a causa provável é o CSP do site, que bloqueava `gateway.umami.is` no `connect-src` até o commit `b8d5a41` (29/10 15:39). Ou seja, a contagem do Umami só é confiável a partir desse horário; conferir na leitura L0 (2026-11-01) se os eventos passaram a aparecer. O baseline (seções 3–5) ainda mostra contas com a premissa antiga de R$ 5,40 (~7–8 % acima); o recálculo com 5,00 sai na tarefa 1b, junto com a leitura L0. Ainda em 29/10: os navegadores do mantenedor passam a poder se **autoexcluir do Umami** — abrir o site com `#nao-contar` grava `umami.disabled` no localStorage daquele navegador (pageviews e eventos param de ser enviados; `#contar` desfaz; `docs/js/common.js`). Os números do Umami **anteriores à ativação** (inclusive os 2 visitantes de 29/10) ainda podem incluir o próprio mantenedor; a partir da ativação em cada navegador dele, o tráfego do Umami é só externo.
- **Reverteria se**: o câmbio real sair da faixa de ~R$ 5 a ponto de distorcer margem ou teto (> ±10 %), ou a rota interna expor algo além de agregados.

## 2026-10-29 — Rodada D1–2 do Plano nº 1: itens 1, 2 e 4 entregues; tarefas em andamento e propostas aguardando aprovação
- **Contexto**: execução dos itens que podiam começar no D1. Os itens 1 e 2 rodaram em paralelo. O item 4 foi **sequenciado depois** de 1 e 2, porque o registro do EXP-2026-01 dependia do segmento (item 2) e do teto de custo (item 1), e a publicação só ocorre no D5, então esperar não atrasou nada.
- **Entregáveis**: [baseline-ciclo-01.md](baseline-ciclo-01.md) (unit-economics-analyst); [pesquisa-mercado-ciclo-01.md](pesquisa-mercado-ciclo-01.md) (market-researcher); [rascunhos-exp-2026-01.md](rascunhos-exp-2026-01.md) + EXP-2026-01 em [experiment-log-template.md](experiment-log-template.md) (growth-marketer). Correção no metrics.md: o custo observado por análise é US$ 0,1747–0,5146, mediana US$ 0,3478 (`custo_relatorios.json`).
- **Evidência nova** (todas as fontes nos arquivos acima; acesso em 2026-10-29):
  - Há ≥ 6 ferramentas de análise de leilão por IA no Brasil, com preço público de R$ 4–25 por análise e 3–5 análises grátis. O Aysha (R$ 14,90, 1 grátis) fica na faixa alta e não tem diferencial provado.
  - Nenhuma comunidade do nicho tem a regra de divulgação verificada.
  - O tracker atual descarta a query string (`docs/js/common.js:141-160`): UTM não funciona hoje e a conta nova não guarda a origem.
  - Os 12 registros de custo de análise são, muito provavelmente, testes do mantenedor.
- **Decisões do orquestrador** (cada uma dentro do plano já aprovado):
  1. **Segmento do ciclo = A**, o arrematante pessoa física em início ou meio de trajetória (score 3,55). O segmento B (2,85) fica fora, com 1 entrevista (E5) reservada para reavaliá-lo no ciclo 2.
  2. **EXP-2026-01 é mantido, mas condicionado.** O score é 3,10 (fila). Mesmo assim ele roda porque: faz parte do plano aprovado; é o único canal capaz de gerar `compra-paga` dentro do ciclo; e tem custo travado em 25 créditos grátis. **Só roda em comunidade classificada como "permite" ou com autorização escrita do admin**; "não verificado" conta como "proíbe".
     - Se a triagem do mantenedor não achar nenhuma comunidade elegível até D5, o EXP não roda neste ciclo.
     - Nesse caso, a fonte de sinal de pagamento passa a ser o compromisso verificável no fim das entrevistas (comprar 1 crédito).
  3. **Atribuição: protocolo de horário, sem código neste ciclo.** É um post por comunidade, com ≥ 48 h entre eles e data e hora anotadas pelo mantenedor.
     - A mudança `?ref=` → Umami + `usuarios.origem` foi pontuada em I=3 C=4 V=3 E=3 R=3 → 3,25 (fila). Exige deploy e migração do D1 e disputaria `docs/js/` com o item 5.
     - Com só 2–3 posts, o protocolo de horário é suficiente. Revisar no ciclo 2 se o canal for ampliado.
  4. **Preço e quantidade de grátis não mudam neste ciclo.** O benchmark (1 grátis contra 3–5 dos concorrentes) é um risco forte para a conversão grátis→pago, mas mudar preço exige aprovação e deve vir depois das entrevistas.
     - Fica na fila para o product-pricing (benchmark) e o unit-economics-analyst (custo de dar 3 grátis), a disparar em D10, com as entrevistas em mãos.
  5. A gravação de `acessos.origem='gratis'` (sugerida pelo baseline) vai para a fila, não para agora. O admin já permite a medição indireta (contas novas com ≥ 1 análise).
- **Propostas que AGUARDAM aprovação do mantenedor** (não valem até ele aprovar):
  - **Teto de gasto do ciclo**: R$ 112. São R$ 100 de IA dos créditos grátis (25 créditos × US$ 0,73 × R$ 5,40, câmbio usado como premissa), R$ 10 de Haiku, R$ 2 de fixos e R$ 0 de mídia.
  - **Regra de parada**: 15 grátis consumidos sem `compra-paga` → pausar novas comunidades; exposição ≥ 25 → parar.
  - **Meta (projeção, cenário base)**: ≥ 2 clientes pagantes independentes até 2026-11-09 → perseverar; 1 → ajustar; 0 com ≥ 15 grátis consumidos → mudar canal ou segmento.
  - **Textos V1/V2, mensagem ao admin e lista final de comunidades** do EXP-2026-01.
  - **Mensagem de abordagem para as entrevistas** (item 3).
- **Tarefas em andamento / fila (regra anti-redundância nº 7)**:

  | # | Tarefa | Responsável | Prazo | Status |
  |---|---|---|---|---|
  | 1 | Baseline: preencher os PENDENTES (câmbio, Umami, admin, MP, GSC), leitura L0 | coleta automática (`coleta_metricas.py`); GSC e taxa MP com o mantenedor | até 2026-11-01 | automatizada (ver entrada de aprovações de 29/10) |
  | 1b | Recalcular o baseline com os dados L0 e o câmbio real | unit-economics-analyst | D5 (após L0) | aguardando dado |
  | 2 | Pesquisa de mercado | market-researcher | — | **concluído** |
  | 3 | 5 entrevistas (E1–E4 segmento A, E5 segmento B) com o roteiro da seção 3 da pesquisa | — | — | **cancelada pelo mantenedor em 2026-10-30** |
  | 4a | Rascunhos + registro EXP-2026-01 | growth-marketer | — | **concluído** |
  | 4b | Triagem das comunidades de que já participa (seção a dos rascunhos) | **mantenedor** | até 2026-11-01 | **concluída em 2026-10-30** (8 grupos, todos permitem; seção g dos rascunhos) |
  | 4c | Publicação, 1 por comunidade, ≥ 48 h entre posts | **mantenedor** | 2026-11-02 a 09 | aguardando confirmação dos 3 grupos e dos textos (seção g) |
  | 5 | Auditoria de conversão ficha → análise → compra (incluir: o que a análise entrega sem PDF de edital/Caixa) | conversion-optimizer | D5–10 | não iniciado (próxima rodada) |
  | 6 | Leitura final e decisão do EXP-2026-01 | orquestrador + unit-economics-analyst | D13–14 | não iniciado |
  | F1 | Benchmark de preço e grátis + custo de 3 grátis | product-pricing + unit-economics-analyst | D10, com os dados do EXP (entrevistas canceladas) | fila |
  | F2 | Rastreamento `?ref=`/`usuarios.origem`; `acessos.origem='gratis'` | builder-qa | ciclo 2 | fila (score 3,25) |

- **Reverteria se**:
  - A triagem achar zero comunidades elegíveis: o EXP não roda, e no D13–14 a decisão se apoia nas entrevistas.
  - As entrevistas mostrarem que o segmento A não paga nem por análise humana: repensar o segmento antes do ciclo 2.

## 2026-10-29 — Criação da equipe de agentes de monetização
- **Contexto**: produto no ar, funil técnico pronto, zero clientes pagantes reais; prioridade é validação comercial.
- **Decisão**: 8 agentes em `.claude/agents/` + processo em `docs/business/` (este diretório é excluído do site publicado via `docs/.assetsignore`). Aprovada pelo mantenedor ao executar o prompt de criação.
- **Reverteria se**: o processo gerar mais burocracia que aprendizado (sinal: experimentos parados no status "proposto" por mais de 2 semanas).

## 2026-10-29 — Plano de 14 dias nº 1 (APROVADO pelo mantenedor em 2026-10-29)
- **Contexto**: diagnóstico inicial da equipe. Estágio: produto mínimo vendável no ar (fase 3 ok), mas a fase 2 (validação comercial) foi pulada — zero evidência de disposição a pagar além do teste do mantenedor. Gargalo: demanda, não infraestrutura.
- **Plano** (responsável · prazo · critério de sucesso):
  1. Baseline de métricas e teto de gasto global do ciclo — unit-economics-analyst + mantenedor (dados Umami/MP/admin) · D1–2 · números base registrados aqui.
  2. Mapa de concorrentes/substitutos de "análise de leilão" + 2 segmentos candidatos + roteiro de entrevista — market-researcher · D1–4 · relatório com fontes.
  3. 5 conversas com público-alvo usando o roteiro — **mantenedor** (ação externa) · D3–9 · 5 entrevistas anotadas.
  4. EXP-2026-01 — oferta direta em 2–3 comunidades do nicho (post/mensagem rascunhados pelo growth-marketer, publicados pelo mantenedor): levar ao exemplo de análise + 1ª grátis; **métrica principal: compras pagas**; proteção: reclamações/denúncias de spam; custo máx: custo de IA dos créditos grátis consumidos (teto a definir no item 1) · D5–12.
  5. Auditoria e top-3 correções de clareza no caminho ficha → análise → compra — conversion-optimizer (builder-qa fora desses arquivos na rodada) · D5–10 · deploy só com aprovação.
  6. Leitura dos resultados, preenchimento do experimento e decisão (perseverar / ajustar preço ou segmento / mudar canal) — orquestrador + unit-economics-analyst · D13–14 · decisão registrada aqui.
- **Depende de aprovação do mantenedor**: metas de receita e teto de gasto; publicação em comunidades; realização das entrevistas; deploy das melhorias de conversão.
- **Reverteria se**: nenhuma compra e nenhum aprendizado acionável ao fim do ciclo → repensar segmento/oferta antes de repetir canal.

(novas decisões entram acima desta linha, mais recente primeiro)
