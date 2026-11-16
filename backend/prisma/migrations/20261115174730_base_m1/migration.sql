-- AlterTable
ALTER TABLE "codigo_verificacao" ADD COLUMN     "novo_email" VARCHAR(120);

-- AlterTable
ALTER TABLE "usuario" ADD COLUMN     "sessoes_validas_desde" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Índice funcional: busca e verificação de produto duplicado por lower(nome) dentro da Casa (RF33, RF34).
CREATE INDEX "produto_casa_id_lower_nome_idx" ON "produto" ("casa_id", lower("nome"));

-- Índice único parcial: no máximo uma assinatura vigente (ATIVA ou CANCELADA) por Casa.
CREATE UNIQUE INDEX "assinatura_casa_id_vigente_key" ON "assinatura" ("casa_id") WHERE "status" IN ('ATIVA', 'CANCELADA');
