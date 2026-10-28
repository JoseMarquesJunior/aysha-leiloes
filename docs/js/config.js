/* Configuração do site (sem build): edite e publique. */
window.LT_CONFIG = {
  // Endereço público do site. Quem abrir o endereço antigo (GitHub Pages) é redirecionado para cá;
  // workers.dev e www redirecionam no próprio Worker do site (site/index.js).
  urlSite: "https://ayshaleiloes.com.br",

  // Link de apoio ao projeto (ex.: "https://buymeacoffee.com/seu-usuario" ou "https://ko-fi.com/seu-usuario").
  // Vazio = o botão "Apoie o projeto" não aparece.
  urlApoio: "",
  textoApoio: "Apoie o projeto ☕",

  // Contagem de visitas com GoatCounter (gratuito para sites sem fins comerciais, sem cookies).
  // Crie a conta em https://www.goatcounter.com/signup e informe aqui só o código escolhido
  // (ex.: "leiloes-em-tabela" para o painel https://leiloes-em-tabela.goatcounter.com).
  // Vazio = nada é carregado nem enviado.
  goatcounter: "leiloes-em-tabela",

  // Serviço de contas, créditos e análises com IA (Cloudflare Worker, pasta worker/): login por link mágico,
  // saldo de créditos, entrega dos relatórios a quem tem acesso e checkout no Mercado Pago.
  urlWorker: "https://aysha-leiloes-analise.leiloes.workers.dev",
};
