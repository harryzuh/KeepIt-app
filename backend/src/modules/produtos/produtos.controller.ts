import type { Request, Response } from 'express';
import { usuarioDaRequisicao } from '../../middlewares/autenticar.js';
import { gerarUrlDeEnvio } from './fotos.service.js';
import { listarHistorico } from './historico.service.js';
import * as produtos from './produtos.service.js';

/** CONTROLLER · lê a requisição (já validada), chama o service e responde. Sem regra de negócio. */

const idDaRota = (req: Request) => Number(req.params.id);

export async function gerarUrlDeUpload(req: Request, res: Response) {
  res.json(await gerarUrlDeEnvio(usuarioDaRequisicao(req), req.body));
}

export async function criar(req: Request, res: Response) {
  const { status, corpo } = await produtos.criarProduto(usuarioDaRequisicao(req), req.body);
  res.status(status).json(corpo);
}

export async function listar(req: Request, res: Response) {
  res.json(await produtos.listarProdutos(usuarioDaRequisicao(req).casaId, req.query as never));
}

export async function obter(req: Request, res: Response) {
  res.json(await produtos.obterProduto(usuarioDaRequisicao(req).casaId, idDaRota(req)));
}

export async function editar(req: Request, res: Response) {
  res.json(await produtos.editarProduto(usuarioDaRequisicao(req), idDaRota(req), req.body));
}

export async function excluir(req: Request, res: Response) {
  await produtos.excluirProduto(usuarioDaRequisicao(req), idDaRota(req));
  res.status(204).end();
}

export async function historico(req: Request, res: Response) {
  res.json(await listarHistorico(usuarioDaRequisicao(req).casaId, idDaRota(req), req.query as never));
}
