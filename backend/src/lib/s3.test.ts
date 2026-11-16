import { afterAll, describe, expect, it } from 'vitest';
import {
  apagarObjeto,
  apagarObjetos,
  apagarPrefixo,
  assinarEnvio,
  assinarLeitura,
  chaveEhDaCasa,
  gerarChaveFoto,
  inspecionarObjeto,
  lerPrimeirosBytes,
  listarObjetos,
  obterMetadados,
  prefixoDaCasa,
  prefixoPendentesDaCasa,
  prefixoRaizDaCasa,
  chaveEnvioEhDaCasa,
  chaveFinalDoEnvio,
  gerarChaveEnvio,
} from './s3.js';
import { JPEG_MINIMO, PNG_1X1, chaveDeTeste, enviarObjetoDeTeste } from '../test/produtos.js';

// Estes testes usam o S3 REAL do compose (SeaweedFS, serviço `s3`), com chaves de uma Casa fictícia.
const CASA = 987_654;
const criadas: string[] = [];
afterAll(async () => {
  await apagarObjetos(criadas);
});

const put = (url: string, corpo: Buffer, tipo = 'image/png') =>
  fetch(url, { method: 'PUT', headers: { 'Content-Type': tipo }, body: new Uint8Array(corpo) });

describe('chaves', () => {
  it('geradas pelo servidor, únicas, com o prefixo da Casa', () => {
    const a = gerarChaveFoto(CASA, 'PNG');
    const b = gerarChaveFoto(CASA, 'JPEG');
    expect(a.startsWith(prefixoDaCasa(CASA))).toBe(true);
    expect(a.endsWith('.png')).toBe(true);
    expect(b.endsWith('.jpg')).toBe(true);
    expect(a).not.toBe(b);
  });

  it('chaveEhDaCasa recusa chave de outra Casa, com caminho forjado ou fora do formato', () => {
    const chave = gerarChaveFoto(CASA, 'PNG');
    expect(chaveEhDaCasa(chave, CASA)).toBe(true);
    expect(chaveEhDaCasa(chave, CASA + 1)).toBe(false);
    expect(chaveEhDaCasa(`casas/${CASA}/fotos/../../2/fotos/x.png`, CASA)).toBe(false);
    expect(chaveEhDaCasa(`casas/${CASA}/fotos/abc.png`, CASA)).toBe(false);
    expect(chaveEhDaCasa(`casas/${CASA}0/fotos/${chave.split('/').pop()}`, CASA)).toBe(false);
  });

  it('chave de envio fica em pendentes/, nunca é aceita como definitiva e vira a definitiva com o mesmo UUID', () => {
    const envio = gerarChaveEnvio(CASA, 'JPEG');
    expect(envio.startsWith(prefixoPendentesDaCasa(CASA))).toBe(true);
    expect(chaveEnvioEhDaCasa(envio, CASA)).toBe(true);
    expect(chaveEnvioEhDaCasa(envio, CASA + 1)).toBe(false);
    expect(chaveEhDaCasa(envio, CASA)).toBe(false);
    const final = chaveFinalDoEnvio(envio);
    expect(chaveEhDaCasa(final, CASA)).toBe(true);
    expect(chaveEnvioEhDaCasa(final, CASA)).toBe(false);
    expect(final.split('/').pop()).toBe(envio.split('/').pop());
  });
});

describe('URL assinada de envio e operações do backend (S3 real)', () => {
  it('PUT com a URL assinada funciona e HEAD/bytes/tipo refletem o objeto', async () => {
    const chave = chaveDeTeste(CASA);
    criadas.push(chave);
    const envio = await assinarEnvio(chave, 'PNG', PNG_1X1.length);
    expect(envio.metodo).toBe('PUT');
    expect(envio.cabecalhos['Content-Type']).toBe('image/png');
    expect(envio.expiraEm.getTime()).toBeGreaterThan(Date.now());
    expect((await put(envio.url, PNG_1X1)).status).toBe(200);

    expect((await obterMetadados(chave))?.tamanhoBytes).toBe(PNG_1X1.length);
    expect((await lerPrimeirosBytes(chave, 8))?.length).toBe(8);
    expect(await inspecionarObjeto(chave)).toEqual({ tamanhoBytes: PNG_1X1.length, tipo: 'PNG' });
  });

  it('a assinatura fixa tamanho e tipo: corpo maior ou Content-Type diferente é recusado (403)', async () => {
    const chave = chaveDeTeste(CASA);
    criadas.push(chave);
    const envio = await assinarEnvio(chave, 'PNG', PNG_1X1.length);
    expect((await put(envio.url, Buffer.concat([PNG_1X1, PNG_1X1]))).status).toBe(403);
    expect((await put(envio.url, PNG_1X1, 'image/gif')).status).toBe(403);
    expect(await obterMetadados(chave)).toBeNull();
  });

  it('URL vencida é recusada', async () => {
    const chave = chaveDeTeste(CASA);
    const envio = await assinarEnvio(chave, 'PNG', PNG_1X1.length, 1);
    await new Promise((r) => setTimeout(r, 2500));
    expect((await put(envio.url, PNG_1X1)).status).toBe(403);
  });

  it('inspecionarObjeto detecta o tipo REAL, não o declarado (PNG enviado como .jpg → PNG; texto → null)', async () => {
    const png = await enviarObjetoDeTeste(CASA, PNG_1X1, 'jpg');
    const jpg = await enviarObjetoDeTeste(CASA, JPEG_MINIMO, 'jpg');
    const texto = await enviarObjetoDeTeste(CASA, Buffer.from('não sou imagem, apenas texto'), 'png');
    criadas.push(png, jpg, texto);
    expect((await inspecionarObjeto(png))?.tipo).toBe('PNG');
    expect((await inspecionarObjeto(jpg))?.tipo).toBe('JPEG');
    expect((await inspecionarObjeto(texto))?.tipo).toBeNull();
  });

  it('objeto inexistente: metadados, bytes e inspeção devolvem null', async () => {
    const chave = chaveDeTeste(CASA);
    expect(await obterMetadados(chave)).toBeNull();
    expect(await lerPrimeirosBytes(chave)).toBeNull();
    expect(await inspecionarObjeto(chave)).toBeNull();
  });

  it('URL de leitura assinada devolve a imagem; sem assinatura o bucket não é público', async () => {
    const chave = await enviarObjetoDeTeste(CASA, PNG_1X1);
    criadas.push(chave);
    const leitura = await fetch(await assinarLeitura(chave));
    expect(leitura.status).toBe(200);
    expect(leitura.headers.get('content-type')).toBe('image/png');
    // Cabeçalhos fixos na assinatura (AppSec FD6).
    expect(leitura.headers.get('content-disposition')).toBe('inline');
    expect(leitura.headers.get('cache-control')).toMatch(/^private/);
    expect(Buffer.from(await leitura.arrayBuffer()).equals(PNG_1X1)).toBe(true);
    const semAssinatura = (await assinarLeitura(chave)).split('?')[0]!;
    expect((await fetch(semAssinatura)).status).toBe(403);
  });

  it('a URL de leitura vale no máximo 15 minutos e leva os parâmetros response-* assinados', async () => {
    const url = new URL(await assinarLeitura(chaveDeTeste(CASA, 'jpg')));
    expect(Number(url.searchParams.get('X-Amz-Expires'))).toBeLessThanOrEqual(900);
    expect(url.searchParams.get('response-content-type')).toBe('image/jpeg');
    expect(url.searchParams.get('response-content-disposition')).toBe('inline');
    expect(url.searchParams.get('response-cache-control')).toMatch(/^private/);
  });

  it('listar, apagar um e apagar vários (idempotente)', async () => {
    const [a, b, c] = [await enviarObjetoDeTeste(CASA, PNG_1X1), await enviarObjetoDeTeste(CASA, PNG_1X1), await enviarObjetoDeTeste(CASA, PNG_1X1)];
    criadas.push(a, b, c);
    const lista = await listarObjetos(prefixoRaizDaCasa(CASA));
    expect(lista.objetos.map((o) => o.chave)).toEqual(expect.arrayContaining([a, b, c]));
    expect(lista.objetos.every((o) => o.modificadoEm instanceof Date)).toBe(true);

    await apagarObjeto(a);
    await apagarObjeto(a); // de novo: sem erro
    expect(await obterMetadados(a)).toBeNull();
    expect(await apagarObjetos([b, c, chaveDeTeste(CASA)])).toEqual([]);
    expect(await obterMetadados(b)).toBeNull();
    expect(await apagarObjetos([])).toEqual([]);
  });

  it('apagarPrefixo remove tudo da Casa e nada das outras', async () => {
    const casaA = 987_001;
    const casaB = 987_002;
    const a = [await enviarObjetoDeTeste(casaA, PNG_1X1), await enviarObjetoDeTeste(casaA, PNG_1X1)];
    const b = await enviarObjetoDeTeste(casaB, PNG_1X1);
    criadas.push(...a, b);
    expect(await apagarPrefixo(prefixoRaizDaCasa(casaA))).toEqual({ apagados: 2, falhas: 0 });
    expect(await obterMetadados(a[0]!)).toBeNull();
    expect(await obterMetadados(b)).not.toBeNull();
  });
});
