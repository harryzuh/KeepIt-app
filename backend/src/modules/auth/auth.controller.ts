import type { Request, Response } from 'express';
import { usuarioDaRequisicao } from '../../middlewares/autenticar.js';
import * as service from './auth.service.js';

/** CONTROLLER · lê a requisição (já validada), chama o service e responde. Sem regra de negócio. */

export async function cadastrar(req: Request, res: Response) {
  res.status(201).json(await service.cadastrar(req.body));
}

export async function entrar(req: Request, res: Response) {
  res.json(await service.entrar(req.body));
}

export async function recuperarSenha(req: Request, res: Response) {
  res.json(await service.recuperarSenha(req.body.email));
}

export async function redefinirSenha(req: Request, res: Response) {
  await service.redefinirSenha(req.body);
  res.status(204).end();
}

export async function sair(req: Request, res: Response) {
  const u = usuarioDaRequisicao(req);
  await service.sair(u.id, u.casaId);
  res.status(204).end();
}

export async function obterPerfil(req: Request, res: Response) {
  res.json(await service.obterPerfil(usuarioDaRequisicao(req).id));
}

export async function atualizarPerfil(req: Request, res: Response) {
  res.json(await service.atualizarNome(usuarioDaRequisicao(req).id, req.body.nome));
}

export async function pedirTrocaDeEmail(req: Request, res: Response) {
  res.json(await service.pedirTrocaDeEmail(usuarioDaRequisicao(req).id, req.body));
}

export async function confirmarTrocaDeEmail(req: Request, res: Response) {
  res.json(await service.confirmarTrocaDeEmail(usuarioDaRequisicao(req).id, req.body.codigo));
}

export async function alterarSenha(req: Request, res: Response) {
  res.json(await service.alterarSenha(usuarioDaRequisicao(req).id, req.body));
}

export async function excluirConta(req: Request, res: Response) {
  const u = usuarioDaRequisicao(req);
  await service.solicitarExclusao(u.id, u.casaId, req.body.senha);
  res.status(204).end();
}
