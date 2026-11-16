import { Router } from 'express';
import { autenticar } from '../../middlewares/autenticar.js';
import { QUALQUER_PAPEL, autorizar } from '../../middlewares/autorizar.js';
import { semCache } from '../../middlewares/sem-cache.js';
import * as c from './estatisticas.controller.js';

// CONTROLLER · rotas do M4 (docs/api/m4-estatisticas.md, seção 3). Só leitura, sem entrada, só o limite global.
// Ordem: autenticar → autorizar → controller. Não há `validar`: o contrato não tem corpo, caminho nem query.
export const estatisticasRoutes = Router();
estatisticasRoutes.use(semCache, autenticar);

estatisticasRoutes.get('/resumo', autorizar(...QUALQUER_PAPEL), c.resumo);
estatisticasRoutes.get('/', autorizar(...QUALQUER_PAPEL), c.completa);
