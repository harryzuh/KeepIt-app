import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { gerarCodigoNumerico, conferirCodigo, expiracaoDoCodigo, hashCodigo } from './codigo.js';
import { HttpError } from './http-error.js';
import { assinarToken, verificarToken } from './jwt.js';
import { caixaDeSaida, enviarEmailCodigo } from './mailer.js';
import { conferirSenha, hashSenha } from './senha.js';

describe('jwt', () => {
  it('assina e verifica o token com id e iat', () => {
    const dados = verificarToken(assinarToken(42));
    expect(dados.usuarioId).toBe(42);
    expect(dados.emitidoEm).toBeGreaterThan(0);
  });

  it('rejeita token adulterado com NAO_AUTENTICADO', () => {
    expect(() => verificarToken(assinarToken(1) + 'x')).toThrowError(
      expect.objectContaining({ status: 401, codigo: 'NAO_AUTENTICADO' }),
    );
  });

  it('rejeita token expirado com SESSAO_EXPIRADA', () => {
    const vencido = jwt.sign({}, env.JWT_SECRET, { subject: '1', expiresIn: -10 });
    expect(() => verificarToken(vencido)).toThrowError(
      expect.objectContaining({ status: 401, codigo: 'SESSAO_EXPIRADA' }),
    );
  });

  it('rejeita token assinado com outro segredo', () => {
    const falso = jwt.sign({}, 'outro-segredo-qualquer-123', { subject: '1' });
    expect(() => verificarToken(falso)).toThrow(HttpError);
  });
});

describe('senha', () => {
  it('gera hash bcrypt e confere', async () => {
    const hash = await hashSenha('minha-senha-123');
    expect(hash).not.toContain('minha-senha-123');
    expect(await conferirSenha('minha-senha-123', hash)).toBe(true);
    expect(await conferirSenha('outra-senha', hash)).toBe(false);
  });

  it('devolve false quando o usuário não existe (hash nulo)', async () => {
    expect(await conferirSenha('qualquer', null)).toBe(false);
  });
});

describe('codigo', () => {
  it('gera 6 dígitos numéricos', () => {
    for (let i = 0; i < 50; i++) expect(gerarCodigoNumerico()).toMatch(/^\d{6}$/);
  });

  it('o hash é amarrado ao contexto', () => {
    const hash = hashCodigo('123456', '1:RECUPERAR_SENHA');
    expect(conferirCodigo('123456', hash, '1:RECUPERAR_SENHA')).toBe(true);
    expect(conferirCodigo('123457', hash, '1:RECUPERAR_SENHA')).toBe(false);
    expect(conferirCodigo('123456', hash, '2:RECUPERAR_SENHA')).toBe(false);
    expect(conferirCodigo('123456', 'lixo', '1:RECUPERAR_SENHA')).toBe(false);
  });

  it('expira em 15 minutos', () => {
    const agora = new Date('2026-01-01T10:00:00Z');
    expect(expiracaoDoCodigo(agora).toISOString()).toBe('2026-01-01T10:15:00.000Z');
  });
});

describe('mailer', () => {
  it('em teste guarda o e-mail com o código na caixa de saída', async () => {
    caixaDeSaida.length = 0;
    await enviarEmailCodigo({ para: 'a@b.com', nome: 'Ana', codigo: '123456', finalidade: 'RECUPERAR_SENHA' });
    expect(caixaDeSaida).toHaveLength(1);
    expect(caixaDeSaida[0]?.texto).toContain('123456');
    expect(caixaDeSaida[0]?.texto).toContain('15 minutos');
  });
});
