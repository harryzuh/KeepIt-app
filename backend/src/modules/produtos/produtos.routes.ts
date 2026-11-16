import { Router } from 'express';
import { autenticar } from '../../middlewares/autenticar.js';
import { ADMIN_OU_EDITOR, QUALQUER_PAPEL, autorizar } from '../../middlewares/autorizar.js';
import { limitar } from '../../middlewares/limitar.js';
import { semCache } from '../../middlewares/sem-cache.js';
import { validar } from '../../middlewares/validar.js';
import * as c from './produtos.controller.js';
import {
  criarProdutoSchema,
  editarProdutoSchema,
  historicoQuerySchema,
  listarProdutosQuerySchema,
  produtoParamsSchema,
  uploadUrlSchema,
} from './produtos.schema.js';

// CONTROLLER · rotas do módulo produtos (docs/api/m3-produtos.md, seções 3.3 a 3.9).
// Ordem em toda rota: autenticar → autorizar → limites por usuário → validar → controller.
export const produtosRoutes = Router();
// As respostas trazem URLs assinadas: nunca ficam em cache.
produtosRoutes.use(semCache, autenticar);

produtosRoutes.post(
  '/fotos/upload-url',
  autorizar(...ADMIN_OU_EDITOR),
  limitar({ janelaMin: 1, max: 30, porUsuario: true }),
  validar({ body: uploadUrlSchema }),
  c.gerarUrlDeUpload,
);
produtosRoutes.post(
  '/',
  autorizar(...ADMIN_OU_EDITOR),
  limitar({ janelaMin: 1, max: 60, porUsuario: true }),
  validar({ body: criarProdutoSchema }),
  c.criar,
);
produtosRoutes.get('/', autorizar(...QUALQUER_PAPEL), validar({ query: listarProdutosQuerySchema }), c.listar);
produtosRoutes.get('/:id', autorizar(...QUALQUER_PAPEL), validar({ params: produtoParamsSchema }), c.obter);
produtosRoutes.get(
  '/:id/historico',
  autorizar(...QUALQUER_PAPEL),
  validar({ params: produtoParamsSchema, query: historicoQuerySchema }),
  c.historico,
);
produtosRoutes.patch(
  '/:id',
  autorizar(...ADMIN_OU_EDITOR),
  limitar({ janelaMin: 1, max: 60, porUsuario: true }),
  validar({ params: produtoParamsSchema, body: editarProdutoSchema }),
  c.editar,
);
produtosRoutes.delete(
  '/:id',
  autorizar(...ADMIN_OU_EDITOR),
  limitar({ janelaMin: 1, max: 60, porUsuario: true }),
  validar({ params: produtoParamsSchema }),
  c.excluir,
);
