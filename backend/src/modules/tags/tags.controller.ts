import type { Request, Response } from 'express';
import { usuarioDaRequisicao } from '../../middlewares/autenticar.js';
import * as tags from './tags.service.js';

/** CONTROLLER · lê a requisição (já validada), chama o service e responde. Sem regra de negócio. */

export async function listar(req: Request, res: Response) {
  res.json(await tags.listarTags(usuarioDaRequisicao(req).casaId));
}

export async function criar(req: Request, res: Response) {
  res.status(201).json(await tags.criarTag(usuarioDaRequisicao(req), req.body));
}
