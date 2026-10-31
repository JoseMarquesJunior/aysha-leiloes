# Leitura — posts do EXP-2026-01 no LinkedIn (parcial)

Coletada pelo mantenedor em 2026-10-31 12:33 (Brasília), no Analytics do LinkedIn (Desempenho da publicação, últimos 28 dias). Dados crus no `.json` ao lado. Complementa a [leitura do Facebook](leitura-posts-facebook-2026-10-31-1106.md) e **quita a pendência do LinkedIn** do decision-log (31/10). **Leitura parcial de distribuição**: visualizações e impressões não são prova de disposição a pagar (README); a decisão do EXP-2026-01 continua sendo `compra-paga`.

**Correção de cronologia**: o 1º post do experimento foi no LinkedIn em **28/10** — um dia antes do 1º post no Facebook (29/10 17:08). Pela regra do EXP (fim = 8 dias corridos após o 1º post), o fim passa a **2026-11-05**, leitura final mantida em D13 (2026-11-10).

## Posts publicados (28–30/10)

O LinkedIn informa só a data, sem hora; janelas de atribuição são por dia inteiro.

| # | Data | Tipo | Criativo | Impressões | Pessoas únicas | Views de vídeo | Tempo médio | Engajamento (tudo) |
|---|---|---|---|---:|---:|---:|---:|---:|
| 3 | 28/10 | Vídeo | A' — caso Vitória + oferta "30 primeiros" | 146 | 47 | 21 | 9 s | 0 |
| 4 | 28/10 | Vídeo | A' — versão curta da mesma oferta | 104 | 3 | 3 | 10 s | 0 |
| 5 | 28/10 | Vídeo | A' — quase idêntico ao nº 4 | 102 | 4 | 4 | 11 s | 0 |
| 2 | 29/10 | Imagem | A — caso Vitória (carrossel, oferta padrão) | 77 | 44 | — | — | 0 |
| 1 | 30/10 | Vídeo | B — "montei um site gratuito" | 33 | 8 | 7 | 11 s | 0 |

"Engajamento (tudo)" = reações + comentários + compartilhamentos + salvamentos + envios + seguidores + visitas ao perfil: **zero em todos os 5 posts**.

## O que os números dizem (direcional)

1. **Alcance pequeno e engajamento nulo.** Somando os posts, no máximo ~100 pessoas únicas (com sobreposição provável), 0 reações, 0 comentários, 0 visitas ao perfil, 0 seguidores. No Facebook, um único post no grupo grande alcançou 402 pessoas. **Grupos de nicho estão rendendo ~10× mais alcance que o feed pessoal do LinkedIn** — coerente com a triagem original do plano, que priorizava comunidades.
2. **Posts 4 e 5 são quase duplicados** (mesmo texto, mesmo dia, urns consecutivos) e têm anomalia: ~100 impressões cada, mas só 3–4 pessoas únicas — impressões repetidas para as mesmas pessoas, alcance real ≈ nulo. Vale apagar um dos dois (duplicata sinaliza spam para o algoritmo e para leitores).
3. **Vídeo retém ~10 s** em todos os posts, para um conteúdo que pede minutos. O carrossel de imagens (post 2) alcançou 44 pessoas sem precisar de retenção — mesmo padrão do Facebook, onde o caso com fotos foi o melhor formato.
4. **Métrica de proteção**: nenhuma remoção, denúncia ou reclamação conhecida até a coleta.

## ⚠️ Oferta fora do experimento aprovado (posts 3, 4 e 5)

Os três posts de 28/10 oferecem **"5 análises grátis para os 30 primeiros"** mediante mensagem privada. O EXP-2026-01 aprovado diz: oferta = 1ª análise grátis, "nenhum preço, crédito extra ou cupom muda neste experimento", com critério de interrupção em **25 créditos grátis de exposição**. A oferta publicada, se aceita por 30 pessoas, compromete até **150 créditos** (~6× o teto; no custo-teto de US$ 0,73 × R$ 5,00, até ≈ R$ 547 de IA).

- **Exposição efetiva até a coleta: 0** (nenhuma mensagem recebida registrada, 0 envios, 0 comentários).
- **Decisão necessária do mantenedor** (registrar no decision-log): (a) editar os posts para a oferta padrão, ou (b) manter a oferta e emendar o EXP com novo teto de exposição aprovado. Enquanto não decidir, qualquer crédito concedido por mensagem deve ser anotado (conta, data, quantidade) para contar na exposição.

## Janelas de atribuição (cruzar com o Umami)

- **28/10 (dia todo)**: só LinkedIn no ar → visitantes/eventos de 28/10 até 29/10 17:08 são atribuíveis ao LinkedIn (mais GSC/direto).
- **29/10 em diante**: LinkedIn e Facebook sobrepostos → atribuição só por canal agregado "social", exceto o que o Umami mostrar como referrer (`lnkd.in`/`linkedin.com` × `facebook.com`/`m.facebook.com`/`l.facebook.com`). Os links do LinkedIn passam pelo encurtador `lnkd.in`.

## Próximos passos

1. Decidir sobre a oferta "30 primeiros" (editar posts ou emendar o EXP) — item novo para o decision-log.
2. Apagar um dos posts duplicados (4 ou 5).
3. Na leitura L0 de 01/11, separar referrers `lnkd.in`/`linkedin.com` dos de Facebook para aproveitar o dia 28/10 como janela exclusiva do LinkedIn.
4. Próximo post: priorizar formato caso concreto com imagens e os grupos de nicho (C3 da triagem ainda sem post); LinkedIn fica como canal secundário.
