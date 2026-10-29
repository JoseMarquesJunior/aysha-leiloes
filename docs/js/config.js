/* Configuração do site (sem build): edite e publique. */
window.LT_CONFIG = {
  // Endereço público do site. Quem abrir o endereço antigo (GitHub Pages) é redirecionado para cá;
  // workers.dev e www redirecionam no próprio Worker do site (site/index.js).
  urlSite: "https://ayshaleiloes.com.br",

  // Link de apoio ao projeto (ex.: "https://buymeacoffee.com/seu-usuario" ou "https://ko-fi.com/seu-usuario").
  // Vazio = o botão "Apoie o projeto" não aparece.
  urlApoio: "",
  textoApoio: "Apoie o projeto ☕",

  // Contagem de visitas com Umami (https://cloud.umami.is): sem cookies, sem banner de consentimento,
  // com eventos do funil. Crie a conta, adicione o site e informe aqui o "Website ID" (um UUID, em
  // Settings → Websites → Edit). Vazio = nada é carregado nem enviado.
  umami: "f466d47b-d42f-419e-9e2b-7072083a2dff",

  // Serviço de contas, créditos e análises com IA (Cloudflare Worker, pasta worker/): login por link mágico,
  // saldo de créditos, entrega dos relatórios a quem tem acesso e checkout no Mercado Pago.
  urlWorker: "https://aysha-leiloes-analise.leiloes.workers.dev",
};
