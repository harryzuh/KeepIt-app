import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';

// Custo baixo nos testes para não deixar a suíte lenta; 12 em produção (RNF02).
const CUSTO = env.NODE_ENV === 'test' ? 4 : env.NODE_ENV === 'production' ? 12 : 10;

/** Hash de referência usado quando o usuário não existe, para igualar o tempo de resposta do login. */
const HASH_FANTASMA = bcrypt.hashSync('senha-fantasma-keepit', CUSTO);

/** Gera o hash bcrypt da senha (RNF02). Nunca guarde nem registre a senha em texto puro. */
export function hashSenha(senha: string): Promise<string> {
  return bcrypt.hash(senha, CUSTO);
}

/**
 * Confere a senha com o hash. Se `hash` for nulo (usuário inexistente), compara com um hash falso
 * e devolve false, evitando diferença de tempo que revele se o e-mail existe.
 */
export async function conferirSenha(senha: string, hash: string | null | undefined): Promise<boolean> {
  const ok = await bcrypt.compare(senha, hash ?? HASH_FANTASMA);
  return hash ? ok : false;
}
