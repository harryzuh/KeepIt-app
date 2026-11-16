import pg from 'pg';

/**
 * Acesso direto ao Postgres só para MONTAR cenários que a API não permite montar barato
 * (ex.: encher a cota de armazenamento sem enviar 1 GB). Nunca usado para validar resultado de fluxo.
 */
const URL_DB = process.env.E2E_DB_URL ?? (process.env.E2E_API_URL ? 'postgresql://keepit:keepit@db:5432/keepit' : 'postgresql://keepit:keepit@localhost:5432/keepit');

export async function sql<T = any>(consulta: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: URL_DB });
  await c.connect();
  try {
    return (await c.query(consulta, params)).rows as T[];
  } finally {
    await c.end();
  }
}

/** Marca `bytes` como já usados na Casa do usuário, inserindo uma foto "fantasma" num produto dele (sem objeto no S3). */
export async function ocuparArmazenamento(produtoId: number, bytes: number) {
  const chave = `casas/0/fotos/qa-fantasma-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`;
  await sql(
    `insert into foto (produto_id, chave, tipo, tamanho_bytes, ordem) values ($1, $2, 'PNG', $3, (select coalesce(max(ordem)+1,0) from foto where produto_id=$1))`,
    [produtoId, chave, bytes],
  );
  return chave;
}

export async function casaIdDoUsuario(usuarioId: number): Promise<number> {
  const r = await sql<{ casa_id: number }>('select casa_id from membro where usuario_id = $1', [usuarioId]);
  return r[0].casa_id;
}
