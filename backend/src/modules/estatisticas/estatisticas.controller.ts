import type { Request, Response } from 'express';
import { usuarioDaRequisicao } from '../../middlewares/autenticar.js';
import * as estatisticas from './estatisticas.service.js';

/** CONTROLLER · a Casa vem SEMPRE do token (nunca de parâmetro). Sem regra de negócio. */

export async function resumo(req: Request, res: Response) {
  res.json(await estatisticas.obterResumo(usuarioDaRequisicao(req).casaId));
}

export async function completa(req: Request, res: Response) {
  res.json(await estatisticas.obterEstatisticas(usuarioDaRequisicao(req).casaId));
}
