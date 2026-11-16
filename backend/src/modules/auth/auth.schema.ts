import { z } from 'zod';
import {
  codigoSchema,
  emailSchema,
  exigirConfirmacao,
  nomeSchema,
  senhaInformadaSchema,
  senhaSchema,
} from '../../lib/campos.js';

/** CONTRATO · schemas Zod do M1 (docs/api/m1-auth.md). O front-end se baseia nestes campos. */

const confirmarSenhaSchema = z.string({ error: 'Confirme a senha' });

export const cadastroSchema = exigirConfirmacao(
  z.object({
    nome: nomeSchema,
    email: emailSchema,
    senha: senhaSchema,
    confirmarSenha: confirmarSenhaSchema,
  }),
  'senha',
);

export const loginSchema = z.object({
  email: emailSchema,
  senha: senhaInformadaSchema,
});

export const recuperarSenhaSchema = z.object({ email: emailSchema });

export const redefinirSenhaSchema = exigirConfirmacao(
  z.object({
    email: emailSchema,
    codigo: codigoSchema,
    novaSenha: senhaSchema,
    confirmarSenha: confirmarSenhaSchema,
  }),
  'novaSenha',
);

export const atualizarPerfilSchema = z.object({ nome: nomeSchema });

/** Troca de e-mail exige reautenticação com a senha atual (AppSec F3). */
export const pedirTrocaEmailSchema = z.object({ email: emailSchema, senhaAtual: senhaInformadaSchema });

export const confirmarEmailSchema = z.object({ codigo: codigoSchema });

export const alterarSenhaSchema = exigirConfirmacao(
  z.object({
    senhaAtual: senhaInformadaSchema,
    novaSenha: senhaSchema,
    confirmarSenha: confirmarSenhaSchema,
  }),
  'novaSenha',
);

export const excluirContaSchema = z.object({ senha: senhaInformadaSchema });

export type PedirTrocaEmailDto = z.infer<typeof pedirTrocaEmailSchema>;
export type CadastroDto = z.infer<typeof cadastroSchema>;
export type LoginDto = z.infer<typeof loginSchema>;
export type RedefinirSenhaDto = z.infer<typeof redefinirSenhaSchema>;
export type AlterarSenhaDto = z.infer<typeof alterarSenhaSchema>;
