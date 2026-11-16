import { describe, expect, it } from 'vitest';
import { detectarTipoImagem, tipoPorMime } from './tipo-imagem.js';

const bytes = (...n: number[]) => Uint8Array.from(n);
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe('detectarTipoImagem (tipo real por assinatura)', () => {
  it('reconhece JPEG (FF D8 FF) e PNG (assinatura de 8 bytes)', () => {
    expect(detectarTipoImagem(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10))).toBe('JPEG');
    expect(detectarTipoImagem(bytes(0xff, 0xd8, 0xff))).toBe('JPEG');
    expect(detectarTipoImagem(bytes(...PNG, 0, 0, 0, 13))).toBe('PNG');
  });

  it('recusa outros formatos mesmo que o arquivo se chame .jpg/.png', () => {
    expect(detectarTipoImagem(Buffer.from('GIF89a......'))).toBeNull(); // GIF
    expect(detectarTipoImagem(Buffer.from('%PDF-1.7\n'))).toBeNull(); // PDF
    expect(detectarTipoImagem(Buffer.from('RIFF....WEBPVP8 '))).toBeNull(); // WebP
    expect(detectarTipoImagem(Buffer.from('MZ\x90\x00\x03'))).toBeNull(); // executável Windows
    expect(detectarTipoImagem(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull(); // SVG
    expect(detectarTipoImagem(Buffer.from('....ftypheic'))).toBeNull(); // HEIC
  });

  it('recusa conteúdo vazio, curto demais ou com assinatura incompleta', () => {
    expect(detectarTipoImagem(bytes())).toBeNull();
    expect(detectarTipoImagem(bytes(0xff, 0xd8))).toBeNull();
    expect(detectarTipoImagem(bytes(...PNG.slice(0, 7)))).toBeNull();
    expect(detectarTipoImagem(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0b))).toBeNull();
  });
});

describe('tipoPorMime', () => {
  it('aceita só image/jpeg e image/png (sem diferenciar caixa)', () => {
    expect(tipoPorMime('image/jpeg')).toBe('JPEG');
    expect(tipoPorMime('IMAGE/PNG')).toBe('PNG');
    expect(tipoPorMime('image/gif')).toBeNull();
    expect(tipoPorMime('image/jpg')).toBeNull();
  });
});
