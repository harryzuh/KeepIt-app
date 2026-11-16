import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { ehConflitoDeConcorrencia } from '../lib/concorrencia.js';
import { descreverErro } from '../lib/erro-log.js';
import { CODIGOS_ERRO, HttpError, type DetalheCampo } from '../lib/http-error.js';

/** Converte as issues do Zod em `[{ campo, mensagem }]` (campo com notação de ponto). */
export function detalhesDoZod(err: ZodError): DetalheCampo[] {
  return err.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message }));
}

/**
 * Formato único de erro da API: `{ error, message, details? }`.
 * `error` é o código fixo (ex.: EMAIL_EM_USO); `message` é texto em pt-BR para logs e depuração.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (res.headersSent) {
    return;
  }
  if (err instanceof ZodError) {
    res.status(422).json({
      error: CODIGOS_ERRO.DADOS_INVALIDOS,
      message: 'Dados inválidos',
      details: detalhesDoZod(err),
    });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: err.codigo,
      message: err.message,
      ...(err.details !== undefined && { details: err.details }),
    });
    return;
  }
  // Impasse/serialização no Postgres: nada foi gravado; o cliente pode repetir o pedido.
  if (ehConflitoDeConcorrencia(err)) {
    res.status(409).json({
      error: CODIGOS_ERRO.CONFLITO_CONCORRENTE,
      message: 'Outra operação estava em andamento. Tente novamente',
    });
    return;
  }
  // body-parser: JSON malformado ou grande demais
  const status = (err as { status?: number; type?: string }).status;
  const tipo = (err as { type?: string }).type;
  if (tipo === 'entity.parse.failed' || tipo === 'entity.too.large' || status === 400) {
    res.status(status ?? 400).json({
      error: CODIGOS_ERRO.REQUISICAO_INVALIDA,
      message: 'Requisição inválida',
    });
    return;
  }
  // Não loga o objeto inteiro: erros do Prisma podem trazer argumentos com dados do usuário.
  console.error('Erro interno:', descreverErro(err));
  res.status(500).json({ error: CODIGOS_ERRO.ERRO_INTERNO, message: 'Erro interno' });
};

/** Rota inexistente (404 no formato padrão). */
export const rotaNaoEncontrada: RequestHandler = (_req, res) => {
  res.status(404).json({ error: CODIGOS_ERRO.NAO_ENCONTRADO, message: 'Rota não encontrada' });
};
