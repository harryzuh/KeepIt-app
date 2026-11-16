-- Catálogo oficial dos planos (ADR 0001; mesmo conteúdo de src/lib/planos.ts).
-- Antes só o seed criava os planos, e o seed não roda em produção: o cadastro falhava com
-- "Plano INDIVIDUAL não cadastrado". Idempotente: não altera planos que já existem (ex.: criados pelo seed em dev).
INSERT INTO "plano" ("nome", "preco", "limite_membros", "limite_armazenamento_gb") VALUES
  ('INDIVIDUAL', 0.00, 1, 1),
  ('FAMILIA', 19.90, 6, 20),
  ('BUSINESS', 49.90, 15, 100)
ON CONFLICT ("nome") DO NOTHING;
