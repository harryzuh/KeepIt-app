import { z } from 'zod';
import '../../config/zod.js';
import { idSchema } from '../../lib/campos.js';
import { normalizarLinha, normalizarTexto, temControleOuFormatacao, temControleOuFormatacaoExcetoQuebras } from '../../lib/texto.js';

/**
 * CONTRATO · schemas Zod do M3 Produtos (docs/api/m3-produtos.md, seções 1 e 3). O front-end se baseia nestes campos.
 * Os limites abaixo valem para cadastro e edição.
 */

export const NOME_MAX = 120;
export const DESCRICAO_MAX = 1000;
export const QUANTIDADE_MAX = 1_000_000;
export const PRECO_MAX = '9999999999.99';
export const TAGS_MAX = 10;
export const FOTOS_MAX = 3;
/** Teto só para o corpo não ser absurdo; acima de 3 fotos a resposta é LIMITE_FOTOS (422). */
const FOTOS_TETO_DO_CORPO = 20;
export const FOTO_TAMANHO_MAX_BYTES = 5 * 1024 * 1024;

// ---------------------------------------------------------------- campos

const MSG_CARACTERES = 'não pode conter caracteres de controle ou invisíveis';

/** Nome: sem controle/invisíveis (\p{Cc}, \p{Cf}), NFC, espaços internos reduzidos a um e sem < ou >. */
export const nomeProdutoSchema = z
  .string({ error: 'Informe o nome do produto' })
  .refine((s) => !temControleOuFormatacao(s), `O nome ${MSG_CARACTERES}`)
  .transform((s) => normalizarLinha(s).trim())
  .pipe(
    z
      .string()
      .min(1, 'Informe o nome do produto')
      .max(NOME_MAX, `O nome deve ter até ${NOME_MAX} caracteres`)
      .refine((s) => !/[<>]/.test(s), 'O nome não pode conter < ou >'),
  );

/** Descrição opcional: vazio vira `null`; quebra de linha e tabulação são permitidas, os demais controles e invisíveis não. NFC. */
export const descricaoSchema = z
  .string({ error: 'Descrição inválida' })
  .refine((s) => !temControleOuFormatacaoExcetoQuebras(s), `A descrição ${MSG_CARACTERES}`)
  .transform((s) => normalizarTexto(s).trim())
  .pipe(
    z
      .string()
      .max(DESCRICAO_MAX, `A descrição deve ter até ${DESCRICAO_MAX} caracteres`)
      .refine((s) => !/[<>]/.test(s), 'A descrição não pode conter < ou >')
      .transform((s) => (s === '' ? null : s)),
  )
  .nullable();

/** Preço: SEMPRE string decimal com ponto ("1234.50", até 2 casas). Número JSON é recusado (binário perde centavos). */
export const precoSchema = z
  .string({ error: 'Informe o preço como texto decimal com ponto (ex.: "1234.50")' })
  .transform((v, ctx) => {
    const texto = v.trim();
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(texto)) {
      ctx.addIssue({ code: 'custom', message: 'Preço inválido: use número com ponto e até 2 casas (ex.: 1234.50)' });
      return z.NEVER;
    }
    const [inteiro, centavos = ''] = texto.split('.');
    const normalizado = `${BigInt(inteiro!)}.${centavos.padEnd(2, '0')}`;
    if (BigInt(inteiro!) * 100n + BigInt(centavos.padEnd(2, '0')) > BigInt(PRECO_MAX.replace('.', ''))) {
      ctx.addIssue({ code: 'custom', message: 'O preço máximo é 9999999999.99' });
      return z.NEVER;
    }
    return normalizado;
  });

export const quantidadeSchema = z
  .number({ error: 'Informe a quantidade' })
  .int('A quantidade deve ser um número inteiro')
  .min(1, 'A quantidade mínima é 1')
  .max(QUANTIDADE_MAX, `A quantidade máxima é ${QUANTIDADE_MAX}`);

/** Data de hoje (AAAA-MM-DD) em America/Sao_Paulo. */
export function hojeEmSaoPaulo(agora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora);
}

/** Piso da data da compra (evita datas absurdas como 0001-01-01). */
export const DATA_COMPRA_MINIMA = '1900-01-01';

export const dataCompraSchema = z
  .string({ error: 'Informe a data da compra' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida: use AAAA-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Data inválida')
  // AAAA-MM-DD compara certo como texto.
  .refine((s) => s >= DATA_COMPRA_MINIMA, `A data da compra não pode ser anterior a ${DATA_COMPRA_MINIMA}`)
  .refine((s) => s <= hojeEmSaoPaulo(), 'A data da compra não pode ser futura');

export const tagIdsSchema = z
  .array(z.number({ error: 'Tag inválida' }).int('Tag inválida').positive('Tag inválida').max(2_147_483_647, 'Tag inválida'), {
    error: 'Tags inválidas',
  })
  .max(TAGS_MAX, `Um produto aceita até ${TAGS_MAX} tags`)
  .refine((ids) => new Set(ids).size === ids.length, 'Há tags repetidas');

const chaveSchema = z.string({ error: 'Chave da foto inválida' }).trim().min(1, 'Chave da foto inválida').max(300, 'Chave da foto inválida');

const fotoNovaSchema = z.object({ chave: chaveSchema });
const fotoExistenteSchema = z.object({ id: idSchema });

const fotosCadastroSchema = z.array(fotoNovaSchema, { error: 'Fotos inválidas' }).max(FOTOS_TETO_DO_CORPO, 'Fotos demais');
const fotosEdicaoSchema = z
  .array(z.union([fotoExistenteSchema, fotoNovaSchema], { error: 'Informe { id } ou { chave }' }), { error: 'Fotos inválidas' })
  .max(FOTOS_TETO_DO_CORPO, 'Fotos demais');

/** Falha se o mesmo item (chave ou id) aparece duas vezes. */
function semRepetidas(fotos: ({ id: number } | { chave: string })[]): boolean {
  const vistos = new Set(fotos.map((f) => ('id' in f ? `id:${f.id}` : `chave:${f.chave}`)));
  return vistos.size === fotos.length;
}

// ---------------------------------------------------------------- corpos

export const DUPLICADO_OPCOES = ['SOMAR', 'CADASTRAR_MESMO_ASSIM'] as const;

export const criarProdutoSchema = z
  .object({
    nome: nomeProdutoSchema,
    descricao: descricaoSchema.optional(),
    preco: precoSchema,
    quantidade: quantidadeSchema,
    dataCompra: dataCompraSchema,
    tagIds: tagIdsSchema.optional(),
    fotos: fotosCadastroSchema.optional(),
    duplicado: z.enum(DUPLICADO_OPCOES, { error: 'Opção de duplicidade inválida' }).optional(),
    duplicadoId: idSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.duplicado === 'SOMAR' && v.duplicadoId === undefined) {
      ctx.addIssue({ code: 'custom', path: ['duplicadoId'], message: 'Informe o produto a somar (duplicadoId)' });
    }
    if (v.fotos && !semRepetidas(v.fotos)) {
      ctx.addIssue({ code: 'custom', path: ['fotos'], message: 'Há fotos repetidas' });
    }
  });

export const editarProdutoSchema = z
  .object({
    nome: nomeProdutoSchema.optional(),
    descricao: descricaoSchema.optional(),
    preco: precoSchema.optional(),
    quantidade: quantidadeSchema.optional(),
    dataCompra: dataCompraSchema.optional(),
    tagIds: tagIdsSchema.optional(),
    fotos: fotosEdicaoSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (Object.values(v).every((x) => x === undefined)) {
      ctx.addIssue({ code: 'custom', path: [], message: 'Informe ao menos um campo para alterar' });
    }
    if (v.fotos && !semRepetidas(v.fotos)) {
      ctx.addIssue({ code: 'custom', path: ['fotos'], message: 'Há fotos repetidas' });
    }
  });

export const uploadUrlSchema = z.object({
  tipo: z.string({ error: 'Informe o tipo do arquivo' }),
  tamanhoBytes: z.number({ error: 'Informe o tamanho do arquivo' }).int('Informe o tamanho do arquivo em bytes'),
  /** Fotos gravadas que esta foto vai substituir na edição: o aviso de cota desconta o tamanho delas (saldo líquido). */
  substituiFotoIds: z.array(idSchema).max(3, 'Informe até 3 fotos').optional(),
});

// ---------------------------------------------------------------- params e query

export const produtoParamsSchema = z.object({ id: idSchema });

/** Página máxima do contrato. */
export const PAGINA_MAX = 10_000;
const paginaSchema = z.coerce.number().int().min(1).max(PAGINA_MAX);

export const listarProdutosQuerySchema = z.object({
  busca: z
    .string()
    // NUL e demais controles/invisíveis: recusados (o NUL derrubava o Postgres com 500).
    .refine((s) => !temControleOuFormatacao(s), `A busca ${MSG_CARACTERES}`)
    .transform((s) => normalizarLinha(s).trim())
    .pipe(z.string().max(NOME_MAX, `A busca deve ter até ${NOME_MAX} caracteres`))
    .transform((s) => (s === '' ? undefined : s))
    .optional(),
  tagId: idSchema.optional(),
  pagina: paginaSchema.default(1),
  limite: z.coerce.number().int().min(1).max(100).default(20),
  ordem: z.enum(['recentes', 'nome']).default('recentes'),
});

export const historicoQuerySchema = z.object({
  pagina: paginaSchema.default(1),
  limite: z.coerce.number().int().min(1).max(100).default(20),
});

export type CriarProdutoDto = z.infer<typeof criarProdutoSchema>;
export type EditarProdutoDto = z.infer<typeof editarProdutoSchema>;
export type UploadUrlDto = z.infer<typeof uploadUrlSchema>;
export type ListarProdutosQuery = z.infer<typeof listarProdutosQuerySchema>;
export type HistoricoQuery = z.infer<typeof historicoQuerySchema>;
