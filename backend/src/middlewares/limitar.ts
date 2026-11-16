import type { Request } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { env } from '../config/env.js';
import { CODIGOS_ERRO } from '../lib/http-error.js';

// RNF14 / ADR 0001 (A5). Em NODE_ENV=test o limite é desligado, exceto com TESTAR_RATE_LIMIT=1.
// RATE_LIMIT_DESLIGADO=true (dev/E2E; recusado em produção pelo env.ts) desliga em qualquer ambiente.
// Nos testes quem manda é TESTAR_RATE_LIMIT (assim o RATE_LIMIT_DESLIGADO do compose não desliga os testes de limite).
const desligado = () =>
  env.NODE_ENV === 'test' ? process.env.TESTAR_RATE_LIMIT !== '1' : env.RATE_LIMIT_DESLIGADO;

/** IPv6: todo o prefixo /64 divide a mesma cota (um cliente controla um /64 inteiro). */
const PREFIXO_IPV6 = 64;

interface Opcoes {
  /** Janela em minutos. */
  janelaMin: number;
  /** Máximo de requisições por chave na janela. */
  max: number;
  /** Só conta requisições que terminaram em erro (>= 400): bom para login. */
  soErros?: boolean;
  /** Só conta requisições bem-sucedidas (< 400): erros de digitação não gastam a cota. */
  soSucessos?: boolean;
  /** Acrescenta o e-mail do corpo à chave (limita por IP + e-mail). */
  porEmail?: boolean;
  /** Rotas autenticadas: a chave é o usuário (`req.usuario.id`), não o IP. */
  porUsuario?: boolean;
}

/**
 * Cria um limitador que responde 429 `{ error: 'MUITAS_TENTATIVAS' }` com cabeçalho Retry-After.
 * Cada chamada cria um contador próprio: use um limitador por rota para os baldes serem independentes.
 */
export function limitar({
  janelaMin,
  max,
  soErros = false,
  soSucessos = false,
  porEmail = false,
  porUsuario = false,
}: Opcoes) {
  return rateLimit({
    windowMs: janelaMin * 60_000,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: desligado,
    skipSuccessfulRequests: soErros,
    skipFailedRequests: soSucessos,
    keyGenerator: (req: Request) => {
      if (porUsuario && req.usuario) return `u:${req.usuario.id}`;
      const ip = ipKeyGenerator(req.ip ?? 'ip-desconhecido', PREFIXO_IPV6);
      if (!porEmail) return ip;
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      return `${ip}|${email}`;
    },
    handler: (_req, res) => {
      res.status(429).json({
        error: CODIGOS_ERRO.MUITAS_TENTATIVAS,
        message: 'Muitas tentativas. Tente novamente em alguns minutos',
      });
    },
  });
}

/**
 * Limites das rotas públicas de /auth e das rotas sensíveis de /me (valores da ADR 0001).
 * Cada rota tem o seu limitador (baldes independentes).
 */
export const limites = {
  /** Cadastro: 10 criações por hora por IP (só conta cadastros bem-sucedidos). */
  cadastro: limitar({ janelaMin: 60, max: 10, soSucessos: true }),
  /** Cadastro com erro (409/422): teto separado e mais folgado, para não esgotar a cota por erro de digitação. */
  cadastroComErro: limitar({ janelaMin: 60, max: 30, soErros: true }),
  /** Login: 10 falhas por 15 min por IP + e-mail. */
  login: limitar({ janelaMin: 15, max: 10, soErros: true, porEmail: true }),
  /** Pedir código de recuperação: 5 por 15 min por IP + e-mail. */
  pedirCodigo: limitar({ janelaMin: 15, max: 5, porEmail: true }),
  /** Pedir código de troca de e-mail: 5 por 15 min por usuário. */
  pedirTrocaEmail: limitar({ janelaMin: 15, max: 5, porUsuario: true }),
  /** Redefinir senha (código): 10 falhas por 15 min por IP + e-mail. */
  conferirCodigo: limitar({ janelaMin: 15, max: 10, soErros: true, porEmail: true }),
  /** Confirmar troca de e-mail: 10 falhas por 15 min por usuário. */
  confirmarEmail: limitar({ janelaMin: 15, max: 10, soErros: true, porUsuario: true }),
  /** Alterar senha: 10 falhas por 15 min por usuário. */
  alterarSenha: limitar({ janelaMin: 15, max: 10, soErros: true, porUsuario: true }),
  /** Excluir conta: 10 falhas por 15 min por usuário. */
  excluirConta: limitar({ janelaMin: 15, max: 10, soErros: true, porUsuario: true }),
};
