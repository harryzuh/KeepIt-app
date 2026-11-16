import type { Request, Response } from 'express';
import { usuarioDaRequisicao } from '../../middlewares/autenticar.js';
import * as service from './assinatura.service.js';
import * as pagamento from './pagamento.service.js';

/** CONTROLLER · lê a requisição (já validada), chama o service e responde. Sem regra de negócio. */

export async function listarPlanos(req: Request, res: Response) {
  res.json(await service.listarPlanos(usuarioDaRequisicao(req).casaId));
}

export async function obterMetodo(req: Request, res: Response) {
  res.json({ metodo: await pagamento.obterMetodo(usuarioDaRequisicao(req).id) });
}

export async function salvarMetodo(req: Request, res: Response) {
  res.json({ metodo: await pagamento.salvarMetodo(usuarioDaRequisicao(req), req.body) });
}

export async function assinar(req: Request, res: Response) {
  res.status(201).json(await service.assinar(usuarioDaRequisicao(req), req.body));
}

export async function obterAssinaturaAtual(req: Request, res: Response) {
  res.json(await service.obterAssinaturaAtual(usuarioDaRequisicao(req)));
}

export async function cancelar(req: Request, res: Response) {
  res.json(await service.cancelar(usuarioDaRequisicao(req), req.body));
}

export async function reativar(req: Request, res: Response) {
  res.json(await service.reativar(usuarioDaRequisicao(req)));
}
