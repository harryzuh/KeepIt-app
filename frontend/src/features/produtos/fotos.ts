import { ApiError } from '@/lib/api';
import { registrarFalhaDeRede } from '@/lib/conexao';
import { urlDoS3 } from '@/lib/s3';
import { produtosApi } from './api';
import type { PedidoUploadUrl, TipoImagem } from './tipos';

/** Limites do contrato (docs/api/m3-produtos.md, seção 3.3). */
export const MAX_FOTOS = 3;
export const MAX_BYTES_FOTO = 5 * 1024 * 1024;

export const MIME_POR_TIPO: Record<TipoImagem, PedidoUploadUrl['tipo']> = { JPEG: 'image/jpeg', PNG: 'image/png' };

/** Tipo real pelos primeiros bytes (assinatura do arquivo), não pela extensão nem pelo `file.type`. */
export function detectarTipo(b: Uint8Array): TipoImagem | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'JPEG';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length >= 8 && png.every((v, i) => b[i] === v)) return 'PNG';
  return null;
}

function lerPrimeirosBytes(file: Blob, n = 12): Promise<Uint8Array> {
  return new Promise((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => falha(r.error);
    r.readAsArrayBuffer(file.slice(0, n));
  });
}

export type ResultadoValidacao = { ok: true; tipo: TipoImagem } | { ok: false; codigo: 'ARQUIVO_INVALIDO' };

/** Aviso imediato no navegador: JPEG/PNG de verdade (bytes) e de 1 byte a 5 MB. A API confere de novo ao salvar. */
export async function validarArquivo(file: File): Promise<ResultadoValidacao> {
  if (file.size <= 0 || file.size > MAX_BYTES_FOTO) return { ok: false, codigo: 'ARQUIVO_INVALIDO' };
  try {
    const tipo = detectarTipo(await lerPrimeirosBytes(file));
    return tipo ? { ok: true, tipo } : { ok: false, codigo: 'ARQUIVO_INVALIDO' };
  } catch {
    return { ok: false, codigo: 'ARQUIVO_INVALIDO' };
  }
}

/** PUT com progresso (fetch não informa progresso de envio). Corpo = o arquivo, cabeçalhos = os assinados, sem Authorization. */
function enviarPut(url: string, cabecalhos: Record<string, string>, file: File, aoProgredir: (pct: number) => void): Promise<number> {
  return new Promise((ok, falha) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', urlDoS3(url));
    for (const [k, v] of Object.entries(cabecalhos)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) aoProgredir(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => ok(xhr.status);
    xhr.onerror = () => {
      registrarFalhaDeRede(true);
      falha(new ApiError(0, 'SEM_CONEXAO', 'Sem conexão com a internet'));
    };
    xhr.onabort = () => falha(new ApiError(0, 'ENVIO_FOTO_FALHOU', 'Envio cancelado'));
    xhr.send(file);
  });
}

/**
 * Fluxo da foto: pede a URL assinada → PUT direto ao S3 com progresso → devolve a `chave` para enviar em `fotos`.
 * 403 do S3 = URL vencida (5 min) ou tamanho/tipo diferentes dos assinados: pede uma URL nova e tenta uma vez mais.
 */
export async function enviarFoto(file: File, tipo: TipoImagem, aoProgredir: (pct: number) => void, substituiFotoIds: number[] = []): Promise<string> {
  const pedido: PedidoUploadUrl = { tipo: MIME_POR_TIPO[tipo], tamanhoBytes: file.size };
  if (substituiFotoIds.length > 0) pedido.substituiFotoIds = substituiFotoIds.slice(0, MAX_FOTOS);
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const u = await produtosApi.uploadUrl(pedido);
    aoProgredir(0);
    const status = await enviarPut(u.url, u.cabecalhos, file, aoProgredir);
    if (status >= 200 && status < 300) {
      registrarFalhaDeRede(false);
      aoProgredir(100);
      return u.chave;
    }
    if (status !== 403) break;
  }
  throw new ApiError(0, 'ENVIO_FOTO_FALHOU', 'Falha ao enviar a foto');
}
