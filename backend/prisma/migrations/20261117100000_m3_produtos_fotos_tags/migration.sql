-- M3 · Produtos e Tags (ADR 0003 D1, D2, D5). Antes do M3 nenhum código gravava foto, produto ou tag;
-- mesmo assim a troca de `url` por `chave` preserva linhas existentes.

-- CreateEnum
CREATE TYPE "TipoImagem" AS ENUM ('JPEG', 'PNG');

-- Foto: guarda a chave do objeto no S3 (a URL de leitura é assinada a cada resposta) e o tipo real.
ALTER TABLE "foto"
  ADD COLUMN "chave" TEXT,
  ADD COLUMN "criada_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "tipo" "TipoImagem" NOT NULL DEFAULT 'JPEG';
UPDATE "foto" SET "chave" = "url" WHERE "chave" IS NULL;
ALTER TABLE "foto" ALTER COLUMN "chave" SET NOT NULL, ALTER COLUMN "tipo" DROP DEFAULT, DROP COLUMN "url";
CREATE UNIQUE INDEX "foto_chave_key" ON "foto"("chave");

-- Produto: data da última alteração (tela 07).
ALTER TABLE "produto" ADD COLUMN "atualizado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Histórico de um produto (tela 07): eventos em log_auditoria por entidade.
CREATE INDEX "log_auditoria_entidade_entidade_id_criado_em_idx" ON "log_auditoria"("entidade", "entidade_id", "criado_em");

-- Tag única por Casa SEM diferenciar caixa (RF35): "Cozinha" e "cozinha" são a mesma tag.
-- O @@unique([casa_id, nome]) do Prisma continua valendo (exato); este índice é a regra de negócio.
CREATE UNIQUE INDEX "tag_casa_id_lower_nome_key" ON "tag" ("casa_id", lower("nome"));

-- O índice "produto_casa_id_lower_nome_idx" (casa_id, lower(nome)) da migration base_m1 já atende a busca e a duplicidade.
