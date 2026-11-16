import type { NomePlano, Papel, StatusAssinatura, Usuario } from '@prisma/client';
import type { Test } from 'supertest';
import { expect } from 'vitest';
import { adicionarMeses } from '../lib/datas.js';
import { assinarToken } from '../lib/jwt.js';
import { prisma } from '../lib/prisma.js';
import { criarUsuarioComCasa } from './db.js';

/** Helpers de teste para montar Casas com membros de cada papel e exercitar a matriz de permissões (RNF31). */

export interface MembroDeTeste {
  usuario: Usuario;
  token: string;
  papel: Papel;
}

export interface CasaDeTeste {
  casaId: number;
  admin: MembroDeTeste;
  /** Primeiro EDITOR e primeiro LEITOR (existem só se foram pedidos). */
  editor?: MembroDeTeste;
  leitor?: MembroDeTeste;
  editores: MembroDeTeste[];
  leitores: MembroDeTeste[];
  /** Todos, ADMIN primeiro, na ordem de entrada. */
  membros: MembroDeTeste[];
}

export interface OpcoesCasa {
  /** Quantos EDITORes e LEITOREs criar (padrão 1 de cada). */
  editores?: number;
  leitores?: number;
  /** Cria uma assinatura para a Casa (titular = ADMIN). Sem isso a Casa é Individual. */
  assinatura?: NomePlano | { plano: NomePlano; status?: StatusAssinatura; dataRenovacao?: Date };
  /** Prefixo dos e-mails, para depurar. */
  prefixo?: string;
}

let contador = 0;

async function criarMembro(casaId: number, papel: Papel, prefixo: string): Promise<MembroDeTeste> {
  contador += 1;
  const { usuario } = await criarUsuarioComCasa({
    nome: `${papel} ${prefixo} ${contador}`,
    email: `${prefixo}-${papel.toLowerCase()}-${contador}-${Date.now()}@keepit.test`,
    papel,
    casaId,
  });
  return { usuario, token: assinarToken(usuario.id), papel };
}

/** Cria uma assinatura direto no banco (atalho de teste; não passa pelo pagamento simulado). */
export async function criarAssinaturaDeTeste(
  casaId: number,
  titularId: number | null,
  plano: NomePlano,
  opcoes: { status?: StatusAssinatura; dataRenovacao?: Date; dataInicio?: Date } = {},
) {
  const registro = await prisma.plano.findUniqueOrThrow({ where: { nome: plano } });
  const dataInicio = opcoes.dataInicio ?? new Date();
  const status = opcoes.status ?? 'ATIVA';
  return prisma.assinatura.create({
    data: {
      casaId,
      planoId: registro.id,
      titularId,
      status,
      dataInicio,
      dataRenovacao: opcoes.dataRenovacao ?? adicionarMeses(dataInicio, 1),
      dataCancelamento: status === 'CANCELADA' ? new Date() : null,
    },
  });
}

/**
 * Monta uma Casa com um ADMIN e N editores/leitores (padrão 1 de cada), cada um com token válido.
 * Ignora o limite do plano de propósito (grava direto no banco), para testar também Casas "estouradas".
 */
export async function montarCasa(opcoes: OpcoesCasa = {}): Promise<CasaDeTeste> {
  const prefixo = opcoes.prefixo ?? 'casa';
  contador += 1;
  const casa = await prisma.casa.create({ data: { nome: `Casa de teste ${contador}` } });
  const admin = await criarMembro(casa.id, 'ADMIN', prefixo);
  const editores: MembroDeTeste[] = [];
  const leitores: MembroDeTeste[] = [];
  for (let i = 0; i < (opcoes.editores ?? 1); i++) editores.push(await criarMembro(casa.id, 'EDITOR', prefixo));
  for (let i = 0; i < (opcoes.leitores ?? 1); i++) leitores.push(await criarMembro(casa.id, 'LEITOR', prefixo));
  if (opcoes.assinatura) {
    const a = typeof opcoes.assinatura === 'string' ? { plano: opcoes.assinatura } : opcoes.assinatura;
    await criarAssinaturaDeTeste(casa.id, admin.usuario.id, a.plano, a);
  }
  return {
    casaId: casa.id,
    admin,
    editor: editores[0],
    leitor: leitores[0],
    editores,
    leitores,
    membros: [admin, ...editores, ...leitores],
  };
}

/** Papéis da matriz de permissões (RNF31). `outraCasa` é o ADMIN de uma Casa distinta. */
export type PapelDaMatriz = 'semToken' | 'ADMIN' | 'EDITOR' | 'LEITOR' | 'outraCasa';

export type MatrizEsperada = Record<PapelDaMatriz, number>;

/**
 * Executa a mesma requisição como visitante, ADMIN, EDITOR, LEITOR e ADMIN de outra Casa, e confere o HTTP de cada um.
 * `chamar` recebe o token (ou `undefined` sem token) e devolve a requisição do supertest, ex.:
 * `(t) => request(app).get('/casa/membros').set(...autorizacao(t))`.
 * Cada chamada é executada em sequência (as rotas que alteram dados veem o estado da chamada anterior:
 * monte a `casa` com membros suficientes ou use `esperados` para as rotas idempotentes).
 */
export async function testarMatrizDePapeis(
  casa: CasaDeTeste,
  chamar: (token: string | undefined, quem: PapelDaMatriz) => Test | Promise<{ status: number }>,
  esperados: MatrizEsperada,
  outraCasa?: CasaDeTeste,
): Promise<void> {
  const outra = outraCasa ?? (await montarCasa({ editores: 0, leitores: 0, prefixo: 'outra' }));
  const tokens: Record<PapelDaMatriz, string | undefined> = {
    semToken: undefined,
    ADMIN: casa.admin.token,
    EDITOR: casa.editor?.token,
    LEITOR: casa.leitor?.token,
    outraCasa: outra.admin.token,
  };
  const ordem: PapelDaMatriz[] = ['semToken', 'LEITOR', 'EDITOR', 'outraCasa', 'ADMIN'];
  for (const quem of ordem) {
    if (quem !== 'semToken' && tokens[quem] === undefined) throw new Error(`Casa de teste sem ${quem}`);
    const resposta = await chamar(tokens[quem], quem);
    expect(resposta.status, `matriz de papéis: ${quem}`).toBe(esperados[quem]);
  }
}

/** Cabeçalho `Authorization` para o supertest: `.set(...autorizacao(token))` (sem token, não envia nada). */
export function autorizacao(token: string | undefined): [string, string] {
  return ['Authorization', token ? `Bearer ${token}` : ''];
}
