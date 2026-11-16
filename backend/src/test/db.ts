import { PLANOS_PADRAO } from '../lib/planos.js';
import { prisma } from '../lib/prisma.js';

/** Apaga todos os dados do schema de teste e recria o catálogo de planos. Use em `beforeEach`/`beforeAll`. */
export async function limparBanco(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "log_auditoria","codigo_verificacao","produto_tag","foto","produto","tag","assinatura","metodo_pagamento","membro","casa","usuario","plano" RESTART IDENTITY CASCADE`,
  );
  await prisma.plano.createMany({ data: PLANOS_PADRAO.map((p) => ({ ...p })) });
}

/** Cria usuário + Casa + vínculo de membro direto no banco (atalho para testes de outros módulos). */
export async function criarUsuarioComCasa(opcoes?: {
  nome?: string;
  email?: string;
  senhaHash?: string;
  papel?: 'ADMIN' | 'EDITOR' | 'LEITOR';
  casaId?: number;
}) {
  const nome = opcoes?.nome ?? 'Usuário Teste';
  const usuario = await prisma.usuario.create({
    data: {
      nome,
      email: opcoes?.email ?? `teste${Date.now()}${Math.floor(Math.random() * 1e6)}@keepit.test`,
      senhaHash: opcoes?.senhaHash ?? 'hash-de-teste',
    },
  });
  const casaId =
    opcoes?.casaId ?? (await prisma.casa.create({ data: { nome: `Casa de ${nome.split(' ')[0]}` } })).id;
  await prisma.membro.create({
    data: { usuarioId: usuario.id, casaId, papel: opcoes?.papel ?? 'ADMIN' },
  });
  return { usuario, casaId };
}
