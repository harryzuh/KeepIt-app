import { processarVencimentos, type ResultadoVencimentos } from '../modules/assinatura/vencimento.service.js';
import { apagarContasVencidas } from '../modules/auth/auth.service.js';
import { prisma } from '../lib/prisma.js';
import { apagarObjetos, listarObjetos, VALIDADE_FOTO_PENDENTE_MS } from '../lib/s3.js';

// Rotinas agendadas chamadas a cada hora pelo GitHub Actions (rota protegida /internal/jobs).
/** M5 · RF37 / história 7.5: expira (CANCELADA vencida ou renovação recusada) e renova (ATIVA vencida aprovada). Idempotente. */
export async function expirarAssinaturas(): Promise<ResultadoVencimentos> {
  return processarVencimentos();
}

/** M1 · RNF16 / história 8.3.2: apaga em definitivo as contas com exclusão solicitada há mais de 23 h (rotina horária ⇒ tudo apagado em até 24 h). */
export async function apagarContasExcluidas(): Promise<number> {
  return apagarContasVencidas();
}

/** Tempo máximo de uma execução da conciliação; o que sobrar fica para a hora seguinte (varredura retomada de onde parou). */
const ORCAMENTO_LIMPEZA_MS = 45_000;
/** Onde a última execução parou (por processo); `undefined` recomeça do início de `casas/`. */
let cursorDaVarredura: string | undefined;

export interface ResultadoLimpezaDeFotos {
  /** Objetos órfãos apagados nesta execução. */
  apagadas: number;
  /** Órfãos vencidos que continuam no S3 (falha ao apagar). Se > 0 de forma recorrente, investigar o S3 (métrica). */
  pendentes: number;
}

/**
 * M3 · ADR 0003 (Q4/Q11): concilia o S3 com a tabela Foto. Apaga objeto sem Foto gravada e com mais de 2 h
 * (envio abandonado em `pendentes/`, falha ao apagar antes ou Casa excluída). Idempotente; falha do S3 não derruba as
 * outras rotinas. Tem orçamento de tempo e cursor: se o bucket for grande, cada execução avança um pedaço.
 */
export async function limparFotosOrfas(agora = new Date(), orcamentoMs = ORCAMENTO_LIMPEZA_MS): Promise<ResultadoLimpezaDeFotos> {
  const limite = agora.getTime() - VALIDADE_FOTO_PENDENTE_MS;
  const inicio = Date.now();
  let apagadas = 0;
  let pendentes = 0;
  let continuacao = cursorDaVarredura;
  try {
    do {
      const pagina = await listarObjetos('casas/', continuacao);
      const velhos = pagina.objetos.filter((o) => o.modificadoEm !== undefined && o.modificadoEm.getTime() <= limite);
      if (velhos.length > 0) {
        const gravadas = await prisma.foto.findMany({
          where: { chave: { in: velhos.map((o) => o.chave) } },
          select: { chave: true },
        });
        const usadas = new Set(gravadas.map((f) => f.chave));
        const orfas = velhos.map((o) => o.chave).filter((c) => !usadas.has(c));
        const naoApagadas = await apagarObjetos(orfas);
        apagadas += orfas.length - naoApagadas.length;
        pendentes += naoApagadas.length;
      }
      continuacao = pagina.proxima;
      if (continuacao && Date.now() - inicio > orcamentoMs) break; // retoma daqui na próxima execução
    } while (continuacao);
    cursorDaVarredura = continuacao;
  } catch (err) {
    console.error('Falha na limpeza de fotos órfãs; será reprocessada na próxima execução:', err instanceof Error ? err.message : err);
  }
  return { apagadas, pendentes };
}
