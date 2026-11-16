import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';
import { CODIGOS_ERRO, HttpError } from './http-error.js';

export interface DadosToken {
  usuarioId: number;
  /** Instante de emissão (iat) em segundos desde a época. */
  emitidoEm: number;
  /** Instante de emissão em milissegundos (claim `iatMs`; sem ela, `iat` × 1000). Usado no corte de sessões. */
  emitidoEmMs: number;
}

/** Assina o JWT da sessão (HS256, prazo `JWT_EXPIRES_IN`). Só o id do usuário vai no token (claim `sub`). */
export function assinarToken(usuarioId: number): string {
  // `iatMs`: o `iat` padrão só tem precisão de segundo; com ms o corte de sessões é exato (ADR 0001, A1).
  return jwt.sign({ iatMs: Date.now() }, env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: String(usuarioId),
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  });
}

/**
 * Verifica assinatura e prazo. Lança HttpError 401:
 * SESSAO_EXPIRADA (token vencido) ou NAO_AUTENTICADO (malformado/assinatura inválida).
 */
export function verificarToken(token: string): DadosToken {
  try {
    const p = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof p === 'string' || !p.sub || typeof p.iat !== 'number') {
      throw new Error('payload inesperado');
    }
    const usuarioId = Number(p.sub);
    if (!Number.isInteger(usuarioId)) throw new Error('sub inválido');
    const emitidoEmMs = typeof p['iatMs'] === 'number' ? p['iatMs'] : p.iat * 1000;
    return { usuarioId, emitidoEm: p.iat, emitidoEmMs };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new HttpError(401, CODIGOS_ERRO.SESSAO_EXPIRADA, 'Sessão expirada');
    }
    throw new HttpError(401, CODIGOS_ERRO.NAO_AUTENTICADO, 'Token inválido');
  }
}
