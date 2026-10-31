# Documentação técnica interna

> Este diretório (`docs/tech/`) é **interno**: está em `docs/.assetsignore` e não é publicado no site. Escrita **append-first**: adicione seções e arquivos; não reescreva o texto de outro agente.

Estrutura:

- `README.md` — este mapa (agentes técnicos e cadeia de delegação)
- `adr/` — decisões de arquitetura numeradas (`NNNN-titulo.md`; modelo em `adr/0000-modelo.md`)
- `runbooks/` — procedimentos operacionais (sintoma → diagnóstico → correção → verificação) e roteiros de teste manual

## Agentes técnicos (arquivos em `.claude/agents/`)

| Agente | Papel | Escopo de edição | Quando acionar |
|---|---|---|---|
| `cto-architect` | CTO/arquiteto; decompõe, atribui, revisa, escreve ADRs | `docs/tech/`, decision-log (não edita código) | toda tarefa técnica aprovada entra por ele |
| `backend-engineer` | Workers (API e site) | `worker/src/`, `site/index.js` + testes | contas, link mágico, créditos, webhook MP, Brevo, cron, /geo |
| `frontend-engineer` | site estático | `docs/*.html`, `docs/js/`, `docs/css/` | interface, acessibilidade, eventos Umami; implementa specs do conversion-optimizer |
| `database-engineer` | D1/SQLite | `worker/schema.sql`, migrações | esquema, índices, integridade de créditos, LGPD (retenção/exclusão) |
| `data-engineer` | coletor | `collector/` (nunca `docs/data|leiloes` à mão) | fontes, extração, dedup, histórico, páginas geradas, sitemaps |
| `devops-sre` | operação/confiabilidade | `.github/workflows/`, `wrangler.toml`, `scripts/`, runbooks | coleta diária, publicação, cotas dos planos grátis, rollback |
| `qa-engineer` | qualidade | só código de teste + roteiros | regressão com trechos reais, bordas, roteiro manual do funil |
| `security-engineer` | segurança (revisão) | só `docs/tech/` (não edita produção) | CSP, link mágico, admin, webhook, /interno/*, LGPD, dependências |
| `performance-engineer` | desempenho | só o que o CTO atribuir na rodada | peso dos JSON, primeira tabela, mapa, CPU dos Workers, tempo de coleta |

## Cadeia de delegação

```
mantenedor
  └─ startup-orchestrator (CEO: decide O QUE, pelo valor comercial)
       └─ cto-architect (CTO: decide COMO e quem; registra donos de arquivos no decision-log)
            └─ engenheiros (implementam; são o 3º e último nível de aninhamento desta instalação)
```

- Especialistas comerciais (market-researcher, product-pricing, growth-marketer, conversion-optimizer, retention-specialist, unit-economics-analyst) continuam com o orquestrador; trabalho técnico desce pelo CTO.
- `conversion-optimizer` **especifica** mudanças de interface; `frontend-engineer` implementa.
- Só um agente edita código por vez em cada arquivo: o CTO registra no `docs/business/decision-log.md` o dono de cada arquivo/pasta na rodada.
- Engenheiros não têm a ferramenta Agent: terminam a entrega com "Delegações recomendadas" e o CTO decide.
- `builder-qa` (decisão do mantenedor, 2026-10-31) continua existindo **fora da cadeia**, como implementador genérico de tarefas pequenas e isoladas chamado direto da sessão principal; tarefa de vários arquivos ou área sensível vai ao CTO.
- As regras comuns (aprovações, segredos, LGPD, testes, stack fixa) estão repetidas no corpo de cada agente — são as mesmas para todos.

## Regra de ADR

Exigem ADR em `adr/` (e aprovação do mantenedor): dependência nova, mudança de stack, mudança no formato dos JSON de `docs/data/` (contrato com site e buscadores), mudança de contrato entre componentes (Worker ↔ site ↔ coletor), risco de segurança aceito.
