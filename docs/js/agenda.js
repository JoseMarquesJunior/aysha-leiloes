/* Agenda de leilões: calendário mensal, lista com lembretes por e-mail (dias antes), hora opcional,
   exportação .ics e sincronização das datas com a base (a coleta pode mudar a data do leilão). */
(function () {
  "use strict";
  const { escapar, data, moeda, carregarJson, hojeIso } = LT;
  const el = document.getElementById("agenda");
  const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const OPCOES_LEMBRETE = [[7, "7 dias antes"], [1, "1 dia antes"], [0, "no dia"]];
  let itens = [], registros = {}, mesVisto = hojeIso().slice(0, 7);

  function datasDe(i) { return [["1ª praça", i.data_leilao], ["2ª praça", i.data_segunda_praca]].filter(x => x[1]); }
  function proxima(i) { const hoje = hojeIso(); const fut = datasDe(i).map(x => x[1]).filter(d => d >= hoje).sort(); return fut[0] || null; }

  /* Reaplica à agenda as datas atuais da base (carrega só os arquivos das UFs envolvidas). */
  async function sincronizar() {
    const ufs = [...new Set(itens.map(i => i.uf).filter(Boolean))];
    for (const uf of ufs) {
      let lista;
      try { lista = await carregarJson(`imoveis_${uf}.json`); } catch (e) { continue; }
      for (const i of itens.filter(x => x.uf === uf)) {
        const r = lista.find(x => x.id === i.id);
        if (!r) continue;
        registros[i.id] = r;
        if ((r.data_leilao || null) !== (i.data_leilao || null) || (r.data_segunda_praca || null) !== (i.data_segunda_praca || null)) {
          const x = await LT.api("/agenda", { body: { id: i.id, uf: i.uf, titulo: i.titulo, data_leilao: r.data_leilao, data_segunda_praca: r.data_segunda_praca } }).catch(() => null);
          if (x && x.ok) Object.assign(i, x.dados.item, { atualizada: true });
        }
      }
    }
  }

  function calendario() {
    const [ano, mes] = mesVisto.split("-").map(Number);
    const primeiro = new Date(ano, mes - 1, 1), diasNoMes = new Date(ano, mes, 0).getDate();
    const porDia = {};
    for (const i of itens) for (const [rot, d] of datasDe(i)) if (d.startsWith(mesVisto)) (porDia[d] = porDia[d] || []).push({ i, rot });
    let celulas = "";
    for (let k = 0; k < primeiro.getDay(); k++) celulas += '<div class="dia vazio"></div>';
    for (let d = 1; d <= diasNoMes; d++) {
      const iso = `${mesVisto}-${String(d).padStart(2, "0")}`;
      const ev = porDia[iso] || [];
      celulas += `<div class="dia${ev.length ? " tem" : ""}${iso === hojeIso() ? " hoje" : ""}"><span class="n">${d}</span>${ev.slice(0, 3).map(e => `<a class="ev" href="imovel.html?id=${encodeURIComponent(e.i.id)}&uf=${escapar(e.i.uf || "")}" title="${escapar(e.i.titulo)} · ${e.rot}">${escapar(e.i.titulo.split(" em ")[1] || e.i.titulo)}</a>`).join("")}${ev.length > 3 ? `<span class="mais">+${ev.length - 3}</span>` : ""}</div>`;
    }
    const ant = new Date(ano, mes - 2, 1), prox = new Date(ano, mes, 1);
    const ym = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
    return `<div class="cal-topo"><button type="button" class="btn pequeno" data-mes="${ym(ant)}">‹</button><b>${MESES[mes - 1]} de ${ano}</b><button type="button" class="btn pequeno" data-mes="${ym(prox)}">›</button><button type="button" class="btn pequeno" data-mes="${hojeIso().slice(0, 7)}">hoje</button></div>
      <div class="cal"><div class="cab">dom</div><div class="cab">seg</div><div class="cab">ter</div><div class="cab">qua</div><div class="cab">qui</div><div class="cab">sex</div><div class="cab">sáb</div>${celulas}</div>`;
  }

  function itemHtml(i) {
    const r = registros[i.id];
    const prox = proxima(i);
    const dias = prox ? Math.round((new Date(prox + "T00:00:00") - new Date(hojeIso() + "T00:00:00")) / 86400000) : null;
    const quando = prox ? (dias === 0 ? "hoje" : dias === 1 ? "amanhã" : `em ${dias} dias`) : "sem data futura";
    return `<li class="agenda-item" data-id="${escapar(i.id)}">
      <div class="ai-topo">
        <div><a class="ai-titulo" href="imovel.html?id=${encodeURIComponent(i.id)}&uf=${escapar(i.uf || "")}">${escapar(i.titulo)}</a>
          <div class="muted">${datasDe(i).map(([rot, d]) => `${rot}: <b>${data(d)}</b>`).join(" · ") || "sem data informada pela fonte"}${i.hora ? ` · ${escapar(i.hora)}` : ""}${r && r.valor_minimo ? ` · lance mínimo ${moeda(r.valor_minimo)}` : ""}${i.atualizada ? ' · <span class="v-sim">data atualizada pela coleta</span>' : ""}</div></div>
        <span class="ai-quando ${dias !== null && dias <= 7 ? "perto" : ""}">${quando}</span>
      </div>
      <div class="ai-opcoes">
        <span class="muted">Lembrar por e-mail:</span>
        ${OPCOES_LEMBRETE.map(([n, rot]) => `<label class="cb"><input type="checkbox" data-lembrete="${n}" ${i.lembretes.includes(n) ? "checked" : ""}> ${rot}</label>`).join("")}
        <label class="cb">Hora <input type="time" data-hora value="${escapar(i.hora || "")}" title="Horário do leilão (opcional; entra no lembrete e no calendário)"></label>
        <button type="button" class="btn pequeno" data-remover>Remover</button>
      </div></li>`;
  }

  function render() {
    const hoje = hojeIso();
    const futuros = itens.filter(i => proxima(i) || !datasDe(i).length).sort((a, b) => (proxima(a) || "9999").localeCompare(proxima(b) || "9999"));
    const passados = itens.filter(i => datasDe(i).length && !proxima(i));
    el.innerHTML = `<h2>Agenda de leilões</h2>
      <p>${itens.length ? `${itens.length} imóve${itens.length > 1 ? "is" : "l"} na agenda.` : "Nenhum leilão na agenda ainda."} Para adicionar, abra a ficha de um imóvel e clique em <b>Salvar na agenda</b>. Os lembretes chegam por e-mail às 8h, nos dias que você marcar.
        ${itens.length ? '<button type="button" class="btn pequeno" id="btn-ics">Baixar .ics (Google Agenda, iPhone, Outlook)</button>' : ""}</p>
      ${itens.length ? calendario() : ""}
      <h3>Próximos</h3>${futuros.length ? `<ul class="agenda-lista">${futuros.map(itemHtml).join("")}</ul>` : '<p class="muted">Nada marcado.</p>'}
      ${passados.length ? `<h3>Encerrados</h3><ul class="agenda-lista encerrados">${passados.map(itemHtml).join("")}</ul>` : ""}`;
    el.querySelectorAll("[data-mes]").forEach(b => b.addEventListener("click", () => { mesVisto = b.dataset.mes; render(); }));
    el.querySelectorAll(".agenda-item").forEach(li => {
      const i = itens.find(x => x.id === li.dataset.id);
      li.querySelectorAll("[data-lembrete]").forEach(cb => cb.addEventListener("change", async () => {
        const lembretes = [...li.querySelectorAll("[data-lembrete]:checked")].map(c => Number(c.dataset.lembrete));
        const x = await LT.api("/agenda", { body: { ...base(i), lembretes } }).catch(() => null);
        if (x && x.ok) Object.assign(i, x.dados.item);
      }));
      li.querySelector("[data-hora]").addEventListener("change", async ev => {
        const x = await LT.api("/agenda", { body: { ...base(i), hora: ev.target.value || null } }).catch(() => null);
        if (x && x.ok) { Object.assign(i, x.dados.item); render(); }
      });
      li.querySelector("[data-remover]").addEventListener("click", async () => {
        if (!confirm(`Remover "${i.titulo}" da agenda?`)) return;
        const x = await LT.api("/agenda/remover", { body: { id: i.id } }).catch(() => null);
        if (x && x.ok) { itens = itens.filter(y => y.id !== i.id); render(); }
      });
    });
    const ics = document.getElementById("btn-ics");
    if (ics) ics.addEventListener("click", baixarIcs);
    void hoje;
  }
  function base(i) { return { id: i.id, uf: i.uf, titulo: i.titulo, data_leilao: i.data_leilao, data_segunda_praca: i.data_segunda_praca }; }

  /* Arquivo iCalendar com um evento por praça; com hora, evento de 1 h no fuso de Brasília; sem hora, dia inteiro. */
  function baixarIcs() {
    const esc = s => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
    const site = (window.LT_CONFIG || {}).urlSite || location.origin;
    const linhas = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Aysha Leilões//Agenda//PT", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
    for (const i of itens) for (const [rot, d] of datasDe(i)) {
      const uid = `${i.id}-${d}@aysha-leiloes`;
      const url = `${site}/imovel.html?id=${encodeURIComponent(i.id)}&uf=${i.uf || ""}`;
      linhas.push("BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`);
      if (i.hora) {
        const ini = d.replace(/-/g, "") + "T" + i.hora.replace(":", "") + "00";
        const fim = d.replace(/-/g, "") + "T" + String(Number(i.hora.slice(0, 2)) + 1).padStart(2, "0") + i.hora.slice(3) + "00";
        linhas.push(`DTSTART;TZID=America/Sao_Paulo:${ini}`, `DTEND;TZID=America/Sao_Paulo:${fim}`);
      } else {
        linhas.push(`DTSTART;VALUE=DATE:${d.replace(/-/g, "")}`);
      }
      linhas.push(`SUMMARY:${esc(`Leilão (${rot}): ${i.titulo}`)}`, `DESCRIPTION:${esc(`Ficha: ${url}\nConfira a data e o horário no edital.`)}`, `URL:${url}`,
        "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc("Leilão amanhã: " + i.titulo)}`, "TRIGGER:-P1D", "END:VALARM", "END:VEVENT");
    }
    linhas.push("END:VCALENDAR");
    const blob = new Blob([linhas.join("\r\n")], { type: "text/calendar;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "aysha-leiloes-agenda.ics"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    LT.evento("agenda-ics");
  }

  async function iniciar() {
    if (!LT.urlWorker()) { el.innerHTML = '<h2>Agenda</h2><p class="muted">Indisponível nesta instalação.</p>'; return; }
    if (!LT.sessao()) {
      el.innerHTML = `<h2>Agenda de leilões</h2>
        <div class="conta-intro"><div><p><b>Entre com o seu e-mail</b> para guardar as datas dos leilões que você acompanha e receber lembretes.</p><div id="login"></div></div>
        <ul class="beneficios">
          <li><b>Calendário dos seus leilões</b><span>1ª e 2ª praça de cada imóvel salvo, mês a mês.</span></li>
          <li><b>Lembretes por e-mail</b><span>7 dias antes, 1 dia antes e no dia, às 8h. Você escolhe quais.</span></li>
          <li><b>No calendário do celular</b><span>Exporte tudo em .ics para Google Agenda, iPhone ou Outlook.</span></li>
          <li><b>Datas sempre atuais</b><span>Se a fonte mudar a data, a agenda acompanha na coleta seguinte.</span></li>
        </ul></div>`;
      LT.formularioLogin(document.getElementById("login"), { voltarPara: location.origin + location.pathname });
      return;
    }
    const r = await LT.api("/agenda").catch(() => null);
    if (!r) { el.innerHTML = '<h2>Agenda</h2><p class="muted">Serviço fora do ar. Tente de novo em alguns minutos.</p>'; return; }
    if (r.status === 401) { LT.limparSessao(); location.reload(); return; }
    itens = r.dados.itens || [];
    render();
    await sincronizar();
    render();
  }

  iniciar().catch(err => { console.error(err); el.innerHTML = `<h2>Agenda</h2><p class="muted">Erro: ${escapar(err.message)}</p>`; });
})();
