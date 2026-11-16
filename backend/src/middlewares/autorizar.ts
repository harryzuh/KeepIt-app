import type { Papel } from '@prisma/client';
import type { RequestHandler } from 'express';
import { CODIGOS_ERRO, HttpError } from '../lib/http-error.js';

/**
 * Exige que o usuário autenticado tenha um dos papéis informados na Casa dele (RNF31).
 * Use sempre depois de `autenticar`: `router.post('/x', autenticar, autorizar('ADMIN', 'EDITOR'), ...)`.
 * Sem `req.usuario` responde 401; com papel não permitido, 403 SEM_PERMISSAO.
 * Recursos de outra Casa devem responder 404 no service (filtre sempre por `req.usuario.casaId`).
 */
export function autorizar(...papeis: Papel[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.usuario) {
      throw new HttpError(401, CODIGOS_ERRO.NAO_AUTENTICADO, 'Autenticação necessária');
    }
    if (!papeis.includes(req.usuario.papel)) {
      throw new HttpError(403, CODIGOS_ERRO.SEM_PERMISSAO, 'Seu papel não permite esta ação');
    }
    next();
  };
}

/** Atalhos de papéis comuns. */
export const SOMENTE_ADMIN = ['ADMIN'] as const satisfies Papel[];
export const ADMIN_OU_EDITOR = ['ADMIN', 'EDITOR'] as const satisfies Papel[];
export const QUALQUER_PAPEL = ['ADMIN', 'EDITOR', 'LEITOR'] as const satisfies Papel[];
