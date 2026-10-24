/* Administração: usuários, créditos, pedidos, relatórios. Entra com o mesmo login por e-mail; o Worker só
   responde às rotas /admin/* para os e-mails em ADMIN_EMAILS. */
(function () {
  "use strict";
  const { escapar, dataHora, data } = LT;
  const el = document.getElementById("admin");

  function reais(c) { return "R$ " + ((c || 0) / 100).toFixed(2).replace(".", ","); }
  function usd(v) { return "US$ " + (v || 0).toFixed(2); }
  const ORIGEM = { gratis: "grátis", credito: "crédito", cortesia: "cortesia" };
  const STATUS = { criado: "aguardando", pago: "pago", cancelado: "cancelado", cortesia: "cortesia" };

  function kpi(r, v, s) { return `<div class="kpi"><div class="r">${escapar(r)}</div><div class="v">${v}</div>${s ? `<div class="s">${escapar(s)}</div>` : ""}</div>`; }
  function tabela(cab, linhas) {
    return linhas.length ? `<div class="tabela-wrap"><table class="simples"><thead><tr>${cab.map(c => `<th>${escapar(c)}</th>`).join("")}</tr></thead><tbody>${linhas.join("")}</tbody></table></div>` : '<p class="muted">Nada ainda.</p>';
  }

  async function mostrar() {
    const r = await LT.api("/admin/resumo").catch(() => null);
    if (!r) { el.innerHTML = '<h2>Administração</h2><p class="muted">Serviço fora do ar.</p>'; return; }
    if (r.status === 401) { mostrarLogin(); return; }
    if (r.status === 403) { el.innerHTML = `<h2>Administração</h2><p class="aviso">Esta conta (${escapar(LT.emailSessao())}) não é administradora. <a href="conta.html">Minha conta</a></p>`; return; }
    const m = r.dados;
    el.innerHTML = `<h2>Administração</h2>
      <p>${escapar(LT.emailSessao())} · <a href="conta.html">minha conta</a> · <a href="https://leiloes-em-tabela.goatcounter.com" target="_blank" rel="noopener">GoatCounter ↗</a> · <a href="https://github.com/JoseMarquesJunior/aysha-leiloes/actions" target="_blank" rel="noopener">Actions ↗</a></p>
      <div class="kpis">
        ${kpi("Contas", m.usuarios, `${m.usuarios_7d} nos últimos 7 dias`)}
        ${kpi("Créditos em circulação", m.creditos_em_circulacao, "saldo somado das contas")}
        ${kpi("Análises liberadas", m.acessos, `${m.acessos_7d} nos últimos 7 dias · ${m.pendentes} em geração`)}
        ${kpi("Relatórios gerados", m.relatorios, `custo ${usd(m.custo_usd)}`)}
        ${kpi("Compras pagas", m.pedidos_pagos, `receita ${reais(m.receita_centavos)}`)}
      </div>
      <h2 id="usuarios">Usuários</h2>
      <form class="admin-busca" id="busca"><input type="search" id="q" placeholder="filtrar por e-mail" autocomplete="off"><button type="submit" class="btn">Buscar</button></form>
      <div id="lista-usuarios"><p class="muted">carregando…</p></div>
      <h3>Ajustar créditos</h3>
      <form class="admin-creditos" id="form-creditos">
        <label>E-mail <input type="email" id="c-email" required></label>
        <label>Créditos (+ ou −) <input type="number" id="c-delta" required value="1" step="1"></label>
        <label>Motivo <input type="text" id="c-motivo" placeholder="cortesia, reembolso, teste…" maxlength="80"></label>
        <button type="submit" class="btn primario">Aplicar</button>
        <span id="c-msg" class="muted"></span>
      </form>
      <h2>Compras</h2><div id="lista-pedidos"><p class="muted">carregando…</p></div>
      <h2>Relatórios</h2><div id="lista-relatorios"><p class="muted">carregando…</p></div>`;
    document.getElementById("busca").addEventListener("submit", ev => { ev.preventDefault(); carregarUsuarios(document.getElementById("q").value.trim()); });
    document.getElementById("form-creditos").addEventListener("submit", async ev => {
      ev.preventDefault();
      const msg = document.getElementById("c-msg");
      msg.textContent = "aplicando…";
      const x = await LT.api("/admin/creditos", { body: { email: document.getElementById("c-email").value.trim(), delta: Number(document.getElementById("c-delta").value), motivo: document.getElementById("c-motivo").value.trim() } }).catch(() => ({ ok: false, dados: {} }));
      msg.textContent = x.ok ? `ok: saldo agora ${x.dados.creditos}` : "falhou: " + (x.dados.erro || "?");
      if (x.ok) { carregarUsuarios(document.getElementById("q").value.trim()); carregarPedidos(); }
    });
    carregarUsuarios(""); carregarPedidos(); carregarRelatorios();
  }

  async function carregarUsuarios(q) {
    const r = await LT.api("/admin/usuarios?q=" + encodeURIComponent(q || "")).catch(() => ({ ok: false, dados: {} }));
    const alvo = document.getElementById("lista-usuarios");
    if (!r.ok) { alvo.innerHTML = '<p class="muted">Não foi possível listar.</p>'; return; }
    alvo.innerHTML = tabela(["E-mail", "Criada", "Último login", "Créditos", "Análises", "Compras", "Pago"],
      r.dados.usuarios.map(u => `<tr><td>${escapar(u.email)}</td><td>${dataHora(u.criado_em)}</td><td>${dataHora(u.ultimo_login)}</td><td class="num">${u.creditos}</td><td class="num">${u.analises}</td><td class="num">${u.compras}</td><td class="num">${reais(u.pago)}</td></tr>`));
    if (r.dados.total > r.dados.usuarios.length) alvo.innerHTML += `<p class="muted">Mostrando ${r.dados.usuarios.length} de ${r.dados.total}; refine a busca.</p>`;
  }
  async function carregarPedidos() {
    const r = await LT.api("/admin/pedidos").catch(() => ({ ok: false, dados: {} }));
    const alvo = document.getElementById("lista-pedidos");
    if (!r.ok) { alvo.innerHTML = '<p class="muted">Não foi possível listar.</p>'; return; }
    alvo.innerHTML = tabela(["Data", "E-mail", "Pacote", "Créditos", "Valor", "Situação", "Pago em", "Mercado Pago"],
      r.dados.pedidos.map(p => `<tr><td>${dataHora(p.criado_em)}</td><td>${escapar(p.email || "(conta apagada)")}</td><td>${escapar(p.pacote)}</td><td class="num">${p.creditos}</td><td class="num">${reais(p.valor_centavos)}</td><td>${STATUS[p.status] || escapar(p.status)}</td><td>${p.pago_em ? dataHora(p.pago_em) : "—"}</td><td>${escapar(p.mp_payment_id || "—")}</td></tr>`));
  }
  async function carregarRelatorios() {
    const r = await LT.api("/admin/relatorios").catch(() => ({ ok: false, dados: {} }));
    const alvo = document.getElementById("lista-relatorios");
    if (!r.ok) { alvo.innerHTML = '<p class="muted">Não foi possível listar.</p>'; return; }
    const pend = (r.dados.pendentes || []).map(p => `<li><a href="imovel.html?id=${encodeURIComponent(p.id_imovel)}#analise">${escapar(p.id_imovel)}</a> · pedido por ${escapar(p.email || "?")} em ${dataHora(p.pedido_em)}</li>`).join("");
    alvo.innerHTML = (pend ? `<p><b>Em geração:</b></p><ul class="eventos">${pend}</ul>` : "") +
      tabela(["Imóvel", "Gerado em", "Modelo", "Docs", "Custo", "Acessos"],
        r.dados.relatorios.map(x => `<tr><td><a href="imovel.html?id=${encodeURIComponent(x.id_imovel)}#analise">${escapar(x.id_imovel)}</a></td><td>${dataHora(x.gerado_em)}</td><td>${escapar(x.modelo || "—")}</td><td class="num">${x.documentos_lidos ?? "—"}</td><td class="num">${usd(x.custo_usd)}</td><td class="num">${x.acessos}</td></tr>`));
  }

  function mostrarLogin() {
    el.innerHTML = '<h2>Administração</h2><p>Entre com o e-mail do mantenedor.</p><div id="login"></div>';
    LT.formularioLogin(document.getElementById("login"), { voltarPara: location.origin + location.pathname });
  }

  if (!LT.urlWorker()) { el.innerHTML = '<h2>Administração</h2><p class="muted">Indisponível nesta instalação.</p>'; return; }
  if (LT.sessao()) mostrar(); else mostrarLogin();
})();
