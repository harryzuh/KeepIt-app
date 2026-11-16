import { env } from '../../config/env.js';
import { CODIGOS_ERRO, HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import { ACOES_AUDITORIA, registrarAuditoria } from '../../lib/auditoria.js';
import { ImagemInvalidaError, sanearImagem } from '../../lib/imagem.js';
import {
  VALIDADE_FOTO_PENDENTE_MS,
  apagarObjetos,
  assinarEnvio,
  chaveEnvioEhDaCasa,
  chaveFinalDoEnvio,
  enviarObjeto,
  gerarChaveEnvio,
  lerObjeto,
  lerPrimeirosBytes,
  obterMetadados,
} from '../../lib/s3.js';
import { EXTENSAO_POR_TIPO, detectarTipoImagem, tipoPorMime, type TipoImagem } from '../../lib/tipo-imagem.js';
import type { UsuarioAutenticado } from '../../middlewares/autenticar.js';
import { exigirCotaParaEnvio } from '../assinatura/plano.service.js';
import { FOTO_TAMANHO_MAX_BYTES, type UploadUrlDto } from './produtos.schema.js';

/**
 * MODEL · fotos dos produtos (M3: UC021, RF05, RF39; RNF08/09). Contrato: docs/api/m3-produtos.md, seções 3.3 e 5.
 * O navegador envia o arquivo direto ao S3 por URL assinada, para uma chave PENDENTE (`casas/<id>/pendentes/...`).
 * A API é a AUTORIDADE na hora de salvar o produto: confere a chave, o tamanho e o tipo real, DECODIFICA e RECODIFICA
 * a imagem (remove EXIF/GPS, neutraliza poliglota, limita dimensões) e grava o resultado numa chave DEFINITIVA
 * (`casas/<id>/fotos/...`) que nunca teve URL de escrita. A chave pendente é apagada. Só a definitiva é servida.
 */

const MENSAGEM_ARQUIVO = 'Use imagem JPEG ou PNG de até 5 MB';
const arquivoInvalido = (details?: unknown) => new HttpError(422, CODIGOS_ERRO.ARQUIVO_INVALIDO, MENSAGEM_ARQUIVO, details);

/** Teto de envios emitidos e ainda não confirmados (AppSec FD3): por usuário e por Casa, nas últimas 2 h. */
export const ENVIOS_PENDENTES_MAX_POR_USUARIO = 10;
export const ENVIOS_PENDENTES_MAX_POR_CASA = 30;

export interface FotoConfirmada {
  /** Chave DEFINITIVA (a que vai para `Foto.chave`). */
  chave: string;
  /** Chave de envio de onde a foto veio; apague-a depois de gravar. */
  chavePendente: string;
  tipo: TipoImagem;
  /** Tamanho da imagem recodificada (é o que conta na cota). */
  tamanhoBytes: number;
}

interface EnvioEmitido {
  chave: string;
  tamanhoBytes: number;
}

/** Envios emitidos (registrados no log) nas últimas 2 h que ainda não viraram `Foto`. */
async function enviosPendentes(casaId: number, usuarioId?: number): Promise<EnvioEmitido[]> {
  const desde = new Date(Date.now() - VALIDADE_FOTO_PENDENTE_MS);
  const logs = await prisma.logAuditoria.findMany({
    where: { acao: ACOES_AUDITORIA.FOTO_ENVIO_EMITIDO, casaId, ...(usuarioId ? { usuarioId } : {}), criadoEm: { gte: desde } },
    select: { detalhes: true },
    orderBy: { id: 'desc' },
    take: 500,
  });
  const emitidos = logs.flatMap((l) => {
    const d = l.detalhes as { chave?: unknown; tamanhoBytes?: unknown } | null;
    return typeof d?.chave === 'string' && typeof d.tamanhoBytes === 'number' ? [{ chave: d.chave, tamanhoBytes: d.tamanhoBytes }] : [];
  });
  if (emitidos.length === 0) return [];
  const confirmadas = new Set(
    (await prisma.foto.findMany({ where: { chave: { in: emitidos.map((e) => chaveFinalDoEnvio(e.chave)) } }, select: { chave: true } })).map(
      (f) => f.chave,
    ),
  );
  return emitidos.filter((e) => !confirmadas.has(chaveFinalDoEnvio(e.chave)));
}

/** POST /produtos/fotos/upload-url: chave pendente nova (gerada aqui) + PUT assinado de `Content-Type` e tamanho fixos. */
export async function gerarUrlDeEnvio(usuario: UsuarioAutenticado, dto: UploadUrlDto) {
  const tipo = tipoPorMime(dto.tipo);
  if (!tipo || dto.tamanhoBytes <= 0 || dto.tamanhoBytes > FOTO_TAMANHO_MAX_BYTES) throw arquivoInvalido();

  // Teto de envios pendentes: sem ele, 30 URLs/min de 5 MB encheriam o bucket antes da rotina de órfãos (2 h).
  const daCasa = await enviosPendentes(usuario.casaId);
  const doUsuario = await enviosPendentes(usuario.casaId, usuario.id);
  if (doUsuario.length >= ENVIOS_PENDENTES_MAX_POR_USUARIO || daCasa.length >= ENVIOS_PENDENTES_MAX_POR_CASA) {
    throw new HttpError(
      429,
      CODIGOS_ERRO.MUITAS_TENTATIVAS,
      'Há muitos envios de foto em andamento. Salve o produto ou aguarde alguns minutos para enviar mais fotos.',
    );
  }
  // Aviso antecipado, contando o que já foi autorizado e ainda não gravado; a decisão final é ao salvar o produto.
  // `substituiFotoIds` (troca na edição): desconta as fotos gravadas da própria Casa que serão removidas (saldo líquido,
  // como o PATCH). Ids de outra Casa ou inexistentes são ignorados; o aviso é só antecipado e o PATCH decide.
  const ids = [...new Set(dto.substituiFotoIds ?? [])];
  const liberados = ids.length
    ? (await prisma.foto.aggregate({ where: { id: { in: ids }, produto: { casaId: usuario.casaId } }, _sum: { tamanhoBytes: true } }))._sum
        .tamanhoBytes ?? 0
    : 0;
  await exigirCotaParaEnvio(usuario.casaId, dto.tamanhoBytes + daCasa.reduce((s, e) => s + e.tamanhoBytes, 0) - liberados);

  const chave = gerarChaveEnvio(usuario.casaId, tipo);
  const envio = await assinarEnvio(chave, tipo, dto.tamanhoBytes, env.S3_UPLOAD_URL_TTL_S);
  await registrarAuditoria({
    usuarioId: usuario.id,
    casaId: usuario.casaId,
    acao: ACOES_AUDITORIA.FOTO_ENVIO_EMITIDO,
    entidade: 'Foto',
    entidadeId: 0,
    detalhes: { chave, tamanhoBytes: dto.tamanhoBytes },
  });
  return {
    chave,
    url: envio.url,
    metodo: envio.metodo,
    cabecalhos: envio.cabecalhos,
    expiraEm: envio.expiraEm.toISOString(),
    confirmarAte: new Date(Date.now() + VALIDADE_FOTO_PENDENTE_MS).toISOString(),
  };
}

export interface FotoParaConfirmar {
  /** Posição da foto na lista `fotos` do corpo (vai no `campo` do erro: `fotos.N`). */
  indice: number;
  /** Chave de ENVIO informada pelo cliente (a devolvida pelo upload-url). */
  chave: string;
}

/**
 * Confere e saneia as fotos NOVAS de um cadastro/edição. Falhou qualquer uma → 422 ARQUIVO_INVALIDO com `details` por
 * foto, nada é gravado e os objetos inválidos (que são desta Casa e de ninguém mais) são apagados do S3.
 * Sucesso: as imagens recodificadas já estão nas chaves definitivas; quem chama grava as `Foto` e depois apaga os
 * pendentes (`apagarPendentes`) ou, se a gravação falhar, descarta os definitivos (`descartarDefinitivosNaoUsados`).
 */
export async function confirmarFotosNovas(casaId: number, fotos: FotoParaConfirmar[]): Promise<FotoConfirmada[]> {
  if (fotos.length === 0) return [];
  const chaves = fotos.map((f) => f.chave);
  const emUso = new Set(
    (await prisma.foto.findMany({ where: { chave: { in: chaves.map(chaveFinalDoEnvio) } }, select: { chave: true } })).map((f) => f.chave),
  );
  const agora = Date.now();

  type Resultado = { ok: FotoConfirmada } | { erro: string; apagar: boolean };
  const resultados: Resultado[] = await Promise.all(
    fotos.map(async ({ chave }): Promise<Resultado> => {
      // Chave de outra Casa, fora do formato (inclusive uma definitiva) ou já confirmada: nunca apagamos o objeto.
      if (!chaveEnvioEhDaCasa(chave, casaId) || emUso.has(chaveFinalDoEnvio(chave))) return { erro: 'Foto inválida', apagar: false };
      const meta = await obterMetadados(chave);
      if (!meta) return { erro: 'Arquivo não encontrado: envie a foto novamente', apagar: false };
      if (meta.modificadoEm && agora - meta.modificadoEm.getTime() > VALIDADE_FOTO_PENDENTE_MS) {
        return { erro: 'Envio vencido: envie a foto novamente', apagar: true };
      }
      if (meta.tamanhoBytes < 1 || meta.tamanhoBytes > FOTO_TAMANHO_MAX_BYTES) {
        return { erro: MENSAGEM_ARQUIVO, apagar: true };
      }
      const bytes = await lerPrimeirosBytes(chave);
      const tipo = bytes ? detectarTipoImagem(bytes) : null;
      if (!tipo) return { erro: MENSAGEM_ARQUIVO, apagar: true };
      // O tipo declarado no upload-url (extensão da chave) tem de ser o tipo real (FD7).
      if (!chave.endsWith(`.${EXTENSAO_POR_TIPO[tipo]}`)) {
        return { erro: 'O conteúdo do arquivo não é do tipo informado no envio', apagar: true };
      }
      // Lê UMA vez e trabalha só com estes bytes (sem janela para troca entre conferir e gravar).
      const original = await lerObjeto(chave, FOTO_TAMANHO_MAX_BYTES);
      if (!original) return { erro: 'Arquivo não encontrado: envie a foto novamente', apagar: false };
      if (original.length < 1 || original.length > FOTO_TAMANHO_MAX_BYTES) return { erro: MENSAGEM_ARQUIVO, apagar: true };
      try {
        const limpa = await sanearImagem(original, tipo);
        if (limpa.corpo.length > FOTO_TAMANHO_MAX_BYTES) return { erro: MENSAGEM_ARQUIVO, apagar: true };
        const definitiva = chaveFinalDoEnvio(chave);
        await enviarObjeto(definitiva, limpa.corpo, limpa.contentType);
        return { ok: { chave: definitiva, chavePendente: chave, tipo: limpa.tipo, tamanhoBytes: limpa.corpo.length } };
      } catch (err) {
        if (!(err instanceof ImagemInvalidaError)) throw err;
        const mensagem =
          err.motivo === 'DIMENSOES'
            ? 'A imagem é grande demais: use até 8000 px por lado e 40 megapixels'
            : err.motivo === 'TIPO_DIFERENTE'
              ? 'O conteúdo do arquivo não é do tipo informado no envio'
              : 'Não foi possível ler a imagem: o arquivo está corrompido';
        return { erro: mensagem, apagar: true };
      }
    }),
  );

  const erros = resultados.flatMap((r, i) => ('erro' in r ? [{ r, indice: fotos[i]!.indice, chave: fotos[i]!.chave }] : []));
  if (erros.length > 0) {
    // Fotos boas do mesmo pedido: descarta as cópias definitivas (nada será gravado) e mantém os pendentes para nova tentativa.
    const prontas = resultados.flatMap((r) => ('ok' in r ? [r.ok.chave] : []));
    await apagarObjetos([...erros.filter((e) => e.r.apagar).map((e) => e.chave), ...(await semFotoGravada(prontas))]);
    throw arquivoInvalido(erros.map((e) => ({ campo: `fotos.${e.indice}`, mensagem: e.r.erro })));
  }
  return resultados.map((r) => (r as { ok: FotoConfirmada }).ok);
}

async function semFotoGravada(chaves: string[]): Promise<string[]> {
  if (chaves.length === 0) return [];
  const emUso = new Set((await prisma.foto.findMany({ where: { chave: { in: chaves } }, select: { chave: true } })).map((f) => f.chave));
  return chaves.filter((c) => !emUso.has(c));
}

/** Depois de gravar as `Foto`: apaga os objetos de envio (a URL de escrita deixa de ter efeito sobre a foto servida). */
export async function apagarPendentes(confirmadas: FotoConfirmada[]): Promise<void> {
  await apagarObjetos(confirmadas.map((f) => f.chavePendente));
}

/** A gravação falhou (cota, conflito...): apaga as cópias definitivas que não viraram `Foto`. Os pendentes ficam para nova tentativa. */
export async function descartarDefinitivosNaoUsados(confirmadas: FotoConfirmada[]): Promise<void> {
  await apagarObjetos(await semFotoGravada(confirmadas.map((f) => f.chave)));
}

/** Apaga do S3 chaves de envio descartadas (ex.: fotos enviadas junto com SOMAR). Pendentes nunca têm `Foto`. */
export async function descartarObjetosNaoUsados(casaId: number, chaves: string[]): Promise<void> {
  await apagarObjetos(chaves.filter((c) => chaveEnvioEhDaCasa(c, casaId)));
}
