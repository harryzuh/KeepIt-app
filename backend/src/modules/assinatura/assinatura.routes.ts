import { Router } from 'express';
import { autenticar } from '../../middlewares/autenticar.js';
import { QUALQUER_PAPEL, SOMENTE_ADMIN, autorizar } from '../../middlewares/autorizar.js';
import { limitar } from '../../middlewares/limitar.js';
import { semCache } from '../../middlewares/sem-cache.js';
import { validar } from '../../middlewares/validar.js';
import * as c from './assinatura.controller.js';
import { assinarSchema, cancelarSchema, metodoPagamentoSchema } from './assinatura.schema.js';

// CONTROLLER · rotas e middlewares do M5 (docs/api/m5-assinatura.md; ADR 0002 D11 e D12).
// Ordem em toda rota: autenticar → autorizar → limite por usuário → validar → controller.
// Cada rota tem o seu limitador (baldes independentes): 10 pedidos por 15 min por usuário.
const limite = () => limitar({ janelaMin: 15, max: 10, porUsuario: true });

/** `/planos` (tela 13): qualquer papel. */
export const planosRoutes = Router();
planosRoutes.use(semCache, autenticar, autorizar(...QUALQUER_PAPEL));
planosRoutes.get('/', c.listarPlanos);

/** `/pagamento` (tela 14): qualquer papel; o método é do próprio usuário. */
export const pagamentoRoutes = Router();
pagamentoRoutes.use(semCache, autenticar, autorizar(...QUALQUER_PAPEL));
pagamentoRoutes.get('/metodo', c.obterMetodo);
pagamentoRoutes.put('/metodo', limite(), validar({ body: metodoPagamentoSchema }), c.salvarMetodo);

/** `/assinaturas` (telas 13, 15 e 24). */
export const assinaturaRoutes = Router();
assinaturaRoutes.use(semCache, autenticar);
assinaturaRoutes.post('/', autorizar(...QUALQUER_PAPEL), limite(), validar({ body: assinarSchema }), c.assinar);
assinaturaRoutes.get('/atual', autorizar(...SOMENTE_ADMIN), c.obterAssinaturaAtual);
assinaturaRoutes.post(
  '/atual/cancelar',
  autorizar(...SOMENTE_ADMIN),
  limite(),
  validar({ body: cancelarSchema }),
  c.cancelar,
);
assinaturaRoutes.post('/atual/reativar', autorizar(...SOMENTE_ADMIN), limite(), c.reativar);
