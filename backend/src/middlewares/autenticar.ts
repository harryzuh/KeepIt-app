import type { Papel } from '@prisma/client';
import type { Request, RequestHandler } from 'express';
import { CODIGOS_ERRO, HttpError } from '../lib/http-error.js';
import { verificarToken } from '../lib/jwt.js';
import { prisma } from '../lib/prisma.js';

/** Usuário autenticado carregado do banco a cada requisição (`req.usuario`). */
export interface UsuarioAutenticado {
  id: number;
  /** Casa do usuário (cada usuário participa de uma Casa por vez). */
  casaId: number;
  papel: Papel;
}

declare module 'express-serve-static-core' {
  interface Request {
    usuario?: UsuarioAutenticado;
  }
}

/** Devolve `req.usuario` ou lança 401. Use nos controllers de rotas atrás de `autenticar`. */
export function usuarioDaRequisicao(req: Request): UsuarioAutenticado {
  if (!req.usuario) {
    throw new HttpError(401, CODIGOS_ERRO.NAO_AUTENTICADO, 'Autenticação necessária');
  }
  return req.usuario;
}

/**
 * Exige `Authorization: Bearer <jwt>`. Valida assinatura e prazo, confere no banco que o usuário
 * existe, não pediu exclusão e que o token não foi emitido antes de `sessoesValidasDesde`
 * (logout, troca de senha, exclusão: ADR 0001), e preenche `req.usuario` com id, Casa e papel.
 * Respostas: 401 NAO_AUTENTICADO ou 401 SESSAO_EXPIRADA; 403 SEM_PERMISSAO se não houver Casa.
 */
export const autenticar: RequestHandler = async (req, _res, next) => {
  const [esquema, token] = (req.header('authorization') ?? '').split(' ');
  if (esquema !== 'Bearer' || !token) {
    throw new HttpError(401, CODIGOS_ERRO.NAO_AUTENTICADO, 'Token ausente');
  }
  const { usuarioId, emitidoEmMs } = verificarToken(token);

  const usuario = await prisma.usuario.findUnique({
    where: { id: usuarioId },
    select: {
      sessoesValidasDesde: true,
      exclusaoSolicitadaEm: true,
      membro: { select: { casaId: true, papel: true } },
    },
  });
  // Compara em milissegundos: token emitido depois do corte vale, inclusive no mesmo segundo do logout.
  if (
    !usuario ||
    usuario.exclusaoSolicitadaEm ||
    emitidoEmMs < usuario.sessoesValidasDesde.getTime()
  ) {
    throw new HttpError(401, CODIGOS_ERRO.SESSAO_EXPIRADA, 'Sessão encerrada');
  }
  if (!usuario.membro) {
    throw new HttpError(403, CODIGOS_ERRO.SEM_PERMISSAO, 'Usuário sem Casa');
  }
  req.usuario = { id: usuarioId, casaId: usuario.membro.casaId, papel: usuario.membro.papel };
  next();
};
