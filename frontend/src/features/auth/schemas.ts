import { z } from 'zod';

// Regras espelham o contrato da API (docs/api/m1-auth.md); a API continua sendo a autoridade.
const email = z.string().trim().min(1, 'Informe o e-mail').max(120, 'E-mail muito longo').email('E-mail inválido');
const senhaNova = z.string().min(8, 'Mínimo de 8 caracteres').max(72, 'Máximo de 72 caracteres');
const confirmar = z.string().min(1, 'Confirme a senha');
const nome = z.string().trim().min(1, 'Informe o nome').max(80, 'Máximo de 80 caracteres');
const codigo = z.string().regex(/^\d{6}$/, 'Informe os 6 dígitos');

const SENHAS_DIFERENTES = { message: 'As senhas não conferem', path: ['confirmarSenha'] };

export const loginSchema = z.object({
  email,
  senha: z.string().min(1, 'Informe a senha').max(72, 'Máximo de 72 caracteres'),
});

export const cadastroSchema = z
  .object({ nome, email, senha: senhaNova, confirmarSenha: confirmar })
  .refine((d) => d.senha === d.confirmarSenha, SENHAS_DIFERENTES);

export const recuperarSenhaSchema = z.object({ email });

export const codigoSchema = z.object({ codigo });

export const novaSenhaSchema = z
  .object({ novaSenha: senhaNova, confirmarSenha: confirmar })
  .refine((d) => d.novaSenha === d.confirmarSenha, SENHAS_DIFERENTES);

export const alterarSenhaSchema = z
  .object({
    senhaAtual: z.string().min(1, 'Informe a senha atual').max(72),
    novaSenha: senhaNova,
    confirmarSenha: confirmar,
  })
  .refine((d) => d.novaSenha === d.confirmarSenha, SENHAS_DIFERENTES)
  .refine((d) => d.novaSenha !== d.senhaAtual, {
    message: 'A nova senha deve ser diferente da atual',
    path: ['novaSenha'],
  });

// senhaAtual só é exigida quando o e-mail muda (validado na tela, que conhece o e-mail atual).
export const dadosCadastraisSchema = z.object({ nome, email, senhaAtual: z.string().max(72).optional() });

export const excluirContaSchema = z.object({ senha: z.string().min(1, 'Informe sua senha').max(72) });

export type LoginForm = z.infer<typeof loginSchema>;
export type CadastroForm = z.infer<typeof cadastroSchema>;
export type NovaSenhaForm = z.infer<typeof novaSenhaSchema>;
export type AlterarSenhaForm = z.infer<typeof alterarSenhaSchema>;
export type DadosCadastraisForm = z.infer<typeof dadosCadastraisSchema>;
