import type { RequestHandler } from 'express';

/** Impede cache de respostas com dados pessoais ou token (Cache-Control: no-store). */
export const semCache: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
};
