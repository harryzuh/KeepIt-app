import { Router } from 'express';
import { autenticar } from '../../middlewares/autenticar.js';
import { ADMIN_OU_EDITOR, QUALQUER_PAPEL, autorizar } from '../../middlewares/autorizar.js';
import { limitar } from '../../middlewares/limitar.js';
import { semCache } from '../../middlewares/sem-cache.js';
import { validar } from '../../middlewares/validar.js';
import * as c from './tags.controller.js';
import { criarTagSchema } from './tags.schema.js';

// CONTROLLER · rotas das tags (docs/api/m3-produtos.md, seções 3.1 e 3.2).
// Ordem em toda rota: autenticar → autorizar → limites por usuário → validar → controller.
export const tagsRoutes = Router();
tagsRoutes.use(semCache, autenticar);

tagsRoutes.get('/', autorizar(...QUALQUER_PAPEL), c.listar);
tagsRoutes.post(
  '/',
  autorizar(...ADMIN_OU_EDITOR),
  limitar({ janelaMin: 1, max: 30, porUsuario: true }),
  validar({ body: criarTagSchema }),
  c.criar,
);
