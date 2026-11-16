import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from './prisma.js';

/** Ações registradas no log (RNF05). Novos módulos acrescentam as suas aqui. */
export const ACOES_AUDITORIA = {
  CONTA_CRIADA: 'CONTA_CRIADA',
  SESSAO_ENCERRADA: 'SESSAO_ENCERRADA',
  SENHA_ALTERADA: 'SENHA_ALTERADA',
  SENHA_REDEFINIDA: 'SENHA_REDEFINIDA',
  EMAIL_ALTERADO: 'EMAIL_ALTERADO',
  EXCLUSAO_SOLICITADA: 'EXCLUSAO_SOLICITADA',
  CONTA_APAGADA: 'CONTA_APAGADA',
  // M5 · plano e assinatura (ADR 0002, D9)
  METODO_PAGAMENTO_ALTERADO: 'METODO_PAGAMENTO_ALTERADO',
  ASSINATURA_CRIADA: 'ASSINATURA_CRIADA',
  PLANO_ALTERADO: 'PLANO_ALTERADO',
  ASSINATURA_CANCELADA: 'ASSINATURA_CANCELADA',
  ASSINATURA_REATIVADA: 'ASSINATURA_REATIVADA',
  ASSINATURA_RENOVADA: 'ASSINATURA_RENOVADA',
  ASSINATURA_EXPIRADA: 'ASSINATURA_EXPIRADA',
  PAGAMENTO_RECUSADO: 'PAGAMENTO_RECUSADO',
  // M2 · Casa e membros
  CASA_CRIADA: 'CASA_CRIADA',
  CASA_RENOMEADA: 'CASA_RENOMEADA',
  CASA_REMOVIDA: 'CASA_REMOVIDA',
  MEMBRO_ADICIONADO: 'MEMBRO_ADICIONADO',
  MEMBRO_REMOVIDO: 'MEMBRO_REMOVIDO',
  MEMBRO_SAIU_DA_CASA: 'MEMBRO_SAIU_DA_CASA',
  MEMBRO_PAPEL_ALTERADO: 'MEMBRO_PAPEL_ALTERADO',
  MEMBRO_PROMOVIDO_ADMIN: 'MEMBRO_PROMOVIDO_ADMIN',
  MEMBRO_ADICAO_NEGADA: 'MEMBRO_ADICAO_NEGADA',
  // M3 · produtos e tags (ADR 0003 D4). Os eventos de produto alimentam o histórico (RF11, tela 07).
  PRODUTO_CRIADO: 'PRODUTO_CRIADO',
  PRODUTO_ALTERADO: 'PRODUTO_ALTERADO',
  PRODUTO_QUANTIDADE_SOMADA: 'PRODUTO_QUANTIDADE_SOMADA',
  PRODUTO_EXCLUIDO: 'PRODUTO_EXCLUIDO',
  TAG_CRIADA: 'TAG_CRIADA',
  /** Controle de envios pendentes (AppSec FD3); não aparece no histórico do produto. */
  FOTO_ENVIO_EMITIDO: 'FOTO_ENVIO_EMITIDO',
} as const;

export interface EntradaAuditoria {
  usuarioId?: number | null;
  casaId?: number | null;
  acao: string;
  /** Nome da entidade afetada (ex.: 'Usuario', 'Assinatura', 'Produto'). */
  entidade: string;
  entidadeId: number;
  /** Dados adicionais (nunca senha, código ou hash). */
  detalhes?: Prisma.InputJsonValue;
}

/**
 * Grava um registro em LogAuditoria. Passe o cliente da transação (`tx`) para que o log
 * seja gravado ou revertido junto com a operação auditada.
 */
export async function registrarAuditoria(
  entrada: EntradaAuditoria,
  db: Prisma.TransactionClient | PrismaClient = prisma,
): Promise<void> {
  await db.logAuditoria.create({
    data: {
      usuarioId: entrada.usuarioId ?? null,
      casaId: entrada.casaId ?? null,
      acao: entrada.acao,
      entidade: entrada.entidade,
      entidadeId: entrada.entidadeId,
      detalhes: entrada.detalhes,
    },
  });
}
