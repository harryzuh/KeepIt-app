import { randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.js';
import { BYTES_PARA_DETECTAR, EXTENSAO_POR_TIPO, MIME_POR_TIPO, detectarTipoImagem, type TipoImagem } from './tipo-imagem.js';

/**
 * Acesso ao object storage S3 (SeaweedFS em dev, Cloudflare R2 em produção). Camada de infraestrutura SEM regra
 * de negócio e sem HTTP (ADR 0003 D1 a D3). Duas origens:
 * - cliente INTERNO (`S3_ENDPOINT`): HEAD, leitura dos primeiros bytes, apagar e listar (o backend fala com `s3:9000`);
 * - cliente de ASSINATURA (`S3_PUBLIC_ENDPOINT`, ou `S3_ENDPOINT` se ausente): só gera as URLs entregues ao navegador.
 */

function criarCliente(endpoint: string | undefined): S3Client {
  return new S3Client({
    region: env.S3_REGION,
    endpoint,
    // SeaweedFS e R2 aceitam endereçamento por caminho (http://host/bucket/chave): sem DNS de bucket em dev.
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    // Sem checksum automático: ele entraria na URL assinada e o navegador (PUT simples) não o enviaria.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

let interno: S3Client | undefined;
let assinador: S3Client | undefined;
const clienteInterno = () => (interno ??= criarCliente(env.S3_ENDPOINT));
const clienteAssinador = () => (assinador ??= criarCliente(env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT));

const Bucket = () => env.S3_BUCKET;

/** Quanto tempo um objeto enviado e ainda não salvo em um produto é tolerado antes de a rotina de órfãos apagá-lo (ADR 0003 D6). */
export const VALIDADE_FOTO_PENDENTE_MS = 2 * 60 * 60 * 1000;

// ---------------------------------------------------------------- chaves

/**
 * Duas áreas por Casa (AppSec FD1): `pendentes/` recebe o PUT assinado do navegador e NUNCA é servida; `fotos/` só é
 * escrita pelo backend (depois de conferir e recodificar a imagem) e é a única de que se gera URL de leitura.
 * Assim, quem guarda a URL de envio não consegue trocar os bytes de uma foto já confirmada.
 */
export function prefixoRaizDaCasa(casaId: number): string {
  return `casas/${casaId}/`;
}

/** Fotos CONFIRMADAS da Casa (servidas por URL assinada de leitura). */
export function prefixoDaCasa(casaId: number): string {
  return `${prefixoRaizDaCasa(casaId)}fotos/`;
}

/** Envios ainda não confirmados da Casa (área de escrita do navegador). */
export function prefixoPendentesDaCasa(casaId: number): string {
  return `${prefixoRaizDaCasa(casaId)}pendentes/`;
}

/** Gera a chave PENDENTE (alvo do PUT assinado). Imprevisível; nunca usa o nome do arquivo do usuário. */
export function gerarChaveEnvio(casaId: number, tipo: TipoImagem): string {
  return `${prefixoPendentesDaCasa(casaId)}${randomUUID()}.${EXTENSAO_POR_TIPO[tipo]}`;
}

/** Gera uma chave de foto CONFIRMADA (uso do seed). */
export function gerarChaveFoto(casaId: number, tipo: TipoImagem): string {
  return `${prefixoDaCasa(casaId)}${randomUUID()}.${EXTENSAO_POR_TIPO[tipo]}`;
}

/** A chave é de foto confirmada da Casa e tem o formato gerado pelo servidor? */
export function chaveEhDaCasa(chave: string, casaId: number): boolean {
  return new RegExp(`^casas/${casaId}/fotos/[0-9a-f-]{36}\\.(jpg|png)$`).test(chave);
}

/** A chave é de ENVIO pendente da Casa (a que o cliente informa ao salvar o produto)? */
export function chaveEnvioEhDaCasa(chave: string, casaId: number): boolean {
  return new RegExp(`^casas/${casaId}/pendentes/[0-9a-f-]{36}\\.(jpg|png)$`).test(chave);
}

/** Chave definitiva correspondente a uma chave de envio (mesmo UUID: a unicidade de `Foto.chave` barra a dupla confirmação). */
export function chaveFinalDoEnvio(chaveEnvio: string): string {
  return chaveEnvio.replace('/pendentes/', '/fotos/');
}

// ---------------------------------------------------------------- URLs assinadas (navegador)

export interface EnvioAssinado {
  /** URL do PUT, assinada para o host de `S3_PUBLIC_ENDPOINT`/`S3_ENDPOINT` (ver ADR 0003 D3). */
  url: string;
  metodo: 'PUT';
  /** Cabeçalhos que o navegador deve mandar exatamente assim (fazem parte da assinatura). */
  cabecalhos: { 'Content-Type': string };
  expiraEm: Date;
}

/**
 * URL PUT assinada com validade curta, de `Content-Type` e `Content-Length` FIXOS: o S3 rejeita (403) um corpo de
 * outro tamanho ou tipo. Não substitui a conferência na confirmação (os bytes reais são lidos depois).
 */
export async function assinarEnvio(
  chave: string,
  tipo: TipoImagem,
  tamanhoBytes: number,
  expiraEmS = env.S3_UPLOAD_URL_TTL_S,
): Promise<EnvioAssinado> {
  const contentType = MIME_POR_TIPO[tipo];
  const url = await getSignedUrl(
    clienteAssinador(),
    new PutObjectCommand({ Bucket: Bucket(), Key: chave, ContentType: contentType, ContentLength: tamanhoBytes }),
    { expiresIn: expiraEmS, signableHeaders: new Set(['content-type', 'content-length']) },
  );
  return { url, metodo: 'PUT', cabecalhos: { 'Content-Type': contentType }, expiraEm: new Date(Date.now() + expiraEmS * 1000) };
}

/**
 * URL GET assinada e curta para exibir a foto (o bucket nunca é público). Fixa na assinatura o tipo, `inline` e
 * `private` (AppSec FD6): o navegador não interpreta o objeto como outra coisa nem o guarda em cache compartilhado.
 */
export async function assinarLeitura(chave: string, expiraEmS = env.S3_READ_URL_TTL_S): Promise<string> {
  const mime = chave.endsWith('.png') ? MIME_POR_TIPO.PNG : MIME_POR_TIPO.JPEG;
  return getSignedUrl(
    clienteAssinador(),
    new GetObjectCommand({
      Bucket: Bucket(),
      Key: chave,
      ResponseContentType: mime,
      ResponseContentDisposition: 'inline',
      ResponseCacheControl: `private, max-age=${expiraEmS}`,
    }),
    { expiresIn: expiraEmS },
  );
}

// ---------------------------------------------------------------- operações do backend

export interface MetadadosObjeto {
  tamanhoBytes: number;
  contentType: string | undefined;
  modificadoEm: Date | undefined;
}

function ehNaoEncontrado(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}

/** HEAD: tamanho real do objeto. `null` se não existe. */
export async function obterMetadados(chave: string): Promise<MetadadosObjeto | null> {
  try {
    const r = await clienteInterno().send(new HeadObjectCommand({ Bucket: Bucket(), Key: chave }));
    return { tamanhoBytes: r.ContentLength ?? 0, contentType: r.ContentType, modificadoEm: r.LastModified };
  } catch (err) {
    if (ehNaoEncontrado(err)) return null;
    throw err;
  }
}

/** Lê só os primeiros `n` bytes (Range). `null` se o objeto não existe. */
export async function lerPrimeirosBytes(chave: string, n = BYTES_PARA_DETECTAR): Promise<Buffer | null> {
  try {
    const r = await clienteInterno().send(new GetObjectCommand({ Bucket: Bucket(), Key: chave, Range: `bytes=0-${n - 1}` }));
    return r.Body ? Buffer.from(await r.Body.transformToByteArray()) : Buffer.alloc(0);
  } catch (err) {
    if (ehNaoEncontrado(err)) return null;
    throw err;
  }
}

/** Lê o objeto inteiro (já conferido por HEAD como ≤ 5 MB). `null` se não existe; recusa corpo acima de `maxBytes`. */
export async function lerObjeto(chave: string, maxBytes: number): Promise<Buffer | null> {
  try {
    const r = await clienteInterno().send(new GetObjectCommand({ Bucket: Bucket(), Key: chave }));
    if ((r.ContentLength ?? 0) > maxBytes) return Buffer.alloc(maxBytes + 1);
    return r.Body ? Buffer.from(await r.Body.transformToByteArray()) : Buffer.alloc(0);
  } catch (err) {
    if (ehNaoEncontrado(err)) return null;
    throw err;
  }
}

export interface ObjetoInspecionado {
  tamanhoBytes: number;
  /** Tipo real pelos bytes; `null` se não for JPEG nem PNG. */
  tipo: TipoImagem | null;
}

/** HEAD + primeiros bytes de uma vez (base da confirmação das fotos). `null` se o objeto não existe. */
export async function inspecionarObjeto(chave: string): Promise<ObjetoInspecionado | null> {
  const meta = await obterMetadados(chave);
  if (!meta) return null;
  const bytes = await lerPrimeirosBytes(chave);
  if (!bytes) return null;
  return { tamanhoBytes: meta.tamanhoBytes, tipo: detectarTipoImagem(bytes) };
}

/** Apaga um objeto. Idempotente (apagar o que não existe não é erro). Erros de rede sobem ao chamador. */
export async function apagarObjeto(chave: string): Promise<void> {
  await clienteInterno().send(new DeleteObjectCommand({ Bucket: Bucket(), Key: chave }));
}

/**
 * Apaga vários objetos sem lançar: devolve as chaves que NÃO foram apagadas (para log e nova tentativa pela rotina
 * de órfãos). Até 1000 chaves por chamada.
 */
export async function apagarObjetos(chaves: string[]): Promise<string[]> {
  if (chaves.length === 0) return [];
  try {
    const r = await clienteInterno().send(
      new DeleteObjectsCommand({ Bucket: Bucket(), Delete: { Objects: chaves.map((Key) => ({ Key })), Quiet: true } }),
    );
    const falhas = new Set((r.Errors ?? []).map((e) => e.Key).filter((k): k is string => !!k));
    return chaves.filter((c) => falhas.has(c));
  } catch {
    return chaves;
  }
}

export interface PaginaDeObjetos {
  objetos: { chave: string; tamanhoBytes: number; modificadoEm: Date | undefined }[];
  /** Passe em `continuacao` para a próxima página; ausente na última. */
  proxima?: string;
}

/** Lista objetos sob um prefixo (rotina de órfãos). */
export async function listarObjetos(prefixo: string, continuacao?: string, max = 1000): Promise<PaginaDeObjetos> {
  const r = await clienteInterno().send(
    new ListObjectsV2Command({ Bucket: Bucket(), Prefix: prefixo, ContinuationToken: continuacao, MaxKeys: max }),
  );
  return {
    objetos: (r.Contents ?? []).map((o) => ({ chave: o.Key ?? '', tamanhoBytes: o.Size ?? 0, modificadoEm: o.LastModified })),
    proxima: r.IsTruncated ? r.NextContinuationToken : undefined,
  };
}

/** Envia bytes direto do backend (seed e testes; o app em produção só recebe pelo navegador). */
export async function enviarObjeto(chave: string, corpo: Buffer, contentType: string): Promise<void> {
  await clienteInterno().send(new PutObjectCommand({ Bucket: Bucket(), Key: chave, Body: corpo, ContentType: contentType }));
}

/**
 * Apaga TODOS os objetos sob um prefixo (exclusão da Casa, LGPD — ADR 0003 D6). Devolve quantos foram apagados e
 * quantos falharam; as falhas ficam sem linha em `Foto` e a rotina de órfãos as recolhe depois.
 */
export async function apagarPrefixo(prefixo: string): Promise<{ apagados: number; falhas: number }> {
  let apagados = 0;
  let falhas = 0;
  let continuacao: string | undefined;
  do {
    const pagina = await listarObjetos(prefixo, continuacao);
    const chaves = pagina.objetos.map((o) => o.chave);
    const naoApagadas = await apagarObjetos(chaves);
    apagados += chaves.length - naoApagadas.length;
    falhas += naoApagadas.length;
    continuacao = pagina.proxima;
  } while (continuacao);
  return { apagados, falhas };
}
