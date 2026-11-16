import { createHmac, hkdfSync, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

/** Validade do código de verificação (UC006/UC015): 15 minutos. */
export const CODIGO_VALIDADE_MINUTOS = 15;

/** Chave do HMAC dos códigos: `CODIGO_SECRET` ou, em dev/teste, uma chave derivada (HKDF) do JWT_SECRET. */
const chaveDosCodigos: Buffer = env.CODIGO_SECRET
  ? Buffer.from(env.CODIGO_SECRET)
  : Buffer.from(hkdfSync('sha256', env.JWT_SECRET, '', 'keepit:codigo-verificacao', 32));

/** Código numérico criptograficamente seguro, com zeros à esquerda (padrão: 6 dígitos). */
export function gerarCodigoNumerico(digitos = 6): string {
  return String(randomInt(0, 10 ** digitos)).padStart(digitos, '0');
}

/** Instante de expiração de um código gerado agora. */
export function expiracaoDoCodigo(agora = new Date()): Date {
  return new Date(agora.getTime() + CODIGO_VALIDADE_MINUTOS * 60_000);
}

/**
 * Hash do código (HMAC-SHA256 com chave dedicada). Só o hash vai ao banco.
 * `contexto` amarra o hash ao usuário e à finalidade (ex.: `${usuarioId}:RECUPERAR_SENHA`),
 * então um código de uma finalidade/usuário não vale em outra.
 */
export function hashCodigo(codigo: string, contexto: string): string {
  return createHmac('sha256', chaveDosCodigos).update(`${contexto}:${codigo}`).digest('hex');
}

/** Compara o código informado com o hash guardado em tempo constante. */
export function conferirCodigo(codigo: string, hashGuardado: string, contexto: string): boolean {
  const a = Buffer.from(hashCodigo(codigo, contexto), 'hex');
  const b = Buffer.from(hashGuardado, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
