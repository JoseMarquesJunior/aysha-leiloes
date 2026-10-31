-- Migração: cupom de parceiro (EXP-2026-02).
-- NÃO executar sem aprovação do mantenedor (altera o D1 de produção).
-- Aplicar (na raiz do repositório):
--   npx wrangler d1 execute aysha-contas --remote --file=worker/migrations/2026-10-31-cupom-parceiro.sql
-- Rollback: as colunas novas são ignoradas pelo código anterior; se preciso,
--   ALTER TABLE usuarios DROP COLUMN cupom; ALTER TABLE links_login DROP COLUMN cupom;

ALTER TABLE usuarios ADD COLUMN cupom TEXT;
ALTER TABLE links_login ADD COLUMN cupom TEXT;
CREATE INDEX IF NOT EXISTS idx_usuarios_cupom ON usuarios(cupom);
