/* Página "Como funciona e preços": números da base e tabela de pacotes (lida do Worker, com os valores fixos
   da página como reserva). O estado das fontes e os campos em branco ficam na administração. */
(function () {
  "use strict";
  const { escapar, carregarJson } = LT;

  function reais(c) { const v = c / 100; return "R$ " + (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(".", ",")); }

  async function iniciar() {
    const cfg = window.LT_CONFIG || {};
    if (cfg.urlApoio) {
      const a = document.getElementById("apoio-link");
      a.href = cfg.urlApoio; a.textContent = cfg.textoApoio || "apoie o projeto";
      document.getElementById("apoio").classList.remove("hidden");
    }
    const meta = await carregarJson("meta.json").catch(() => null);
    if (meta) {
      document.getElementById("n-imoveis").textContent = (meta.ativos || 0).toLocaleString("pt-BR");
    }
    if (LT.urlWorker()) {
      const r = await LT.api("/pacotes").catch(() => null);
      const lista = r && r.ok ? r.dados.pacotes : null;
      if (lista && lista.length) {
        const maisBarato = Math.max(...lista.map(p => p.creditos));
        const destaque = lista.length >= 3 ? lista[1].id : lista[lista.length - 1].id;
        document.getElementById("pacotes").innerHTML = lista.map(p => `<div class="preco${p.id === destaque ? " melhor" : ""}">${p.id === destaque ? '<div class="selo">mais escolhido</div>' : ""}
          <div class="nome">${escapar(p.nome)}</div><div class="valor">${reais(p.valor_centavos)}</div>
          <div class="muted">${p.creditos === 1 ? "para decidir sobre um imóvel" : `${reais(Math.round(p.valor_centavos / p.creditos))} por análise${p.creditos === maisBarato ? " · para quem acompanha o mercado" : ""}`}</div></div>`).join("");
      }
    }
  }

  iniciar().catch(err => console.error(err));
})();
