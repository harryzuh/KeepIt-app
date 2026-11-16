/**
 * Carga de volume para medir o desempenho das estatísticas (M4, RNF06).
 *
 * Cria (ou reaproveita) uma Casa PRÓPRIA da carga, nunca a demo, e a enche de produtos e tags
 * com preços e quantidades variados (inclui o teto, para exercitar a precisão do dinheiro).
 * Depois mede o tempo de GET /estatisticas/resumo e GET /estatisticas pela API (se as rotas existirem).
 *
 * Uso (pelo Makefile): `make carga` (2.000 produtos) ou `make seed-volume` (10.000 produtos, 200 tags).
 * Ajustes por variável de ambiente: CARGA_PRODUTOS, CARGA_TAGS, CARGA_EMAIL, CARGA_API_URL.
 *
 * Idempotente: recria os produtos e tags da Casa da carga a cada execução. Não roda em NODE_ENV=production.
 */
import { PrismaClient } from '@prisma/client';
import { PLANOS_PADRAO } from '../src/lib/planos.js';
import { hashSenha } from '../src/lib/senha.js';

const prisma = new PrismaClient();

const PRODUTOS = Number(process.env.CARGA_PRODUTOS ?? 2000);
const TAGS = Number(process.env.CARGA_TAGS ?? 200);
const EMAIL = process.env.CARGA_EMAIL ?? 'carga@keepit.local';
const SENHA = 'keepit-carga-123'; // só local; o script recusa produção
const API_URL = process.env.CARGA_API_URL ?? `http://localhost:${process.env.PORT ?? 3333}`;

async function casaDaCarga(): Promise<{ casaId: number; usuarioId: number }> {
  for (const p of PLANOS_PADRAO) {
    await prisma.plano.upsert({ where: { nome: p.nome }, update: {}, create: { ...p } });
  }
  const existente = await prisma.usuario.findUnique({ where: { email: EMAIL }, include: { membro: true } });
  if (existente?.membro) return { casaId: existente.membro.casaId, usuarioId: existente.id };
  return prisma.$transaction(async (tx) => {
    const usuario = await tx.usuario.create({
      data: { nome: 'Carga Volume', email: EMAIL, senhaHash: await hashSenha(SENHA) },
    });
    const casa = await tx.casa.create({ data: { nome: 'Casa da carga' } });
    await tx.membro.create({ data: { usuarioId: usuario.id, casaId: casa.id, papel: 'ADMIN' } });
    return { casaId: casa.id, usuarioId: usuario.id };
  });
}

async function popular(casaId: number, usuarioId: number) {
  await prisma.produto.deleteMany({ where: { casaId } });
  await prisma.tag.deleteMany({ where: { casaId } });

  // Tags em lote (SQL parametrizado).
  await prisma.$executeRaw`
    INSERT INTO tag (casa_id, nome)
    SELECT ${casaId}, 'Tag ' || lpad(g::text, 3, '0') FROM generate_series(1, ${TAGS}::int) g`;

  // Produtos em lote. Preço de 0,00 a ~5.000,00, com alguns no teto e alguns zerados;
  // quantidade de 1 a 20, com alguns no teto (1.000.000). dataCompra em ~5 anos; nomes únicos por Casa.
  await prisma.$executeRaw`
    INSERT INTO produto (casa_id, adicionado_por_id, nome, descricao, preco, quantidade, data_compra, data_cadastro, atualizado_em)
    SELECT ${casaId}, ${usuarioId},
           'Item de carga ' || lpad(g::text, 6, '0'),
           NULL,
           CASE WHEN g % 997 = 0 THEN 9999999999.99
                WHEN g % 211 = 0 THEN 0.00
                ELSE round((random() * 5000)::numeric, 2) END,
           CASE WHEN g % 991 = 0 THEN 1000000 ELSE 1 + (random() * 19)::int END,
           (current_date - (random() * 1825)::int),
           now() - (g || ' minutes')::interval,
           now()
    FROM generate_series(1, ${PRODUTOS}::int) g`;

  // Vínculos: ~80% dos produtos com 1 tag; ~20% do total com uma 2ª tag (sobreposição); ~20% sem tag.
  await prisma.$executeRaw`
    INSERT INTO produto_tag (produto_id, tag_id)
    SELECT p.id, t.id
    FROM (SELECT id, row_number() OVER (ORDER BY id) AS n FROM produto WHERE casa_id = ${casaId}) p
    JOIN (SELECT id, row_number() OVER (ORDER BY id) AS n FROM tag WHERE casa_id = ${casaId}) t
      ON t.n = 1 + (p.n * 7) % ${TAGS}::int
    WHERE p.n % 5 <> 0
    ON CONFLICT DO NOTHING`;
  await prisma.$executeRaw`
    INSERT INTO produto_tag (produto_id, tag_id)
    SELECT p.id, t.id
    FROM (SELECT id, row_number() OVER (ORDER BY id) AS n FROM produto WHERE casa_id = ${casaId}) p
    JOIN (SELECT id, row_number() OVER (ORDER BY id) AS n FROM tag WHERE casa_id = ${casaId}) t
      ON t.n = 1 + (p.n * 13 + 5) % ${TAGS}::int
    WHERE p.n % 5 = 1
    ON CONFLICT DO NOTHING`;
}

async function medir() {
  const login = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, senha: SENHA }),
  }).catch(() => null);
  if (!login?.ok) {
    console.log(`Medição pulada: login em ${API_URL} falhou (${login?.status ?? 'sem resposta'}). A API está de pé?`);
    return;
  }
  const { token } = (await login.json()) as { token: string };
  for (const rota of ['/estatisticas/resumo', '/estatisticas']) {
    const tempos: number[] = [];
    let status = 0;
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const r = await fetch(`${API_URL}${rota}`, { headers: { Authorization: `Bearer ${token}` } });
      await r.arrayBuffer();
      tempos.push(performance.now() - t0);
      status = r.status;
    }
    const o = [...tempos].sort((a, b) => a - b);
    const nota = status === 200 ? '' : '  (rota ainda não implementada ou com erro)';
    console.log(
      `GET ${rota.padEnd(22)} HTTP ${status}  min ${o[0].toFixed(0)} ms  mediana ${o[2].toFixed(0)} ms  max ${o[4].toFixed(0)} ms${nota}`,
    );
  }
  console.log('Meta (ADR 0004): menos de 500 ms por rota e menos de 2 s na tela (RNF06).');
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('A carga não roda em produção.');
  if (!Number.isInteger(PRODUTOS) || PRODUTOS < 1 || !Number.isInteger(TAGS) || TAGS < 1) {
    throw new Error('CARGA_PRODUTOS e CARGA_TAGS devem ser inteiros positivos.');
  }
  const { casaId, usuarioId } = await casaDaCarga();
  const t0 = Date.now();
  await popular(casaId, usuarioId);
  const [{ n: produtos }] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM produto WHERE casa_id = ${casaId}`;
  const [{ n: vinculos }] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM produto_tag pt JOIN produto p ON p.id = pt.produto_id WHERE p.casa_id = ${casaId}`;
  console.log(
    `Carga pronta em ${((Date.now() - t0) / 1000).toFixed(1)} s: Casa ${casaId} (${EMAIL}), ${produtos} produtos, ${TAGS} tags, ${vinculos} vínculos.`,
  );
  await medir();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
