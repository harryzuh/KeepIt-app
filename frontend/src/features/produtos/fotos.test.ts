import { BYTES_JPEG, BYTES_PNG, arquivoDeTeste, mockarApi, mockarPutS3 } from '@/test/produtos';
import { ApiError } from '@/lib/api';
import { detectarTipo, enviarFoto, MAX_BYTES_FOTO, validarArquivo } from './fotos';

const uploadUrl = (n = 1) => ({
  chave: `casas/4/fotos/${n}.png`,
  url: 'http://s3:9000/keepit-fotos/casas/4/fotos/x.png?X-Amz-Signature=abc',
  metodo: 'PUT',
  cabecalhos: { 'Content-Type': 'image/png' },
  expiraEm: '2026-11-15T17:05:00.000Z',
  confirmarAte: '2026-11-15T19:00:00.000Z',
});

describe('validação de arquivo de foto', () => {
  it('reconhece JPEG e PNG pelos bytes', () => {
    expect(detectarTipo(Uint8Array.from(BYTES_JPEG))).toBe('JPEG');
    expect(detectarTipo(Uint8Array.from(BYTES_PNG))).toBe('PNG');
    expect(detectarTipo(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBeNull(); // GIF
  });

  it('aceita JPEG e PNG de verdade', async () => {
    expect(await validarArquivo(arquivoDeTeste('a.jpg', BYTES_JPEG, 'image/jpeg'))).toEqual({ ok: true, tipo: 'JPEG' });
    expect(await validarArquivo(arquivoDeTeste('a.png', BYTES_PNG, 'image/png'))).toEqual({ ok: true, tipo: 'PNG' });
  });

  it('recusa arquivo com extensão de imagem mas conteúdo de outro tipo', async () => {
    const falso = arquivoDeTeste('virus.png', [0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0], 'image/png');
    expect(await validarArquivo(falso)).toEqual({ ok: false, codigo: 'ARQUIVO_INVALIDO' });
  });

  it('recusa acima de 5 MB e arquivo vazio; aceita exatamente 5 MB', async () => {
    expect((await validarArquivo(arquivoDeTeste('g.png', BYTES_PNG, 'image/png', MAX_BYTES_FOTO + 1))).ok).toBe(false);
    expect((await validarArquivo(arquivoDeTeste('v.png', BYTES_PNG, 'image/png', 0))).ok).toBe(false);
    expect((await validarArquivo(arquivoDeTeste('c.png', BYTES_PNG, 'image/png', MAX_BYTES_FOTO))).ok).toBe(true);
  });
});

describe('envio da foto por URL assinada', () => {
  it('na troca de foto envia substituiFotoIds no pedido da URL', async () => {
    const f = mockarApi({ 'POST /produtos/fotos/upload-url': { corpo: uploadUrl() } });
    mockarPutS3();
    await enviarFoto(arquivoDeTeste('a.png', BYTES_PNG, 'image/png', 4000), 'PNG', () => {}, [12]);
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({ tipo: 'image/png', tamanhoBytes: 4000, substituiFotoIds: [12] });
  });

  it('pede a URL, faz o PUT com os cabeçalhos assinados e devolve a chave', async () => {
    const f = mockarApi({ 'POST /produtos/fotos/upload-url': { corpo: uploadUrl() } });
    const puts = mockarPutS3();
    const arq = arquivoDeTeste('a.png', BYTES_PNG, 'image/png', 4000);
    const progresso: number[] = [];
    const chave = await enviarFoto(arq, 'PNG', (p) => progresso.push(p));

    expect(chave).toBe('casas/4/fotos/1.png');
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({ tipo: 'image/png', tamanhoBytes: 4000 });
    expect(puts).toHaveLength(1);
    expect(puts[0].metodo).toBe('PUT');
    expect(puts[0].cabecalhos).toEqual({ 'Content-Type': 'image/png' });
    expect(puts[0].corpo).toBe(arq);
    expect(puts[0].url).toContain('X-Amz-Signature=abc');
    expect(progresso).toContain(50);
    expect(progresso.at(-1)).toBe(100);
  });

  it('403 do S3 (URL vencida) pede outra URL e tenta de novo', async () => {
    let n = 0;
    const f = mockarApi({ 'POST /produtos/fotos/upload-url': () => ({ corpo: uploadUrl(++n) }) });
    const puts = mockarPutS3([403, 200]);
    const chave = await enviarFoto(arquivoDeTeste('a.png', BYTES_PNG, 'image/png'), 'PNG', () => {});
    expect(chave).toBe('casas/4/fotos/2.png');
    expect(puts).toHaveLength(2);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('falha persistente vira ENVIO_FOTO_FALHOU e sem rede vira SEM_CONEXAO', async () => {
    mockarApi({ 'POST /produtos/fotos/upload-url': { corpo: uploadUrl() } });
    mockarPutS3([500]);
    await expect(enviarFoto(arquivoDeTeste('a.png', BYTES_PNG, 'image/png'), 'PNG', () => {})).rejects.toMatchObject({ codigo: 'ENVIO_FOTO_FALHOU' });
    mockarPutS3([0]);
    await expect(enviarFoto(arquivoDeTeste('a.png', BYTES_PNG, 'image/png'), 'PNG', () => {})).rejects.toMatchObject({ codigo: 'SEM_CONEXAO' });
  });

  it('COTA_EXCEDIDA do upload-url sobe como ApiError e não faz PUT', async () => {
    mockarApi({ 'POST /produtos/fotos/upload-url': { status: 409, corpo: { error: 'COTA_EXCEDIDA', message: 'x', details: { plano: 'INDIVIDUAL', usadoBytes: 10, limiteBytes: 10 } } } });
    const puts = mockarPutS3();
    const e = await enviarFoto(arquivoDeTeste('a.png', BYTES_PNG, 'image/png'), 'PNG', () => {}).catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.codigo).toBe('COTA_EXCEDIDA');
    expect(puts).toHaveLength(0);
  });
});
