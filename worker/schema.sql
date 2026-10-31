-- Banco D1 (SQLite) do Worker: contas, créditos, relatórios e pagamentos.
-- Aplicar: npx wrangler d1 execute aysha-contas --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  criado_em TEXT NOT NULL,
  ultimo_login TEXT,
  creditos INTEGER NOT NULL DEFAULT 1,     -- conta nova nasce com 1 crédito (primeira análise grátis)
  gratis_usado INTEGER NOT NULL DEFAULT 1, -- legado: hoje a "análise grátis" é o crédito inicial
  cupom TEXT                               -- cupom de parceiro aplicado na criação (no máximo um; NULL = sem cupom)
);
CREATE INDEX IF NOT EXISTS idx_usuarios_cupom ON usuarios(cupom);

-- links de login (válidos por 20 minutos, uso único)
CREATE TABLE IF NOT EXISTS links_login (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expira_em TEXT NOT NULL,
  usado INTEGER NOT NULL DEFAULT 0,
  cupom TEXT  -- cupom de parceiro informado no pedido do link; aplicado só se a conta for criada
);
-- banco já existente: aplicar worker/migrations/2026-10-31-cupom-parceiro.sql (os CREATE IF NOT EXISTS acima não alteram tabela existente)

-- sessões (token portador guardado no navegador; 90 dias)
CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL,
  criado_em TEXT NOT NULL,
  expira_em TEXT NOT NULL
);

-- relatórios gerados (um por imóvel; markdown só sai daqui, para quem tem acesso)
CREATE TABLE IF NOT EXISTS relatorios (
  id_imovel TEXT PRIMARY KEY,
  gerado_em TEXT NOT NULL,
  modelo TEXT,
  custo_usd REAL,
  documentos_lidos INTEGER,
  uso_json TEXT,
  campos_json TEXT,
  markdown TEXT NOT NULL
);

-- quem tem acesso a qual relatório (comprado com crédito ou com a análise grátis)
CREATE TABLE IF NOT EXISTS acessos (
  usuario_id INTEGER NOT NULL,
  id_imovel TEXT NOT NULL,
  liberado_em TEXT NOT NULL,
  origem TEXT NOT NULL, -- 'gratis' | 'credito' | 'cortesia'
  PRIMARY KEY (usuario_id, id_imovel)
);

-- análises pedidas e ainda não concluídas (para não disparar duas vezes)
CREATE TABLE IF NOT EXISTS analises_pendentes (
  id_imovel TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL,
  pedido_em TEXT NOT NULL
);

-- compras de créditos (Mercado Pago)
CREATE TABLE IF NOT EXISTS pedidos (
  id TEXT PRIMARY KEY,            -- uuid, usado como external_reference no Mercado Pago
  usuario_id INTEGER NOT NULL,
  pacote TEXT NOT NULL,
  creditos INTEGER NOT NULL,
  valor_centavos INTEGER NOT NULL,
  status TEXT NOT NULL,           -- 'criado' | 'pago' | 'cancelado'
  mp_preference_id TEXT,
  mp_payment_id TEXT,
  criado_em TEXT NOT NULL,
  pago_em TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessoes_usuario ON sessoes(usuario_id);
CREATE INDEX IF NOT EXISTS idx_acessos_imovel ON acessos(id_imovel);
CREATE INDEX IF NOT EXISTS idx_pedidos_usuario ON pedidos(usuario_id);

-- alertas de imóveis: "me avise de imóveis novos em [UF/cidade] com desconto acima de X%" (e-mail diário)
CREATE TABLE IF NOT EXISTS alertas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL,
  uf TEXT NOT NULL,
  cidade TEXT,                -- NULL = todas as cidades da UF
  tipo TEXT,                  -- apartamento | casa | terreno | comercial | rural | outro; NULL = todos
  desconto_min INTEGER,       -- % mínimo sobre a avaliação; NULL = qualquer
  valor_max INTEGER,          -- lance máximo em reais; NULL = qualquer
  chave TEXT NOT NULL UNIQUE, -- token do link de descadastro de 1 clique (sem login)
  criado_em TEXT NOT NULL,
  ultimo_envio TEXT           -- última data de evento já coberta por um envio (nada sai duas vezes)
);
CREATE INDEX IF NOT EXISTS idx_alertas_usuario ON alertas(usuario_id);

-- geocodificação sob demanda: na primeira visita a uma ficha com endereço e localização aproximada,
-- o Worker geocodifica o endereço e guarda o ponto aqui; a coleta diária incorpora à base (GET /interno/geo).
-- Falhas definitivas (precisao NULL) também ficam guardadas para não repetir a consulta a cada visita.
CREATE TABLE IF NOT EXISTS geo_imovel (
  id TEXT PRIMARY KEY,   -- id do imóvel na base
  lat REAL,
  lng REAL,
  precisao TEXT,         -- 'endereco' ou NULL (consulta sem resultado confiável)
  consulta TEXT,         -- o que foi perguntado ao geocodificador (depuração)
  criado_em TEXT NOT NULL
);

-- agenda: leilões que o usuário quer acompanhar, com lembretes por e-mail (dias antes: ex. [7,1,0])
CREATE TABLE IF NOT EXISTS agenda (
  usuario_id INTEGER NOT NULL,
  id_imovel TEXT NOT NULL,
  uf TEXT,
  titulo TEXT,
  data_leilao TEXT,
  data_segunda_praca TEXT,
  hora TEXT,                                -- opcional, "HH:MM", informada pelo usuário
  lembretes TEXT NOT NULL DEFAULT '[7,1,0]',
  enviados TEXT NOT NULL DEFAULT '[]',      -- lembretes já enviados: ["2026-12-10:7", ...]
  criado_em TEXT NOT NULL,
  atualizado_em TEXT,
  PRIMARY KEY (usuario_id, id_imovel)
);
CREATE INDEX IF NOT EXISTS idx_agenda_datas ON agenda(data_leilao, data_segunda_praca);
