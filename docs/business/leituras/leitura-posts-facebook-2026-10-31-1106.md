# Leitura — posts do EXP-2026-01 no Facebook (parcial)

Coletada pelo mantenedor em 2026-10-31 11:06 (Brasília), no Painel profissional do Facebook (Biblioteca de Conteúdo → Publicados, últimos 28 dias). Dados crus no `.json` ao lado. **Leitura parcial de distribuição**: nada aqui é prova de disposição a pagar (README, "nunca contam": visualizações); a decisão do EXP-2026-01 continua sendo `compra-paga`.

Esta leitura também **quita a pendência** da entrada 2026-10-31 do decision-log ("anotar data, hora e grupo/canal de cada post"), para o Facebook. **LinkedIn segue sem registro** — se houve posts lá, anotar data e hora para fechar as janelas de atribuição.

## Posts publicados (29–30/10)

| # | Grupo (código do plano) | Data/hora (BRT) | Criativo | Visualizações | Visualizadores | Impressões | Engajamento | Comentários | Seguidores líq. |
|---|---|---|---|---:|---:|---:|---:|---:|---:|
| 5 | Leilão de imóveis e automóveis da Caixa (C1, 118,3 mil) | 29/10 17:08 | A — caso Vitória (fotos) | **563** | **402** | 409 | 8 | 0 | 0 |
| 4 | VENDA DE IMÓVEIS DE LEILÃO (fora da triagem) | 29/10 17:10 | A — caso Vitória (texto) | 22 | 12 | 12 | 0 | 0 | 0 |
| 3 | Leilões Judiciais e Extrajudiciais de Imóveis - São Paulo (C2, 12,4 mil) | 30/10 16:09 | B — vídeo demonstração | 0 | 0 | 0 | 0 | 0 | 0 |
| 2 | Leilão de imóveis e automóveis da Caixa (C1) | 30/10 16:12 | B — vídeo demonstração | 0 | 0 | 0 | 0 | 0 | 0 |
| 1 | VENDA DE IMÓVEIS DE LEILÃO | 30/10 16:14 | B — vídeo demonstração | 6 | 6 | 7 | 0 | 0 | 0 |

Criativos: **A** = caso concreto (apartamento em Vitória, R$ 312 mil → R$ 487 mil, 4 sinais vermelhos, link do exemplo público); **B** = "montei um site gratuito" com vídeo de demonstração. Nenhum dos dois é o V1/V2 dos rascunhos aprovados. Métricas de vídeo do post 1: 51 s assistidos no total, média de 8 s por visualização, 1 visualização ≥ 3 s, distribuição +0,5x.

## Janelas de atribuição (cruzar com o Umami)

- **Onda 1**: 29/10 17:08–17:10 → janela até 31/10 17:10.
- **Onda 2**: 30/10 16:09–16:14 → janela até 01/11 16:14.

As ondas se sobrepõem (intervalo de ~23 h), então visitas entre 30/10 16:09 e 31/10 17:10 não são atribuíveis a um post específico — só ao canal "grupos de Facebook" como um todo.

## O que os números dizem (direcional, não estatístico)

1. **O caso concreto rende ~2 ordens de grandeza mais alcance que o vídeo genérico**: 563 visualizações (post 5) contra 6 (post 1). A comparação mistura efeito do criativo, do grupo e do horário (regra 4 do metrics.md: nada conclusivo com < 30 eventos por etapa), mas a direção é forte o bastante para orientar o próximo post.
2. **O grupo grande domina**: praticamente todo o alcance veio do C1 (118,3 mil membros).
3. **Posts 2 e 3 estão zerados em tudo, inclusive impressões** — padrão de post retido na fila de aprovação do admin ou sem nenhuma distribuição. **Verificar no grupo se estão visíveis**; enquanto houver dúvida, as janelas de atribuição desses grupos não valem.
4. **Alcance sem resposta**: 0 comentários, 0 seguidores, 8 engajamentos no total. Nenhum lead visível na própria plataforma até esta coleta.
5. **Métrica de proteção**: nenhuma remoção ou advertência conhecida até esta coleta.

## Desvios do plano (registrados, já reconhecidos no decision-log de 31/10)

1. Publicação antecipada: plano previa 1º post em D5 (02/11), após a leitura L0; o 1º post saiu em 29/10. A L0 de 01/11 deixa de ser "antes do primeiro post" — tratar a leitura prévia de 29/10 17:34 como baseline de fato.
2. Grupo fora da triagem ("VENDA DE IMÓVEIS DE LEILÃO"); o C3 do plano (Leilão de Imóveis CAIXA, 16,9 mil) segue sem post.
3. Dois posts no mesmo grupo com ~23 h de intervalo (plano: ≥ 48 h, sem repostar no mesmo grupo no ciclo) — vale para C1 e para o grupo fora da triagem.
4. Criativos novos (A e B) no lugar do V1/V2 aprovado; a comparação V1×V2 planejada não acontecerá como desenhada — a leitura passa a ser "caso" × "vídeo", qualitativa.

## Próximos passos

1. Conferir se os posts 2 e 3 estão visíveis nos grupos (aprovação de admin).
2. Registrar os posts do LinkedIn (data, hora, formato), se existirem.
3. Se houver novo post, priorizar o criativo A (caso concreto) e o C3 da triagem, respeitando ≥ 48 h.
4. Cruzar as janelas acima com visitantes/eventos do Umami na leitura L0 de 01/11.
