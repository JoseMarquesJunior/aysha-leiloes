# Registro de experimentos

Um experimento por seção, copiando o modelo abaixo. Preencher **antes** de executar (até "Critério de interrupção") e **depois** (resultado e decisão). Nunca preencher "Resultado observado" com estimativas: só números medidos (Umami, D1/admin, Mercado Pago, GSC). Se não foi medido, escrever "não medido" e explicar.

Pontuação de priorização: ver a metodologia em [README.md](README.md#priorizacao). Experimentos que envolvem gasto, mensagem externa, campanha ou mudança de preço exigem aprovação do mantenedor antes de iniciar.

---

## Modelo

```markdown
### EXP-AAAA-NN — <título curto>

- **Status**: proposto | aprovado | em execução | concluído | interrompido
- **Responsável (agente)**: <agente que propôs/conduz>
- **Data de início / fim previsto**: AAAA-MM-DD / AAAA-MM-DD
- **Pontuação de priorização**: I=_ C=_ V=_ E=_ R=_ → **_,__ / 5** (fórmula no README)

**Hipótese** (falseável, com número): "Acreditamos que <segmento> fará <comportamento>
porque <motivo>. Saberemos que é verdade se <métrica> atingir <valor> em <prazo>."

- **Segmento**: quem exatamente (ex.: investidores de leilão da Grande Vitória que chegaram por busca orgânica)
- **Oferta**: o que é oferecido e por quanto (ex.: análise de 1 imóvel por R$ 14,90)
- **Canal**: onde o experimento acontece (SEO, site, e-mail de alertas, Telegram, comunidade, anúncio…)
- **Custo máximo**: R$ ___ (inclui mídia, ferramentas e custo variável de IA; estourou, para)
- **Prazo**: ___ dias (vencido o prazo, decide-se com o que houver)
- **Métrica principal**: a única métrica que decide o experimento (definida em metrics.md)
- **Métrica de proteção**: o que não pode piorar enquanto isso (ex.: taxa de descadastro dos alertas, erro no checkout)
- **Critério de sucesso**: métrica principal ≥ <valor> até <data>
- **Critério de interrupção**: parar antes do prazo se <condição> (ex.: custo > R$ X sem nenhuma conversão; reclamações; risco legal)

**Resultado observado** (preencher ao final, só com dados medidos):
- Métrica principal: ___ (fonte do dado: ___)
- Métrica de proteção: ___
- Custo real: R$ ___
- O que aconteceu de inesperado: ___

**Decisão final**: perseverar / ajustar e repetir / descartar — e por quê.
Registrar a decisão também em decision-log.md.
```

---

## Experimentos

### EXP-2026-01 — Oferta direta (conteúdo de ajuda + 1ª análise grátis) em 2–3 comunidades do nicho

- **Status**: proposto (aguardando aprovação do mantenedor: teto, comunidades e textos)
- **Responsável (agente)**: growth-marketer
- **Data de início / fim previsto**: 2026-11-02 / 2026-11-09 (D5–D12 do plano; início só após a triagem das comunidades e a aprovação dos textos: se a aprovação atrasar, o início desliza e o fim fica em 8 dias corridos após o 1º post, com leitura final em D13, 2026-11-10; justificativa: o prazo máximo de 14 dias do ciclo e o plano de D13–14 para a decisão)
- **Pontuação de priorização**: I=3 C=2 V=4 E=4 R=3 → **3,10 / 5** (fórmula no README)
  - I=3: pode gerar compra direta em semanas, mas o segmento A é de ticket baixo (R$ 14,90) e o cenário base projeta só 2 clientes.
  - C=2: só sinais indiretos (preços e cursos de terceiros, pesquisa 2.1); nenhum dado do nosso funil.
  - V=4: resposta em 48 h por post; decisão em 8 dias.
  - E=4: custo é tempo do mantenedor (horas) + IA dos grátis, com teto de R$ 100.
  - R=3: o post pode ser apagado, mas a reputação na comunidade não se desfaz com um clique.
  - Pelo README, 3,0–3,9 é "fila", não "fazer nesta rodada"; a execução se sustenta por ser o item 4 do plano aprovado, pelo teto de custo e porque é o único canal capaz de produzir compra-paga em 8 dias. Veto de reputação/regra de comunidade prevalece sobre o score (publicar só onde a regra permitir).

**Hipótese** (falseável, com número): "Acreditamos que arrematantes pessoa física em início ou meio de trajetória (segmento A), em 2–3 comunidades cuja regra permite divulgação, farão compra-paga depois de usar a 1ª análise grátis, porque o post entrega um checklist útil e o exemplo público mostra o que o parecer entrega. Saberemos que é verdade se houver ≥ 2 clientes pagantes de 2 contas distintas, independentes do mantenedor, até 2026-11-09 (leitura em D13), dentro de 25 créditos grátis consumidos." (meta mínima do baseline, cenário base; 1 cliente = ajustar; 0 com ≥ 15 grátis consumidos = mudar canal ou segmento; menos de 5 contas = oferta não testada, estender sem concluir sobre preço)

- **Segmento**: segmento A (pesquisa 2.1): pessoa física que compra imóvel de leilão para morar, alugar ou revender, em início ou meio de trajetória, membro de comunidades do nicho em que o mantenedor já participa. Segmento B (profissionais) fora deste ciclo.
- **Oferta**: 1ª análise grátis (já existente, sem mudança) e análises seguintes a R$ 14,90 (preço vigente; nenhum preço, crédito extra ou cupom muda neste experimento). Entrada: post "conteúdo de ajuda" com o exemplo público https://ayshaleiloes.com.br/exemplo-analise.html (rascunhos V1/V2 em [rascunhos-exp-2026-01.md](rascunhos-exp-2026-01.md)).
- **Canal**: 2–3 comunidades do nicho (grupos de WhatsApp/Telegram/Facebook/Reddit) já frequentadas pelo mantenedor, classificadas como "permite" ou autorizadas por escrito pelo admin. Nenhuma está verificada hoje (pesquisa 2.4). Um post por comunidade, ≥ 48 h entre posts. Atribuição por janela de horário (UTM não funciona hoje: `docs/js/common.js:158–160`).
- **Custo máximo**: R$ 100,00 de IA dos créditos grátis (25 créditos grátis consumidos × US$ 0,73 × R$ 5,40; câmbio é premissa), dentro de R$ 112,00 no total do ciclo (baseline, seção 4). Mídia: R$ 0. **Pendente de aprovação do mantenedor.** Registrar também as horas do mantenedor (esforço não entra no teto).
- **Prazo**: 8 dias (D5–D12), com leitura final em D13.
- **Métrica principal**: `compra-paga` (cliente pagante: conta com ≥ 1 compra paga), conferida no admin (`pedidos.status = 'pago'`) e no Mercado Pago, sem compras de teste nem cortesia nem contas do mantenedor (metrics.md).
- **Métrica de proteção**: (1) denúncias, remoções, advertências de admin ou reclamações de spam; (2) checkout: `compra-paga` / `compra-iniciada` (queda indica problema técnico ou de confiança).
- **Critério de sucesso**: ≥ 2 clientes pagantes independentes (contas distintas) até 2026-11-09, com exposição ≤ 25 créditos grátis e nenhuma remoção/denúncia grave.
- **Critério de interrupção**: (1) 15 créditos grátis consumidos com 0 `compra-paga` independente → pausar a publicação em novas comunidades e reavaliar; (2) exposição (consumidos + grátis ainda não usados de contas novas do período) ≥ 25 → parar de divulgar, retomando só com aprovação do mantenedor e ≥ 1 `compra-paga` real; (3) qualquer remoção ou advertência de admin → parar naquela comunidade; (4) custo médio por análise do período > US$ 0,60 ou algum registro > US$ 0,73 → avisar o mantenedor antes de seguir; (5) risco legal ou de reputação identificado → parar.

**Resultado observado** (preencher ao final, só com dados medidos):
- Métrica principal: a preencher em D13–14
- Métrica de proteção: a preencher em D13–14
- Custo real: a preencher em D13–14
- O que aconteceu de inesperado: a preencher em D13–14

**Decisão final**: a preencher em D13–14.
Registrar a decisão também em decision-log.md.
