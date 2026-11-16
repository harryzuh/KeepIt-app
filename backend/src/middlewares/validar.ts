import type { RequestHandler } from 'express';
import type { z } from 'zod';
import '../config/zod.js';

interface Esquemas {
  body?: z.ZodType;
  params?: z.ZodType;
  query?: z.ZodType;
}

/**
 * Valida `body`, `params` e `query` com Zod. Se algo estiver inválido, o ZodError segue ao
 * errorHandler (422 DADOS_INVALIDOS com `details: [{ campo, mensagem }]`). Se estiver válido,
 * substitui `req.body`, `req.params` e `req.query` pelos valores já convertidos/normalizados
 * (e-mail em minúsculas, números coeridos etc.).
 */
export function validar(esquemas: Esquemas): RequestHandler {
  return (req, _res, next) => {
    if (esquemas.params) req.params = esquemas.params.parse(req.params) as typeof req.params;
    if (esquemas.query) {
      // No Express 5, req.query é somente leitura: redefinimos a propriedade na própria requisição.
      Object.defineProperty(req, 'query', {
        value: esquemas.query.parse(req.query),
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }
    // body ausente (sem JSON) chega como undefined no Express 5; tratamos como objeto vazio.
    if (esquemas.body) req.body = esquemas.body.parse(req.body ?? {});
    next();
  };
}
