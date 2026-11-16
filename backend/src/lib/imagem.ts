import sharp from 'sharp';
import { MIME_POR_TIPO, type TipoImagem } from './tipo-imagem.js';

/**
 * Saneamento de imagem no servidor (AppSec FD5, FD1, FD13; LGPD). O arquivo que o navegador enviou NUNCA é servido:
 * é decodificado e recodificado aqui, o que remove EXIF/GPS e demais metadados, neutraliza arquivo "poliglota"
 * (imagem válida com script ou outro formato anexado) e impõe limite de dimensões. Sem HTTP nem regra de negócio.
 */

/** Maior lado aceito, em pixels. */
export const LADO_MAX_PX = 8000;
/** Maior área aceita, em pixels (40 megapixels). */
export const PIXELS_MAX = 40_000_000;

const JPEG_QUALIDADE = 85;

export type MotivoImagemInvalida = 'ILEGIVEL' | 'TIPO_DIFERENTE' | 'DIMENSOES';

export class ImagemInvalidaError extends Error {
  constructor(readonly motivo: MotivoImagemInvalida) {
    super(`Imagem inválida: ${motivo}`);
  }
}

export interface ImagemSaneada {
  corpo: Buffer;
  tipo: TipoImagem;
  contentType: 'image/jpeg' | 'image/png';
  largura: number;
  altura: number;
}

/**
 * Decodifica `bytes`, confere que o formato REAL é `esperado`, recusa dimensões acima do limite e devolve a imagem
 * recodificada sem metadados (a orientação EXIF é aplicada aos pixels antes de ser descartada).
 * Lança `ImagemInvalidaError` para arquivo corrompido, de outro formato ou grande demais.
 */
export async function sanearImagem(bytes: Buffer, esperado: TipoImagem): Promise<ImagemSaneada> {
  try {
    // limitInputPixels barra "bombas de descompressão" antes de alocar memória.
    const origem = () => sharp(bytes, { limitInputPixels: PIXELS_MAX, failOn: 'error' });
    const meta = await origem().metadata();
    const real: TipoImagem | null = meta.format === 'jpeg' ? 'JPEG' : meta.format === 'png' ? 'PNG' : null;
    if (!real) throw new ImagemInvalidaError('ILEGIVEL');
    if (real !== esperado) throw new ImagemInvalidaError('TIPO_DIFERENTE');
    const largura = meta.width ?? 0;
    const altura = meta.height ?? 0;
    if (largura < 1 || altura < 1) throw new ImagemInvalidaError('ILEGIVEL');
    if (largura > LADO_MAX_PX || altura > LADO_MAX_PX || largura * altura > PIXELS_MAX) throw new ImagemInvalidaError('DIMENSOES');

    const pipeline = origem().rotate(); // aplica a orientação; sem withMetadata, o resultado sai sem EXIF/ICC/XMP
    const corpo = await (real === 'JPEG' ? pipeline.jpeg({ quality: JPEG_QUALIDADE }) : pipeline.png({ compressionLevel: 9 })).toBuffer();
    return { corpo, tipo: real, contentType: MIME_POR_TIPO[real], largura, altura };
  } catch (err) {
    if (err instanceof ImagemInvalidaError) throw err;
    // sharp lança para arquivo truncado, corrompido ou acima de limitInputPixels.
    const acimaDoLimite = err instanceof Error && /pixel limit/i.test(err.message);
    throw new ImagemInvalidaError(acimaDoLimite ? 'DIMENSOES' : 'ILEGIVEL');
  }
}
