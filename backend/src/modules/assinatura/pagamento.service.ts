import type { MetodoPagamento } from '@prisma/client';
import { ACOES_AUDITORIA, registrarAuditoria } from '../../lib/auditoria.js';
import { prisma } from '../../lib/prisma.js';
import type { UsuarioAutenticado } from '../../middlewares/autenticar.js';
import type { MetodoPagamentoDto } from './assinatura.schema.js';
import { detectarMarca, exigirGatewaySimulado } from './gateway-simulado.js';

/** MODEL · método de pagamento simulado do usuário (RF15, RNF04, ADR 0002 D4). Só marca e 4 últimos dígitos. */

export interface MetodoPagamentoResposta {
  marca: MetodoPagamento['marca'];
  ultimos4: string;
  atualizadoEm: string;
}

export function paraMetodoResposta(m: MetodoPagamento): MetodoPagamentoResposta {
  return { marca: m.marca, ultimos4: m.ultimos4, atualizadoEm: m.atualizadoEm.toISOString() };
}

export async function obterMetodo(usuarioId: number): Promise<MetodoPagamentoResposta | null> {
  const m = await prisma.metodoPagamento.findUnique({ where: { usuarioId } });
  return m ? paraMetodoResposta(m) : null;
}

/**
 * Cadastra ou troca o método (um por usuário). Número completo e validade são descartados aqui (nome e CVV nem são coletados):
 * nada além de marca e 4 últimos dígitos é gravado, logado ou devolvido.
 */
export async function salvarMetodo(usuario: UsuarioAutenticado, dto: MetodoPagamentoDto): Promise<MetodoPagamentoResposta> {
  exigirGatewaySimulado();
  const marca = detectarMarca(dto.numero);
  const ultimos4 = dto.numero.slice(-4);
  const agora = new Date();
  const metodo = await prisma.$transaction(async (tx) => {
    const salvo = await tx.metodoPagamento.upsert({
      where: { usuarioId: usuario.id },
      create: { usuarioId: usuario.id, marca, ultimos4, atualizadoEm: agora },
      update: { marca, ultimos4, atualizadoEm: agora },
    });
    await registrarAuditoria(
      {
        usuarioId: usuario.id,
        casaId: usuario.casaId,
        acao: ACOES_AUDITORIA.METODO_PAGAMENTO_ALTERADO,
        entidade: 'MetodoPagamento',
        entidadeId: salvo.id,
        detalhes: { marca, ultimos4 },
      },
      tx,
    );
    return salvo;
  });
  return paraMetodoResposta(metodo);
}
