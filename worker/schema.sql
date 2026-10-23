-- Banco D1 (SQLite) do Worker: contas, créditos, relatórios e pagamentos.
-- Aplicar: npx wrangler d1 execute aysha-contas --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  criado_em TEXT NOT NULL,
  ultimo_login TEXT,
  creditos INTEGER NOT NULL DEFAULT 0,
  gratis_usado INTEGER NOT NULL DEFAULT 0
);

-- links de login (válidos por 20 minutos, uso único)
CREATE TABLE IF NOT EXISTS links_login (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expira_em TEXT NOT NULL,
  usado INTEGER NOT NULL DEFAULT 0
);

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
