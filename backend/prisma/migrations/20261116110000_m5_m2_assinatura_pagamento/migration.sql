-- CreateEnum
CREATE TYPE "MotivoEncerramento" AS ENUM ('CANCELAMENTO', 'RECUSA', 'TROCA', 'TITULAR_EXCLUIDO');

-- CreateEnum
CREATE TYPE "MarcaCartao" AS ENUM ('VISA', 'MASTERCARD', 'AMEX', 'ELO', 'OUTRA');

-- DropForeignKey
ALTER TABLE "assinatura" DROP CONSTRAINT "assinatura_titular_id_fkey";

-- AlterTable
ALTER TABLE "assinatura" ADD COLUMN     "encerrada_em" TIMESTAMPTZ,
ADD COLUMN     "motivo_encerramento" "MotivoEncerramento",
ALTER COLUMN "titular_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "metodo_pagamento" (
    "id" SERIAL NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "marca" "MarcaCartao" NOT NULL,
    "ultimos4" CHAR(4) NOT NULL,
    "atualizado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metodo_pagamento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "metodo_pagamento_usuario_id_key" ON "metodo_pagamento"("usuario_id");

-- CreateIndex
CREATE INDEX "assinatura_status_data_renovacao_idx" ON "assinatura"("status", "data_renovacao");

-- AddForeignKey
ALTER TABLE "assinatura" ADD CONSTRAINT "assinatura_titular_id_fkey" FOREIGN KEY ("titular_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metodo_pagamento" ADD CONSTRAINT "metodo_pagamento_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
