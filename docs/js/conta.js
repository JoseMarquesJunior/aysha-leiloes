/* Página "Minha conta": entrada pelo link mágico (?token=), saldo de créditos, compra de pacotes (Mercado
   Pago), histórico de análises e de compras, retorno do checkout (?pedido=). */
(function () {
  "use strict";
  const { escapar, dataHora, lerQuery } = LT;
  const el = document.getElementById("conta");
  const q = lerQuery();

  function reais(centavos) { return "R$ " + (centavos / 100).toFixed(2).replace(".", ","); }
  const ORIGEM = { gratis: "1 crédito (grátis)", credito: "1 crédito", cortesia: "cortesia" };
  const STATUS_PEDIDO = { criado: "aguardando pagamento", pago: "pago", cancelado: "cancelado", cortesia: "ajuste pelo mantenedor" };

  async function entrarComToken(token) {
    el.innerHTML = '<p class="muted">entrando…</p>';
    const r = await LT.api("/auth/entrar", { body: { token } }).catch(() => ({ ok: false, dados: { erro: "sem conexão" } }));
    history.replaceState(null, "", "conta.html");
    if (!r.ok) {
      el.innerHTML = `<h2>Minha conta</h2><p class="aviso">${escapar(r.dados.erro || "link inválido")}</p><div id="login"></div>`;
      LT.formularioLogin(document.getElementById("login"), { titulo: "Peça um novo link:" });
      return;
    }
    LT.guardarSessao(r.dados.sessao, r.dados.email);
    LT.evento(r.dados.nova_conta ? "conta-nova" : "login-ok");
    const voltar = LT.lerVoltar();
    if (voltar && voltar.startsWith(location.origin) && !/conta\.html/.test(voltar)) { location.href = voltar; return; }
    await mostrarConta();
  }

  async function mostrarConta() {
    const r = await LT.api("/conta").catch(() => null);
    if (!r) { el.innerHTML = '<h2>Minha conta</h2><p class="muted">Serviço fora do ar no momento. Tente de novo em alguns minutos.</p>'; return; }
    if (r.status === 401) { mostrarLogin(); return; }
    const c = r.dados;
    const pacotes = (c.pacotes || []).map(p => `<div class="pacote"><div class="nome">${escapar(p.nome)}</div><div class="preco">${reais(p.valor_centavos)}</div>
        <div class="muted" style="font-size:.8rem">${reais(Math.round(p.valor_centavos / p.creditos))} por análise</div>
        <button type="button" class="btn primario" data-pacote="${escapar(p.id)}">Comprar</button></div>`).join("");
    const analises = (c.analises || []).length
      ? `<ul class="eventos">${c.analises.map(a => `<li><a href="imovel.html?id=${encodeURIComponent(a.id_imovel)}#analise">${escapar(a.id_imovel)}</a> · ${ORIGEM[a.origem] || escapar(a.origem)} · ${a.gerado_em ? "pronta" : "em geração"} · ${dataHora(a.liberado_em)}</li>`).join("")}</ul>`
      : '<p class="muted">Nenhuma análise ainda. Abra a ficha de um imóvel e clique em “Análise com IA”.</p>';
    const compras = (c.compras || []).length
      ? `<table class="simples"><thead><tr><th>Data</th><th>Pacote</th><th>Valor</th><th>Situação</th></tr></thead><tbody>${c.compras.map(p =>
        `<tr><td>${dataHora(p.criado_em)}</td><td>${p.creditos} crédito(s)</td><td>${reais(p.valor_centavos)}</td><td>${STATUS_PEDIDO[p.status] || escapar(p.status)}${p.pago_em ? " em " + dataHora(p.pago_em) : ""}</td></tr>`).join("")}</tbody></table>`
      : '<p class="muted">Nenhuma compra.</p>';
    el.innerHTML = `<h2>Minha conta</h2>
      <p>${escapar(c.email)} · <a href="#" id="sair">sair</a></p>
      <div class="kpis">
        <div class="kpi"><div class="r">Créditos</div><div class="v">${c.creditos}</div><div class="s">1 crédito = 1 análise com IA</div></div>
      </div>
      <div id="retorno-pedido"></div>
      <h2 id="creditos">Comprar créditos</h2>
      <p>Pix ou cartão, pelo Mercado Pago. Os créditos entram na conta assim que o pagamento é confirmado (Pix: em segundos; cartão: na hora, salvo análise antifraude) e não expiram. Você recebe um recibo por e-mail.</p>
      <div class="pacotes" id="pacotes">${pacotes || '<p class="muted">Compra ainda não disponível.</p>'}</div>
      <p class="muted" style="font-size:.8rem">Abrir de novo uma análise que você já tem não gasta crédito. Uma análise já gerada por outra pessoa também custa 1 crédito, porque a entrega é por conta. <a href="sobre.html#contas">Termos, reembolso e privacidade</a>.</p>
      <h2>Minhas análises</h2>${analises}
      <h2>Compras</h2>${compras}
      <h2>Segurança e privacidade</h2>
      <p>A sessão expira após 30 dias sem uso. <button type="button" class="btn pequeno" id="sair-todos">Sair de todos os dispositivos</button></p>
      <p>Você pode apagar sua conta a qualquer momento: e-mail, sessões e acessos às análises são removidos; os registros de compra ficam sem vínculo com o seu e-mail, porque precisam ser guardados por obrigação fiscal. Créditos não usados são perdidos. <button type="button" class="btn pequeno perigo" id="apagar-conta">Apagar minha conta</button></p>`;
    document.getElementById("sair").addEventListener("click", async ev => { ev.preventDefault(); await LT.api("/auth/sair", { body: {} }).catch(() => null); LT.limparSessao(); mostrarLogin(); });
    document.getElementById("sair-todos").addEventListener("click", async () => { await LT.api("/auth/sair_todos", { body: {} }).catch(() => null); LT.limparSessao(); mostrarLogin(); });
    document.getElementById("apagar-conta").addEventListener("click", async () => {
      if (!confirm(`Apagar a conta ${c.email}? Isso remove seus acessos às análises e não pode ser desfeito.`)) return;
      const r = await LT.api("/conta/apagar", { body: {} }).catch(() => ({ ok: false }));
      if (!r.ok) { alert("Não foi possível apagar agora. Tente de novo."); return; }
      LT.limparSessao(); el.innerHTML = '<h2>Minha conta</h2><p class="aviso ok">Conta apagada.</p><p><a href="./">← voltar à tabela</a></p>';
    });
    for (const b of el.querySelectorAll("button[data-pacote]")) b.addEventListener("click", () => comprar(b.dataset.pacote, b));
    if (q.pedido) acompanharPedido(q.pedido);
    if (location.hash === "#creditos") document.getElementById("creditos").scrollIntoView({ behavior: "smooth" });
  }

  async function comprar(pacote, btn) {
    btn.disabled = true; btn.textContent = "Abrindo o pagamento…";
    const r = await LT.api("/pagamento/criar", { body: { pacote } }).catch(() => ({ ok: false, dados: { erro: "sem conexão" } }));
    if (!r.ok) { btn.disabled = false; btn.textContent = "Comprar"; alert("Não foi possível iniciar a compra: " + (r.dados.erro || "tente de novo")); return; }
    LT.evento("compra-iniciada");
    location.href = r.dados.checkout;
  }

  async function acompanharPedido(pedido) {
    const box = document.getElementById("retorno-pedido");
    history.replaceState(null, "", "conta.html");
    if (q.falha) { box.innerHTML = '<p class="aviso">O pagamento não foi concluído. Nada foi cobrado; você pode tentar de novo.</p>'; return; }
    box.innerHTML = '<p class="aviso">Confirmando o pagamento…</p>';
    for (let i = 0; i < 20; i++) {
      const r = await LT.api(`/pagamento/estado/${encodeURIComponent(pedido)}`).catch(() => null);
      if (r && r.ok && r.dados.status === "pago") {
        LT.evento("compra-paga");
        box.innerHTML = `<p class="aviso ok">Pagamento confirmado: ${r.dados.creditos} crédito(s) adicionados. Saldo atual: ${r.dados.saldo}. O recibo foi enviado por e-mail.</p>`;
        setTimeout(mostrarConta, 2500);
        return;
      }
      if (r && r.ok && r.dados.status === "cancelado") { box.innerHTML = '<p class="aviso">O pagamento foi recusado ou cancelado. Nada foi cobrado.</p>'; return; }
      await new Promise(res => setTimeout(res, 3000));
    }
    box.innerHTML = '<p class="aviso">Ainda não recebemos a confirmação. Pix e boleto podem levar alguns minutos; os créditos entram sozinhos quando o pagamento for aprovado. Recarregue esta página mais tarde.</p>';
  }

  function mostrarLogin() {
    el.innerHTML = `<h2>Minha conta</h2>
      <div class="conta-intro">
        <div>
          <p><b>Entre com o seu e-mail.</b> Sem senha: enviamos um link de acesso. Toda conta nova ganha 1 crédito, e a primeira análise com IA é grátis.</p>
          <div id="login"></div>
        </div>
        <ul class="beneficios">
          <li><b>Análise do edital e da matrícula por IA</b><span>Resumo do lote, conta no lance mínimo, referência de mercado, sinais vermelhos e veredito, em minutos. <a href="exemplo-analise.html">Veja um exemplo →</a></span></li>
          <li><b>Seus pareceres ficam guardados</b><span>Reabrir uma análise que já é sua não gasta crédito.</span></li>
          <li><b>Créditos sem assinatura</b><span>Pacotes a partir de R$ 14,90, Pix ou cartão pelo Mercado Pago. Os créditos não expiram.</span></li>
          <li><b>Tabela, mapa e filtros continuam gratuitos</b><span>A conta só é necessária para as análises.</span></li>
        </ul>
      </div>`;
    LT.formularioLogin(document.getElementById("login"), { voltarPara: location.origin + location.pathname });
  }

  if (!LT.urlWorker()) { el.innerHTML = '<h2>Minha conta</h2><p class="muted">Contas indisponíveis nesta instalação.</p>'; return; }
  // o token do link mágico vem no fragmento (#token=...), que não vai ao servidor nem para o GoatCounter
  const tokenHash = (location.hash.match(/token=([0-9a-f]+)/) || [])[1];
  if (tokenHash || q.token) entrarComToken(tokenHash || q.token);
  else if (LT.sessao()) mostrarConta();
  else mostrarLogin();
})();
