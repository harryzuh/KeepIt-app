import type { Request, Response } from 'express';
import { usuarioDaRequisicao } from '../../middlewares/autenticar.js';
import * as casa from './casa.service.js';
import * as membros from './membros.service.js';

/** CONTROLLER · lê a requisição (já validada), chama o service e responde. Sem regra de negócio. */

export async function listarMembros(req: Request, res: Response) {
  const u = usuarioDaRequisicao(req);
  res.json(await membros.listarMembros(u.casaId, u.papel));
}

export async function adicionarMembro(req: Request, res: Response) {
  res.status(201).json(await membros.adicionarMembro(usuarioDaRequisicao(req), req.body));
}

export async function alterarPapel(req: Request, res: Response) {
  res.json(await membros.alterarPapel(usuarioDaRequisicao(req), Number(req.params.usuarioId), req.body));
}

export async function removerMembro(req: Request, res: Response) {
  await membros.removerMembro(usuarioDaRequisicao(req), Number(req.params.usuarioId));
  res.status(204).end();
}

export async function renomearCasa(req: Request, res: Response) {
  res.json(await casa.renomearCasa(usuarioDaRequisicao(req), req.body));
}

export async function sairDaCasa(req: Request, res: Response) {
  res.json(await membros.sairDaCasa(usuarioDaRequisicao(req)));
}
