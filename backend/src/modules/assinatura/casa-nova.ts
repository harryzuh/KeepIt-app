import type { Casa, Prisma } from '@prisma/client';
import { criarCasaIndividual } from '../casa/casa.service.js';

/**
 * MODEL · Tira o usuário da Casa de origem e o torna ADMIN de uma Casa Individual nova (ADR 0002, D7).
 * Os produtos que ele cadastrou ficam na Casa de origem, sem autor (decisão 21 do PO).
 * Roda dentro da transação de quem chama (assinar como membro, expiração).
 */
export async function moverParaCasaNova(
  tx: Prisma.TransactionClient,
  usuario: { id: number; nome: string },
  casaOrigemId: number,
): Promise<Casa> {
  await tx.membro.delete({ where: { usuarioId: usuario.id } });
  await tx.produto.updateMany({
    where: { casaId: casaOrigemId, adicionadoPorId: usuario.id },
    data: { adicionadoPorId: null },
  });
  return criarCasaIndividual(tx, usuario.id, usuario.nome);
}
