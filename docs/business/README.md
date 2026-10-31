# Equipe de agentes — como usar

Equipe de 8 subagentes do Claude Code (arquivos em `.claude/agents/`) focada em uma pergunta: **o que vender, para quem, por quanto, e como conquistar os primeiros clientes pagantes** do Aysha Leilões, gastando o mínimo de tempo, dinheiro e código.

> Este diretório (`docs/business/`) é **interno**: está em `docs/.assetsignore` e não é publicado no site.

## Os agentes

| Agente | Papel | Modelo | Quando acionar |
|---|---|---|---|
| `startup-orchestrator` | CEO / coordenação | opus | ponto de entrada padrão; prioriza, delega e consolida |
| `market-researcher` | pesquisa de mercado | sonnet | concorrentes, segmentos, preços de mercado, entrevistas |
| `product-pricing` | produto e preço | sonnet | proposta de valor, pacotes, testes de preço, o que (não) construir |
| `growth-marketer` | aquisição | sonnet | canais, experimentos de aquisição, mensagens, CAC |
| `conversion-optimizer` | conversão (UX/UI) | sonnet | landing, onboarding, checkout, funil, testes A/B |
| `retention-specialist` | ativação e retenção | haiku | primeiro valor, uso recorrente, alertas, churn |
| `unit-economics-analyst` | CFO | sonnet | margem, cenários, tetos de gasto, sustentabilidade de preço |
| `builder-qa` | implementador de tarefas pequenas | sonnet | mudança pequena e isolada, direto da sessão; o resto vai ao `cto-architect` (ver seção da equipe técnica) |

Modelos: opus só no orquestrador (consolidação estratégica); sonnet nos especialistas que pesquisam, analisam números ou editam código; haiku no de retenção, cuja carga atual é leitura do repositório e desenho de hipóteses (trocar para sonnet se a qualidade limitar).

## Como invocar

Em uma sessão do Claude Code na raiz do projeto, peça em linguagem natural:

```
> Use o agente startup-orchestrator para revisar as prioridades da semana
> Use o market-researcher para mapear os concorrentes que vendem análise de leilão
> Peça ao unit-economics-analyst a margem real das vendas de outubro
```

O fluxo normal começa **sempre pelo `startup-orchestrator`**, que lê este diretório, decide o que importa e delega. Os especialistas também podem ser chamados diretamente para tarefas pontuais.

### Delegação

O `startup-orchestrator` tem a ferramenta `Agent` e pode invocar os especialistas diretamente (subagentes aninham até 3 níveis nesta instalação). Os especialistas **não** têm `Agent`: quando precisam de outro especialista, terminam o relatório com a seção "Delegações recomendadas" e o orquestrador (ou a sessão principal) decide e dispara. Isso evita cascatas de agentes e custo sem controle.

## Regras de coordenação

1. **Antes de qualquer tarefa**, o agente lê `decision-log.md` e o registro de experimentos: nada de refazer análise já feita nem reabrir decisão sem evidência nova.
2. **Paralelo permitido**: tarefas de leitura/pesquisa (market-researcher, unit-economics-analyst, retention-specialist) podem rodar ao mesmo tempo.
3. **Escrita de código é serializada**: só **um** agente edita código por vez. `builder-qa` é o dono da implementação; `conversion-optimizer` só edita diretamente os arquivos de interface (`docs/*.html`, `docs/js/`, `docs/css/`) quando o orquestrador não tiver designado o builder-qa para os mesmos arquivos na mesma rodada. Em dúvida, conversion-optimizer especifica e builder-qa implementa.
4. **Escrita em `docs/business/` é append-first**: cada agente adiciona seções; não reescreve o texto de outro agente.
5. **Divergências**: quem consolida é o orquestrador, exigindo evidência de cada lado; a resolução vira entrada no `decision-log.md`. Sem evidência de nenhum lado → vira experimento, não debate.
6. **Toda recomendação termina em uma de três coisas**: um experimento registrado, uma decisão registrada, ou "nada a fazer" com justificativa. Relatório sem consequência é desperdício.
7. **Anti-redundância**: o orquestrador mantém no plano vigente (decision-log) a lista de tarefas em andamento com responsável; um especialista não inicia tarefa que já tem dono.

## <a name="priorizacao"></a>Priorização comercial (metodologia comum)

Cada oportunidade recebe nota **1 a 5** em cinco critérios:

| Critério | Peso | 1 | 5 |
|---|---|---|---|
| **I** — Impacto em receita/clientes pagantes | 35 % | nenhum caminho claro para receita | receita direta em semanas |
| **C** — Confiança na evidência | 25 % | só opinião | dado observado do nosso funil |
| **V** — Velocidade de aprendizado/resultado | 20 % | meses | dias |
| **E** — Eficiência de custo/esforço | 15 % | caro ou semanas de trabalho | quase grátis, horas |
| **R** — Reversibilidade | 5 % | difícil desfazer | desfaz com um clique |

**Score = 0,35·I + 0,25·C + 0,20·V + 0,15·E + 0,05·R** (máximo 5).

- ≥ 4,0: fazer nesta rodada; 3,0–3,9: fila; < 3,0: não fazer agora.
- A pontuação **orienta, não decide sozinha**: risco legal, de segurança, privacidade ou reputação veta a iniciativa independentemente do score (ex.: nada que viole robots.txt/termos das fontes, LGPD, ou regras do Mercado Pago).

## Fluxo de validação (fases)

1. **Descoberta** — problema, segmento inicial, alternativas; hipóteses de comprador e disposição a pagar.
2. **Validação comercial** — entrevistas, oferta concreta, pilotos pagos / compromissos verificáveis.
3. **Produto mínimo vendável** — construir só o que entrega a promessa validada (processos manuais valem).
4. **Primeiros clientes** — aquisição, conversão, onboarding; medir receita recebida e custo variável.
5. **Crescimento** — ampliar canal só com evidência de conversão, retenção e economia unitária plausível.

**Estado em 2026-10-29**: produto vendável no ar (fase 3 concluída tecnicamente), mas a fase 2 foi pulada — não há evidência de disposição a pagar além da compra de teste do mantenedor. A equipe trabalha nas fases 2 e 4 ao mesmo tempo: validar demanda com o produto que já existe.

**Nunca contam como prova de disposição a pagar**: cadastros grátis, visualizações, elogios, respostas positivas em pesquisa, análises grátis consumidas.

## Autonomia e aprovações

Os agentes **podem**, sem pedir: ler e analisar o repositório e os painéis descritos em `metrics.md`; pesquisar na web; escrever planos, relatórios e propostas em `docs/business/`; modificar código local de tarefas aprovadas; rodar testes e verificações locais.

Os agentes **param e pedem aprovação do mantenedor** antes de:

- publicar em produção ou fazer deploy (`wrangler deploy`, push que dispara `publicar.yml`);
- gastar dinheiro ou contratar serviço;
- enviar mensagem externa (e-mail, post, DM) ou lançar campanha;
- alterar preços ativos, cobrança ou planos (`worker/` — pacotes/valores);
- mexer em autenticação, permissões, segredos ou controles de segurança;
- excluir dados, migrar o D1 ou alterar infraestrutura;
- coletar novo dado pessoal ou qualquer ação com implicação legal.

Essas regras estão repetidas no corpo de cada agente. As permissões de ferramenta por agente estão no frontmatter de cada arquivo (nenhum agente usa `permissionMode` elevado; tudo passa pelas permissões normais da sessão).

## Arquivos deste diretório

- `README.md` — este guia
- `metrics.md` — definições das métricas (fonte única)
- `experiment-log-template.md` — modelo + registro de experimentos
- `decision-log.md` — decisões e justificativas (inclui o plano vigente)

## Equipe técnica (adicionada em 2026-10-31)

O trabalho técnico ganhou 9 agentes próprios (detalhes e tabela completa em [../tech/README.md](../tech/README.md), interno como este diretório):

| Agente | Papel | Escopo |
|---|---|---|
| `cto-architect` | CTO/arquiteto (único técnico com `Agent`) | decompõe, atribui, revisa; ADRs; não edita código |
| `backend-engineer` | Workers (API e site) | `worker/src/`, `site/index.js` |
| `frontend-engineer` | site estático | `docs/*.html`, `docs/js/`, `docs/css/` |
| `database-engineer` | D1 | `worker/schema.sql`, migrações |
| `data-engineer` | coletor | `collector/` |
| `devops-sre` | CI/CD, cotas, runbooks | `.github/workflows/`, `wrangler.toml`, `scripts/` |
| `qa-engineer` | testes | só código de teste |
| `security-engineer` | segurança (revisão) | só `docs/tech/`; sem Bash |
| `performance-engineer` | desempenho | só o que o CTO atribuir |

**Cadeia**: `startup-orchestrator` (O QUE, valor comercial) → `cto-architect` (COMO e quem) → engenheiros (3 níveis, o máximo da instalação). A regra 3 (escrita de código serializada) passa a ser operada pelo CTO: ele registra no decision-log o dono de cada arquivo/pasta da rodada. O `conversion-optimizer` especifica interface e o `frontend-engineer` implementa. O `builder-qa` foi mantido (decisão do mantenedor, 2026-10-31) só como **implementador genérico de tarefas pequenas e isoladas**, chamado direto da sessão principal; deixou de ser o CTO.
