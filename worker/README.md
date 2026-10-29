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
| `POST /auth/sair_todos` | sessão | encerra todas as sessões do usuário |
| `POST /conta/apagar` | sessão | apaga a conta (LGPD): e-mail, sessões, links e acessos; pedidos ficam só com o id numérico |
| `POST /interno/alerta {assunto, texto}` | `X-Interno` | o robô avisa o mantenedor por e-mail (custo do dia acima do teto) |
| `GET /conta` | sessão | e-mail, créditos, análise grátis disponível, análises liberadas, compras, pacotes |
| `POST /analise {id}` | sessão | libera o relatório (análise grátis ou 1 crédito). Se já existe, devolve na hora; senão dispara o robô |
| `GET /relatorio/:id` | sessão | o parecer, se o usuário tem acesso (`pronto`, `em_andamento` ou 403) |
| `GET /pacotes` | — | tabela de créditos (variável `PACOTES`) |
| `POST /pagamento/criar {pacote}` | sessão | cria a preferência no Mercado Pago e devolve a URL do checkout |
| `GET /pagamento/estado/:pedido` | sessão | situação do pedido (a página de retorno consulta até o webhook chegar) |
| `POST /pagamento/webhook` | — | notificação do Mercado Pago; consulta o pagamento e credita uma única vez |
| `POST /interno/relatorio` | `X-Interno` | o robô do GitHub grava o parecer gerado (texto, custo, campos estruturados) |
| `POST /geo {id, uf}` | — | geocodifica o endereço na 1ª visita à ficha (endereço lido na base do site; resultado no D1; tetos por IP e global) |
| `GET /interno/geo` | `X-Interno` | a coleta puxa as localizações descobertas e as grava na base |
| `GET /interno/metricas?desde=&ate=` | `X-Interno` | agregados da leitura L0/L1 do baseline (contas, créditos grátis, compras com taxa real do MP, custo das análises) — só contagens e valores, nenhum e-mail; usado por `scripts/coleta_metricas.py` |

Regras de cobrança: toda conta nova nasce com 1 crédito (a primeira análise é grátis); 1 crédito por imóvel, inclusive quando o
parecer já existia (a entrega é por conta). Reabrir um parecer já liberado não custa nada. Novas gerações têm
teto diário (`LIMITE_DIA`, contador em KV) porque custam dinheiro de verdade (Opus + busca na web).

Proteções: ids só começam com letra ou dígito (nunca viram opção de linha de comando no robô); e-mails de
domínios descartáveis são recusados no cadastro; o token do link mágico vai no fragmento da URL (`#token=`);
sessões expiram após 30 dias sem uso; o webhook do Mercado Pago só aceita notificações assinadas (sem
`MP_WEBHOOK_SECRET`, recusa tudo); o robô avisa por e-mail (`ALERTA_EMAIL`, ou o remetente) quando o custo
do dia passa de `relatorios.alerta_custo_usd_dia` no config.

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

### E-mail pelo Gmail (sem domínio próprio)

Enquanto não há domínio, o melhor caminho é enviar pela própria conta do Gmail via API do Google: os
servidores do Google assinam a mensagem, e ela passa nas verificações de autenticidade (pelo Brevo, "em
nome de" um Gmail, cai no spam). Limite de ~500 mensagens por dia. Configuração em `scripts/gmail_token.py`
(o cabeçalho do arquivo explica os passos no console do Google Cloud): o script autoriza a conta e grava
`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` e `GMAIL_REFRESH_TOKEN` no Worker. Com os três presentes, o Gmail
tem prioridade sobre o Brevo. `EMAIL_REMETENTE` precisa ser o endereço da conta autorizada.

### E-mail (Brevo)

Crie a conta em brevo.com, confirme o remetente (Senders & IP → Add sender, pode ser um Gmail) e gere uma
chave em SMTP & API → API keys. Sem `BREVO_API_KEY`, `POST /auth/pedir` responde erro 500 e ninguém consegue
entrar. Para testar sem e-mail, gere um link direto no banco:
`npx wrangler d1 execute aysha-contas --remote --command "INSERT INTO links_login (token, email, expira_em) VALUES ('<48 hex>', 'voce@exemplo.com', '<ISO +20min>')"`
e abra `conta.html#token=<48 hex>`.

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
