-- CreateEnum
CREATE TYPE "NomePlano" AS ENUM ('INDIVIDUAL', 'FAMILIA', 'BUSINESS');

-- CreateEnum
CREATE TYPE "Papel" AS ENUM ('ADMIN', 'EDITOR', 'LEITOR');

-- CreateEnum
CREATE TYPE "StatusAssinatura" AS ENUM ('PENDENTE', 'ATIVA', 'CANCELADA', 'EXPIRADA');

-- CreateEnum
CREATE TYPE "FinalidadeCodigo" AS ENUM ('RECUPERAR_SENHA', 'ALTERAR_EMAIL');

-- CreateTable
CREATE TABLE "usuario" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(80) NOT NULL,
    "email" VARCHAR(120) NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exclusao_solicitada_em" TIMESTAMPTZ,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "casa" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(80) NOT NULL,
    "criada_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "casa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membro" (
    "id" SERIAL NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "casa_id" INTEGER NOT NULL,
    "papel" "Papel" NOT NULL,
    "entrou_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plano" (
    "id" SERIAL NOT NULL,
    "nome" "NomePlano" NOT NULL,
    "preco" DECIMAL(10,2) NOT NULL,
    "limite_membros" INTEGER NOT NULL,
    "limite_armazenamento_gb" INTEGER NOT NULL,

    CONSTRAINT "plano_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assinatura" (
    "id" SERIAL NOT NULL,
    "casa_id" INTEGER NOT NULL,
    "plano_id" INTEGER NOT NULL,
    "titular_id" INTEGER NOT NULL,
    "status" "StatusAssinatura" NOT NULL DEFAULT 'PENDENTE',
    "data_inicio" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data_renovacao" TIMESTAMPTZ NOT NULL,
    "data_cancelamento" TIMESTAMPTZ,
    "ref_pagamento" TEXT,

    CONSTRAINT "assinatura_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produto" (
    "id" SERIAL NOT NULL,
    "casa_id" INTEGER NOT NULL,
    "adicionado_por_id" INTEGER,
    "nome" VARCHAR(120) NOT NULL,
    "descricao" TEXT,
    "preco" DECIMAL(12,2) NOT NULL,
    "quantidade" INTEGER NOT NULL DEFAULT 1,
    "data_compra" DATE NOT NULL,
    "data_cadastro" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "produto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "foto" (
    "id" SERIAL NOT NULL,
    "produto_id" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "tamanho_bytes" INTEGER NOT NULL,
    "ordem" SMALLINT NOT NULL,

    CONSTRAINT "foto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tag" (
    "id" SERIAL NOT NULL,
    "casa_id" INTEGER NOT NULL,
    "nome" VARCHAR(40) NOT NULL,

    CONSTRAINT "tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produto_tag" (
    "produto_id" INTEGER NOT NULL,
    "tag_id" INTEGER NOT NULL,

    CONSTRAINT "produto_tag_pkey" PRIMARY KEY ("produto_id","tag_id")
);

-- CreateTable
CREATE TABLE "codigo_verificacao" (
    "id" SERIAL NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "codigo_hash" TEXT NOT NULL,
    "finalidade" "FinalidadeCodigo" NOT NULL,
    "expira_em" TIMESTAMPTZ NOT NULL,
    "usado_em" TIMESTAMPTZ,

    CONSTRAINT "codigo_verificacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_auditoria" (
    "id" BIGSERIAL NOT NULL,
    "usuario_id" INTEGER,
    "casa_id" INTEGER,
    "acao" TEXT NOT NULL,
    "entidade" TEXT NOT NULL,
    "entidade_id" INTEGER NOT NULL,
    "detalhes" JSONB,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuario_email_key" ON "usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "membro_usuario_id_key" ON "membro"("usuario_id");

-- CreateIndex
CREATE INDEX "membro_casa_id_idx" ON "membro"("casa_id");

-- CreateIndex
CREATE UNIQUE INDEX "plano_nome_key" ON "plano"("nome");

-- CreateIndex
CREATE INDEX "assinatura_casa_id_status_idx" ON "assinatura"("casa_id", "status");

-- CreateIndex
CREATE INDEX "produto_casa_id_nome_idx" ON "produto"("casa_id", "nome");

-- CreateIndex
CREATE INDEX "foto_produto_id_idx" ON "foto"("produto_id");

-- CreateIndex
CREATE UNIQUE INDEX "tag_casa_id_nome_key" ON "tag"("casa_id", "nome");

-- CreateIndex
CREATE INDEX "codigo_verificacao_usuario_id_idx" ON "codigo_verificacao"("usuario_id");

-- CreateIndex
CREATE INDEX "log_auditoria_casa_id_criado_em_idx" ON "log_auditoria"("casa_id", "criado_em");

-- AddForeignKey
ALTER TABLE "membro" ADD CONSTRAINT "membro_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membro" ADD CONSTRAINT "membro_casa_id_fkey" FOREIGN KEY ("casa_id") REFERENCES "casa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assinatura" ADD CONSTRAINT "assinatura_casa_id_fkey" FOREIGN KEY ("casa_id") REFERENCES "casa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assinatura" ADD CONSTRAINT "assinatura_plano_id_fkey" FOREIGN KEY ("plano_id") REFERENCES "plano"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assinatura" ADD CONSTRAINT "assinatura_titular_id_fkey" FOREIGN KEY ("titular_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produto" ADD CONSTRAINT "produto_casa_id_fkey" FOREIGN KEY ("casa_id") REFERENCES "casa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produto" ADD CONSTRAINT "produto_adicionado_por_id_fkey" FOREIGN KEY ("adicionado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "foto" ADD CONSTRAINT "foto_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag" ADD CONSTRAINT "tag_casa_id_fkey" FOREIGN KEY ("casa_id") REFERENCES "casa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produto_tag" ADD CONSTRAINT "produto_tag_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produto_tag" ADD CONSTRAINT "produto_tag_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "codigo_verificacao" ADD CONSTRAINT "codigo_verificacao_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_auditoria" ADD CONSTRAINT "log_auditoria_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_auditoria" ADD CONSTRAINT "log_auditoria_casa_id_fkey" FOREIGN KEY ("casa_id") REFERENCES "casa"("id") ON DELETE SET NULL ON UPDATE CASCADE;
