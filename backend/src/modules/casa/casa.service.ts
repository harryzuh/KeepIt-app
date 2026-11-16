import type { Casa, Prisma } from '@prisma/client';
import { ACOES_AUDITORIA, registrarAuditoria } from '../../lib/auditoria.js';
import { CODIGOS_ERRO, HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import type { UsuarioAutenticado } from '../../middlewares/autenticar.js';
import type { RenomearCasaDto } from './casa.schema.js';

/**
 * MODEL · Casa (cadastro, RF32, e renomear). Membros e papéis ficam em `membros.service.ts`.
 */

/** Primeiro nome do usuário, usado no nome da Casa ("Casa de <primeiro nome>"). */
export function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome.trim();
}

/**
 * Cria a Casa Individual do usuário e o vincula como ADMIN (RF32).
 * Recebe o cliente da transação do cadastro: se algo falhar, nada é gravado (RNF27).
 * Não cria Assinatura: o plano Individual é o plano da Casa sem assinatura vigente.
 */
export async function criarCasaIndividual(
  tx: Prisma.TransactionClient,
  usuarioId: number,
  nomeUsuario: string,
): Promise<Casa> {
  const casa = await tx.casa.create({
    data: { nome: `Casa de ${primeiroNome(nomeUsuario)}`.slice(0, 80) },
  });
  await tx.membro.create({ data: { usuarioId, casaId: casa.id, papel: 'ADMIN' } });
  return casa;
}

/** RF32 / RNF05: o ADMIN renomeia a Casa. Mesmo nome: devolve sem alterar e sem log. */
export async function renomearCasa(
  admin: UsuarioAutenticado,
  dto: RenomearCasaDto,
): Promise<{ casa: { id: number; nome: string } }> {
  return prisma.$transaction(async (tx) => {
    await travarCasa(tx, admin.casaId);
    await exigirAdminAtual(tx, admin);
    const casa = await tx.casa.findUniqueOrThrow({ where: { id: admin.casaId } });
    if (casa.nome === dto.nome) return { casa: { id: casa.id, nome: casa.nome } };
    const nova = await tx.casa.update({ where: { id: casa.id }, data: { nome: dto.nome } });
    await registrarAuditoria(
      {
        usuarioId: admin.id,
        casaId: casa.id,
        acao: ACOES_AUDITORIA.CASA_RENOMEADA,
        entidade: 'Casa',
        entidadeId: casa.id,
        detalhes: { de: casa.nome, para: nova.nome },
      },
      tx,
    );
    return { casa: { id: nova.id, nome: nova.nome } };
  });
}

/** Trava a Casa (`SELECT ... FOR UPDATE`): serializa mudanças de membros, papéis e nome (ADR 0002 D5). */
export async function travarCasa(tx: Prisma.TransactionClient, casaId: number): Promise<void> {
  await tx.$queryRaw`SELECT id FROM casa WHERE id = ${casaId} FOR UPDATE`;
}

/**
 * Depois de travar a Casa, reconfere que quem pede ainda é o ADMIN dela: o token já foi lido do banco,
 * mas um pedido simultâneo pode ter mudado o vínculo nesse intervalo.
 */
export async function exigirAdminAtual(tx: Prisma.TransactionClient, admin: UsuarioAutenticado): Promise<void> {
  const membro = await tx.membro.findUnique({ where: { usuarioId: admin.id } });
  if (!membro || membro.casaId !== admin.casaId || membro.papel !== 'ADMIN') {
    throw new HttpError(403, CODIGOS_ERRO.SEM_PERMISSAO, 'Seu papel não permite esta ação');
  }
}
