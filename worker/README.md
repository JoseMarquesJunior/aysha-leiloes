# Worker de contas, créditos e análises (Cloudflare Workers + D1 + KV)

Serviço do site estático para tudo que precisa de estado: contas por link mágico, saldo de créditos,
entrega dos pareceres de IA só a quem tem acesso, checkout no Mercado Pago com confirmação por webhook e
recibo por e-mail. Não guarda a chave da Anthropic: para gerar um parecer novo, dispara o workflow
`relatorio.yml` do GitHub, que gera e devolve o texto ao Worker (`POST /interno/relatorio`).

## Rotas

| Rota | Autenticação | O que faz |
|---|---|---|
| `POST /auth/pedir {email}` | — | envia o link de login (vale 20 min, uso único); 10 pedidos/hora por IP |
| `POST /auth/entrar {token}` | — | troca o token do link por um token de sessão (90 dias) |
| `POST /auth/sair` | sessão | encerra a sessão |
| `GET /conta` | sessão | e-mail, créditos, análise grátis disponível, análises liberadas, compras, pacotes |
| `POST /analise {id}` | sessão | libera o relatório (análise grátis ou 1 crédito). Se já existe, devolve na hora; senão dispara o robô |
| `GET /relatorio/:id` | sessão | o parecer, se o usuário tem acesso (`pronto`, `em_andamento` ou 403) |
| `GET /pacotes` | — | tabela de créditos (variável `PACOTES`) |
| `POST /pagamento/criar {pacote}` | sessão | cria a preferência no Mercado Pago e devolve a URL do checkout |
| `GET /pagamento/estado/:pedido` | sessão | situação do pedido (a página de retorno consulta até o webhook chegar) |
| `POST /pagamento/webhook` | — | notificação do Mercado Pago; consulta o pagamento e credita uma única vez |
| `POST /interno/relatorio` | `X-Interno` | o robô do GitHub grava o parecer gerado (texto, custo, campos estruturados) |

Regras de cobrança: a primeira análise de cada conta é grátis; depois, 1 crédito por imóvel, inclusive quando o
parecer já existia (a entrega é por conta). Reabrir um parecer já liberado não custa nada. Novas gerações têm
teto diário (`LIMITE_DIA`, contador em KV) porque custam dinheiro de verdade (Opus + busca na web).

## Publicar (uma vez)

```bash
cd worker
npm install
npx wrangler login                                  # abre o navegador na conta Cloudflare
npx wrangler kv namespace create LIMITES            # copie o id para wrangler.toml
npx wrangler d1 create aysha-contas                 # copie o database_id para wrangler.toml
npx wrangler d1 execute aysha-contas --remote --file=schema.sql
npx wrangler secret put GITHUB_TOKEN                # token fine-grained do repositório, permissão Actions: write
npx wrangler secret put INTERNO_SECRET              # string aleatória; a mesma vai em `gh secret set INTERNO_SECRET`
npx wrangler secret put BREVO_API_KEY               # e-mail transacional (Brevo, plano grátis: 300/dia)
npx wrangler secret put MP_ACCESS_TOKEN             # Mercado Pago → Suas integrações → credenciais de produção
npx wrangler secret put MP_WEBHOOK_SECRET           # Mercado Pago → Webhooks → assinatura secreta (valida o x-signature)
npx wrangler deploy
```

Em `wrangler.toml`: `SITE`, `ORIGENS` (CORS), `EMAIL_REMETENTE`/`NOME_REMETENTE` (remetente verificado no Brevo),
`PACOTES` (JSON com id, nome, créditos e valor em centavos) e `LIMITE_DIA`. Em `docs/js/config.js`,
`urlWorker` aponta para a URL publicada.

Token do GitHub: Settings → Developer settings → Fine-grained tokens → repositório `aysha-leiloes`,
permissão "Actions" = Read and write (só isso). Ao expirar, repita `wrangler secret put`.

### E-mail (Brevo)

Crie a conta em brevo.com, confirme o remetente (Senders & IP → Add sender, pode ser um Gmail) e gere uma
chave em SMTP & API → API keys. Sem `BREVO_API_KEY`, `POST /auth/pedir` responde erro 500 e ninguém consegue
entrar. Para testar sem e-mail, o mantenedor pode mandar o header `X-Interno: <INTERNO_SECRET>` em
`/auth/pedir`: a resposta traz o link em vez de enviá-lo.

### Mercado Pago

Conta em mercadopago.com.br (pessoa física com CPF serve). Em "Suas integrações" crie uma aplicação
(Checkout Pro) e copie o **Access Token de produção** para `MP_ACCESS_TOKEN`. O Worker cria uma
preferência por pedido (`external_reference` = id do pedido), manda a pessoa para o checkout (Pix, cartão,
boleto) e recebe a notificação em `/pagamento/webhook`; configure essa URL em "Webhooks" da aplicação
(evento "Pagamentos") e copie a assinatura secreta dessa tela para `MP_WEBHOOK_SECRET`: com ela o Worker
valida o header `x-signature` e recusa chamadas que não vieram do Mercado Pago. O crédito é lançado uma única vez, mesmo que a notificação chegue repetida, e a página
de retorno (`conta.html?pedido=`) consulta o pedido até ver a confirmação. Para testar, use as credenciais
de teste e os cartões de teste do Mercado Pago com `sandbox_init_point`.

## Testar

```bash
W=https://aysha-leiloes-analise.<conta>.workers.dev
curl -X POST $W/auth/pedir -H "Content-Type: application/json" -H "X-Interno: $SEG" -d '{"email":"voce@exemplo.com"}'
curl -X POST $W/auth/entrar -H "Content-Type: application/json" -d '{"token":"<token do link>"}'
curl $W/conta -H "Authorization: Bearer <sessao>"
```

Banco: `npx wrangler d1 execute aysha-contas --remote --command "SELECT email, creditos FROM usuarios"`.
Para dar créditos de cortesia: `UPDATE usuarios SET creditos = creditos + 5 WHERE email = '...'`.
