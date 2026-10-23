/* Exemplo público de análise com IA (um parecer real, aberto, para quem quer ver o que recebe). */
(async function () {
  "use strict";
  const { escapar, moeda, numero, cap, markdownParaHtml, carregarJson } = LT;
  const el = document.getElementById("exemplo");
  try {
    const d = await carregarJson("exemplo_analise.json");
    const tipo = cap(d.tipo) || "Imóvel";
    el.innerHTML = `
      <h2>Exemplo de análise com IA</h2>
      <p>Este é um parecer real, gerado pela ferramenta para o imóvel abaixo. É o que você recebe ao pedir a análise de qualquer imóvel da tabela: leitura do edital e da matrícula, preço de mercado do bairro, custos no lance, sinais vermelhos e veredito. <a href="imovel.html?id=${encodeURIComponent(d.id)}&uf=${escapar(d.uf)}">Abrir a ficha deste imóvel →</a></p>
      <div class="kpis">
        <div class="kpi"><div class="r">Imóvel</div><div class="v">${escapar(tipo)}</div><div class="s">${escapar([d.bairro, d.cidade].filter(Boolean).join(", "))}${d.uf ? "/" + escapar(d.uf) : ""}</div></div>
        <div class="kpi"><div class="r">Lance mínimo</div><div class="v">${moeda(d.valor_minimo)}</div><div class="s">avaliação ${moeda(d.valor_avaliacao)}</div></div>
        <div class="kpi"><div class="r">Área</div><div class="v">${d.area_privativa_m2 ? numero(d.area_privativa_m2) + " m²" : "—"}</div><div class="s">${d.quartos ? d.quartos + " quartos" : ""}</div></div>
      </div>
      <div class="bloco largo relatorio"><h3>✦ Análise com IA</h3><div class="relatorio-texto">${markdownParaHtml(d.markdown || "")}</div>
      <p class="aviso">Parecer automático, gerado por IA a partir do edital, da matrícula e de buscas na web. Pode conter erros. Não é assessoria jurídica nem recomendação de investimento: confira os documentos e consulte um profissional antes de dar lance.</p></div>
      <p class="chamada"><a class="btn primario btn-ia-grande" href="./">Escolher um imóvel na tabela</a> <span class="muted">Toda conta nova ganha 1 crédito: a primeira análise é grátis.</span></p>`;
  } catch (e) {
    el.innerHTML = `<h2>Exemplo de análise com IA</h2><p class="muted">Exemplo indisponível no momento (${escapar(e.message)}).</p>`;
  }
})();
