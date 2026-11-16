import { randomUUID } from 'node:crypto';
import type { Foto, Produto, Tag } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import sharp from 'sharp';
import { enviarObjeto, apagarObjetos, gerarChaveEnvio, gerarChaveFoto } from '../lib/s3.js';

/** Helpers de teste do M3: produto, tag e foto na Casa (inclusive de outra Casa), e objetos reais no S3 local. */

let contador = 0;

export async function criarProdutoDeTeste(
  casaId: number,
  dados: Partial<{
    nome: string;
    descricao: string | null;
    preco: string;
    quantidade: number;
    dataCompra: Date;
    adicionadoPorId: number | null;
    tags: string[];
  }> = {},
): Promise<Produto> {
  contador += 1;
  const { tags = [], ...resto } = dados;
  const produto = await prisma.produto.create({
    data: {
      casaId,
      nome: resto.nome ?? `Produto de teste ${contador}`,
      descricao: resto.descricao ?? null,
      preco: resto.preco ?? '10.00',
      quantidade: resto.quantidade ?? 1,
      dataCompra: resto.dataCompra ?? new Date('2026-01-15'),
      adicionadoPorId: resto.adicionadoPorId ?? null,
    },
  });
  const ids = new Set<number>();
  for (const nome of tags) ids.add((await criarTagDeTeste(casaId, nome)).id);
  if (ids.size) await prisma.produtoTag.createMany({ data: [...ids].map((tagId) => ({ produtoId: produto.id, tagId })) });
  return produto;
}

/** Cria a tag ou devolve a existente (sem diferenciar caixa), como a API faz. */
export async function criarTagDeTeste(casaId: number, nome: string): Promise<Tag> {
  const existente = await prisma.tag.findFirst({ where: { casaId, nome: { equals: nome, mode: 'insensitive' } } });
  return existente ?? prisma.tag.create({ data: { casaId, nome } });
}

/** Grava a linha de `Foto` (sem objeto no S3). Use para testar cota e limites; para leitura real use `criarFotoComObjeto`. */
export async function criarFotoDeTeste(
  produtoId: number,
  dados: Partial<{ chave: string; tipo: 'JPEG' | 'PNG'; tamanhoBytes: number; ordem: number }> = {},
): Promise<Foto> {
  contador += 1;
  return prisma.foto.create({
    data: {
      produtoId,
      chave: dados.chave ?? `teste/${randomUUID()}.jpg`,
      tipo: dados.tipo ?? 'JPEG',
      tamanhoBytes: dados.tamanhoBytes ?? 1000,
      ordem: dados.ordem ?? 0,
    },
  });
}

/** PNG válido de 1x1 pixel (70 bytes). */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
/** JPEG mínimo: só a assinatura e um marcador (basta para a detecção por bytes; NÃO decodifica). */
export const JPEG_MINIMO = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

/** Imagem REAL (decodificável) de teste. `exif` grava um Copyright e coordenadas GPS para provar que o servidor as remove. */
export async function gerarImagemDeTeste(
  tipo: 'JPEG' | 'PNG' = 'PNG',
  largura = 8,
  altura = 6,
  exif = false,
): Promise<Buffer> {
  const base = sharp({ create: { width: largura, height: altura, channels: 3, background: { r: 200, g: 30, b: 30 } } });
  if (tipo === 'PNG') return base.png().toBuffer();
  const jpeg = base.jpeg();
  return (exif ? jpeg.withExif({ IFD0: { Copyright: 'dono-do-celular' }, IFD3: { GPSLatitudeRef: 'S', GPSLongitudeRef: 'W' } }) : jpeg).toBuffer();
}

/** Chave PENDENTE nova no formato aceito pela API para a Casa (a que o cliente informa ao salvar o produto). */
export function chaveDeTeste(casaId: number, extensao: 'jpg' | 'png' = 'png'): string {
  return gerarChaveEnvio(casaId, extensao === 'png' ? 'PNG' : 'JPEG');
}

/** Envia um objeto REAL ao S3 local (SeaweedFS do compose) na área de ENVIO e devolve a chave. Limpe com `limparObjetosDeTeste`. */
export async function enviarObjetoDeTeste(casaId: number, corpo: Buffer, extensao: 'jpg' | 'png' = 'png'): Promise<string> {
  const chave = chaveDeTeste(casaId, extensao);
  await enviarObjeto(chave, corpo, extensao === 'png' ? 'image/png' : 'image/jpeg');
  return chave;
}

/** Envia um objeto REAL à área de fotos CONFIRMADAS (a das linhas de `Foto`) e devolve a chave. */
export async function enviarFotoConfirmadaDeTeste(casaId: number, corpo: Buffer, tipo: 'JPEG' | 'PNG' = 'PNG'): Promise<string> {
  const chave = gerarChaveFoto(casaId, tipo);
  await enviarObjeto(chave, corpo, tipo === 'PNG' ? 'image/png' : 'image/jpeg');
  return chave;
}

export async function limparObjetosDeTeste(chaves: string[]): Promise<void> {
  await apagarObjetos(chaves);
}
