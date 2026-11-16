import { Router } from 'express';
import { autenticar } from '../../middlewares/autenticar.js';
import { QUALQUER_PAPEL, SOMENTE_ADMIN, autorizar } from '../../middlewares/autorizar.js';
import { limitar } from '../../middlewares/limitar.js';
import { semCache } from '../../middlewares/sem-cache.js';
import { validar } from '../../middlewares/validar.js';
import * as c from './casa.controller.js';
import { adicionarMembroSchema, alterarPapelSchema, membroParamsSchema, renomearCasaSchema } from './casa.schema.js';

// CONTROLLER · rotas e middlewares do M2 (docs/api/m2-casa.md; ADR 0002 D11 e D12).
// Ordem em toda rota: autenticar → autorizar → limites por usuário → validar → controller.
export const casaRoutes = Router();
casaRoutes.use(semCache, autenticar);

casaRoutes.get('/membros', autorizar(...QUALQUER_PAPEL), c.listarMembros);

// POST /casa/membros revela se um e-mail tem conta (UC033): 20 pedidos por hora e 5 erros (404/409) por 15 min,
// por usuário. O limite de erros vem DEPOIS do `validar`, então os 422 (corpo inválido) não o consomem.
casaRoutes.post(
  '/membros',
  autorizar(...SOMENTE_ADMIN),
  limitar({ janelaMin: 60, max: 20, porUsuario: true }),
  validar({ body: adicionarMembroSchema }),
  limitar({ janelaMin: 15, max: 5, soErros: true, porUsuario: true }),
  // Conta também os 201: no máximo 10 tentativas (certas ou erradas) por 15 min, por usuário.
  limitar({ janelaMin: 15, max: 10, porUsuario: true }),
  c.adicionarMembro,
);
casaRoutes.patch(
  '/membros/:usuarioId',
  autorizar(...SOMENTE_ADMIN),
  validar({ params: membroParamsSchema, body: alterarPapelSchema }),
  c.alterarPapel,
);
casaRoutes.delete('/membros/:usuarioId', autorizar(...SOMENTE_ADMIN), validar({ params: membroParamsSchema }), c.removerMembro);

casaRoutes.patch('/', autorizar(...SOMENTE_ADMIN), validar({ body: renomearCasaSchema }), c.renomearCasa);

// EDITOR e LEITOR saem da Casa por conta própria (o ADMIN não: ele não pode deixar a Casa sem ADMIN).
casaRoutes.post('/sair', autorizar('EDITOR', 'LEITOR'), limitar({ janelaMin: 15, max: 10, porUsuario: true }), c.sairDaCasa);
