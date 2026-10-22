# Worker de análise sob demanda (Cloudflare)

Ponte entre o botão "Gerar análise com IA" do site (estático) e o workflow `relatorio.yml` do GitHub.
Não guarda a chave da Anthropic: só dispara o workflow, com limites por IP e por dia.

## Publicar (uma vez)

```bash
cd worker
npm install
npx wrangler login                                  # abre o navegador na conta Cloudflare
npx wrangler kv namespace create LIMITES            # copie o id para wrangler.toml
npx wrangler secret put GITHUB_TOKEN                # token fine-grained do repositório, permissão Actions: write
npx wrangler deploy                                 # imprime a URL https://aysha-leiloes-analise.<conta>.workers.dev
```

Depois, em `docs/js/config.js`, preencha `urlAnaliseWorker: "https://aysha-leiloes-analise.<conta>.workers.dev/analise"`.

Token do GitHub: Settings → Developer settings → Fine-grained tokens → repositório `aysha-leiloes`,
permissão "Actions" = Read and write (só isso). Validade longa; ao expirar, repita `wrangler secret put`.

## Testar

```bash
curl -X POST https://aysha-leiloes-analise.<conta>.workers.dev/analise -H "Content-Type: application/json" -d '{"id":"suedpeter-3464"}'
```

Respostas: `{"status":"pronto"}` (já existe), `{"status":"iniciado"}` (workflow disparado; o relatório aparece
no site em 3 a 6 minutos), `{"status":"em_andamento"}`, ou 429 quando um limite foi atingido.
