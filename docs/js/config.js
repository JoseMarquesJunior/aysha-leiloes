/* Configuração do site (sem build): edite e publique. */
window.LT_CONFIG = {
  // Link de apoio ao projeto (ex.: "https://buymeacoffee.com/seu-usuario" ou "https://ko-fi.com/seu-usuario").
  // Vazio = o botão "Apoie o projeto" não aparece.
  urlApoio: "",
  textoApoio: "Apoie o projeto ☕",

  // Contagem de visitas com GoatCounter (gratuito para sites sem fins comerciais, sem cookies).
  // Crie a conta em https://www.goatcounter.com/signup e informe aqui só o código escolhido
  // (ex.: "leiloes-em-tabela" para o painel https://leiloes-em-tabela.goatcounter.com).
  // Vazio = nada é carregado nem enviado.
  goatcounter: "leiloes-em-tabela",

  // Análise com IA sob demanda. O botão abre uma issue pré-preenchida neste repositório; um workflow
  // gera o relatório (Opus + busca na web), commita e ele passa a aparecer na ficha. Precisa de conta no GitHub.
  // Se um dia houver um serviço próprio (Cloudflare Worker), informe a URL em urlAnaliseWorker e o botão
  // passa a chamá-lo diretamente, sem GitHub.
  repositorioIssues: "https://github.com/JoseMarquesJunior/aysha-leiloes/issues/new",
  urlAnaliseWorker: "https://aysha-leiloes-analise.aysha-leiloes-analise.workers.dev/analise",
};
