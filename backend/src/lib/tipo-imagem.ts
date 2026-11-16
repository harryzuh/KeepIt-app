/**
 * Detector do TIPO REAL de imagem pelos primeiros bytes (assinatura), nunca pela extensão nem pelo Content-Type
 * informado pelo cliente (RNF08, ADR 0003 D2). Aceita só JPEG e PNG.
 */

export type TipoImagem = 'JPEG' | 'PNG';

/** Quantos bytes iniciais bastam para reconhecer os dois formatos. */
export const BYTES_PARA_DETECTAR = 16;

/** Content-Type aceito na API para cada tipo real. */
export const MIME_POR_TIPO: Record<TipoImagem, 'image/jpeg' | 'image/png'> = {
  JPEG: 'image/jpeg',
  PNG: 'image/png',
};

export const EXTENSAO_POR_TIPO: Record<TipoImagem, 'jpg' | 'png'> = { JPEG: 'jpg', PNG: 'png' };

export const MIMES_ACEITOS = ['image/jpeg', 'image/png'] as const;
export type MimeAceito = (typeof MIMES_ACEITOS)[number];

export function tipoPorMime(mime: string): TipoImagem | null {
  const m = mime.trim().toLowerCase();
  return m === 'image/jpeg' ? 'JPEG' : m === 'image/png' ? 'PNG' : null;
}

const ASSINATURA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Reconhece o formato pelos primeiros bytes: JPEG começa com `FF D8 FF`; PNG com a assinatura de 8 bytes
 * `89 50 4E 47 0D 0A 1A 0A`. Qualquer outra coisa (GIF, WebP, HEIC, SVG, PDF, executável renomeado...) → `null`.
 */
export function detectarTipoImagem(bytes: Uint8Array): TipoImagem | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'JPEG';
  if (bytes.length >= ASSINATURA_PNG.length && ASSINATURA_PNG.every((b, i) => bytes[i] === b)) return 'PNG';
  return null;
}
