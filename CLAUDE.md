# Aysha Leilões — instruções para o Claude Code

Contexto técnico completo no [README.md](README.md) (arquitetura, fontes, convenções). Resumo das regras do projeto:

- Código, comentários e documentação em **português**.
- IA é último recurso e tem teto de custo; o site funciona completo sem IA.
- Nunca armazenar nomes de pessoas físicas; respeitar robots.txt e termos das fontes.
- Segredos só em GitHub Secrets / segredos do Worker — nunca no repositório.
- `docs/data/` e `docs/leiloes/` são gerados pela coleta: não editar à mão.
- Push em `docs/` ou `site/` **dispara deploy** (`publicar.yml`); deploys e gastos dependem de aprovação do mantenedor.

## Equipe de agentes de negócio

Existe uma equipe de 8 subagentes em `.claude/agents/` focada em monetização e primeiros clientes pagantes (orquestrador: `startup-orchestrator`). O processo, a metodologia de priorização, as regras de coordenação e de aprovação estão em [docs/business/README.md](docs/business/README.md); métricas em `docs/business/metrics.md`; decisões em `docs/business/decision-log.md`; experimentos em `docs/business/experiment-log-template.md`.

`docs/business/` é interno e está excluído do site publicado via `docs/.assetsignore` — manter assim.

Para trabalho de negócio (preço, aquisição, conversão, experimentos), comece pelo `startup-orchestrator`; para trabalho puramente técnico, siga o README normalmente.
