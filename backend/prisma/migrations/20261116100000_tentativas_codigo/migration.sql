-- AlterTable: contador de erros por código de verificação (invalidação independente do IP)
ALTER TABLE "codigo_verificacao" ADD COLUMN "tentativas" INTEGER NOT NULL DEFAULT 0;
