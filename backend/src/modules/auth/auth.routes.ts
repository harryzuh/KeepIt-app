import { Router } from 'express';
import { autenticar } from '../../middlewares/autenticar.js';
import { autorizar, QUALQUER_PAPEL } from '../../middlewares/autorizar.js';
import { limites } from '../../middlewares/limitar.js';
import { validar } from '../../middlewares/validar.js';
import * as c from './auth.controller.js';
import {
  alterarSenhaSchema,
  atualizarPerfilSchema,
  cadastroSchema,
  confirmarEmailSchema,
  excluirContaSchema,
  loginSchema,
  pedirTrocaEmailSchema,
  recuperarSenhaSchema,
  redefinirSenhaSchema,
} from './auth.schema.js';

// CONTROLLER · rotas e middlewares do M1 (ver AGENTS.md e docs/02-arquitetura/2.3-mvc.md)

/** Rotas públicas e logout, montadas em `/auth`. */
export const authRoutes = Router();

authRoutes.post('/cadastro', limites.cadastro, limites.cadastroComErro, validar({ body: cadastroSchema }), c.cadastrar);
authRoutes.post('/login', limites.login, validar({ body: loginSchema }), c.entrar);
authRoutes.post('/recuperar-senha', limites.pedirCodigo, validar({ body: recuperarSenhaSchema }), c.recuperarSenha);
authRoutes.post('/redefinir-senha', limites.conferirCodigo, validar({ body: redefinirSenhaSchema }), c.redefinirSenha);
authRoutes.post('/logout', autenticar, autorizar(...QUALQUER_PAPEL), c.sair);

/** Rotas da conta do usuário logado, montadas em `/me` (valem para ADMIN, EDITOR e LEITOR). */
export const meRoutes = Router();

meRoutes.use(autenticar, autorizar(...QUALQUER_PAPEL));
meRoutes.get('/', c.obterPerfil);
meRoutes.patch('/', validar({ body: atualizarPerfilSchema }), c.atualizarPerfil);
meRoutes.post('/email', limites.pedirTrocaEmail, validar({ body: pedirTrocaEmailSchema }), c.pedirTrocaDeEmail);
meRoutes.post('/email/confirmar', limites.confirmarEmail, validar({ body: confirmarEmailSchema }), c.confirmarTrocaDeEmail);
meRoutes.patch('/senha', limites.alterarSenha, validar({ body: alterarSenhaSchema }), c.alterarSenha);
meRoutes.delete('/', limites.excluirConta, validar({ body: excluirContaSchema }), c.excluirConta);
