import { Prisma } from '@prisma/client';
import { ACOES_AUDITORIA, registrarAuditoria } from '../../lib/auditoria.js';
import { comNovasTentativas } from '../../lib/concorrencia.js';
import { CODIGOS_ERRO, HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import { apagarObjetos } from '../../lib/s3.js';
import type { UsuarioAutenticado } from '../../middlewares/autenticar.js';
import { exigirCotaParaEnvio } from '../assinatura/plano.service.js';
import { travarCasa } from '../casa/casa.service.js';
import {
  apagarPendentes,
  confirmarFotosNovas,
  descartarDefinitivosNaoUsados,
  descartarObjetosNaoUsados,
  type FotoConfirmada,
} from './fotos.service.js';
import { INCLUIR_PRODUTO, dataSemHora, paraDetalhe, paraResumo, type ProdutoCompleto } from './produtos.mapper.js';
import {
  FOTOS_MAX,
  QUANTIDADE_MAX,
  type CriarProdutoDto,
  type EditarProdutoDto,
  type ListarProdutosQuery,
} from './produtos.schema.js';

/**
 * MODEL · Produtos (M3: UC016, UC020, UC022, UC024 a UC026; RF03 a RF11, RF33 a RF36, RF39). Contrato em docs/api/m3-produtos.md
 * e decisões no ADR 0003. O produto pertence à Casa (sempre a do token); recurso de outra Casa é 404, nunca 403.
 * Cada gravação é uma transação com auditoria (RNF05); o histórico (RF11) lê esses mesmos registros.
 */

type Tx = Prisma.TransactionClient;

const naoEncontrado = () => new HttpError(404, CODIGOS_ERRO.NAO_ENCONTRADO, 'Produto não encontrado');
const dadosInvalidos = (campo: string, mensagem: string) =>
  new HttpError(422, CODIGOS_ERRO.DADOS_INVALIDOS, 'Dados inválidos', [{ campo, mensagem }]);

// ---------------------------------------------------------------- apoio

/** Garante que todas as tags são da Casa (senão 422, sem revelar se existem em outra). Devolve id → nome. */
async function exigirTagsDaCasa(casaId: number, tagIds: number[]): Promise<Map<number, string>> {
  if (tagIds.length === 0) return new Map();
  const tags = await prisma.tag.findMany({ where: { casaId, id: { in: tagIds } }, select: { id: true, nome: true } });
  const mapa = new Map(tags.map((t) => [t.id, t.nome]));
  const invalidos = tagIds.flatMap((id, i) => (mapa.has(id) ? [] : [{ campo: `tagIds.${i}`, mensagem: 'Tag inválida' }]));
  if (invalidos.length > 0) throw new HttpError(422, CODIGOS_ERRO.DADOS_INVALIDOS, 'Dados inválidos', invalidos);
  return mapa;
}

/** O produto mais antigo da Casa com o mesmo nome (sem diferenciar caixa; comparação literal, sem curingas). */
async function buscarDuplicado(db: Tx | typeof prisma, casaId: number, nome: string): Promise<number | null> {
  const linhas = await db.$queryRaw<{ id: number }[]>`
    SELECT id FROM produto WHERE casa_id = ${casaId} AND lower(nome) = lower(${nome}) ORDER BY id LIMIT 1`;
  return linhas[0]?.id ?? null;
}


async function travarProduto(tx: Tx, produtoId: number, casaId: number): Promise<boolean> {
  const linhas = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM produto WHERE id = ${produtoId} AND casa_id = ${casaId} FOR UPDATE`;
  return linhas.length > 0;
}

function conflitoDeChaveDeFoto(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && String(err.meta?.target ?? '').includes('chave');
}

// ---------------------------------------------------------------- cadastro

/** 409 PRODUTO_DUPLICADO com os dados do existente para a tela 09. */
async function erroDeDuplicado(casaId: number, existenteId: number, quantidadeInformada: number) {
  const e = await prisma.produto.findFirst({ where: { id: existenteId, casaId }, include: INCLUIR_PRODUTO });
  if (!e) return null;
  const capa = e.fotos[0];
  return new HttpError(409, CODIGOS_ERRO.PRODUTO_DUPLICADO, 'Já existe um produto com este nome na Casa', {
    existente: {
      id: e.id,
      nome: e.nome,
      preco: e.preco.toFixed(2),
      quantidade: e.quantidade,
      dataCompra: dataSemHora(e.dataCompra),
      // Sem URL de leitura no `details` de erro (pode ir parar em log, AppSec FD6): a tela busca a capa em GET /produtos/:id.
      fotoCapaId: capa ? capa.id : null,
    },
    quantidadeInformada,
    opcoes: ['SOMAR', 'CADASTRAR_MESMO_ASSIM', 'CANCELAR'],
  });
}

export type ResultadoCadastro =
  | { status: 201; corpo: { resultado: 'CRIADO'; produto: Awaited<ReturnType<typeof paraDetalhe>> } }
  | { status: 200; corpo: { resultado: 'QUANTIDADE_SOMADA'; produto: Awaited<ReturnType<typeof paraDetalhe>> } };

/**
 * Soma `quantidade` ao produto `id` (atômico, com a linha travada). Devolve `null` se o produto sumiu ou deixou de ser
 * duplicado (excluído/renomeado entre o 409 e a escolha): quem chama cadastra como novo.
 */
async function somarQuantidade(usuario: UsuarioAutenticado, id: number, nome: string, quantidade: number) {
  return prisma.$transaction(async (tx) => {
    const linhas = await tx.$queryRaw<{ id: number; quantidade: number }[]>`
      SELECT id, quantidade FROM produto
      WHERE id = ${id} AND casa_id = ${usuario.casaId} AND lower(nome) = lower(${nome}) FOR UPDATE`;
    const atual = linhas[0];
    if (!atual) return null;
    const final = atual.quantidade + quantidade;
    if (final > QUANTIDADE_MAX) {
      throw dadosInvalidos('quantidade', `A soma ultrapassa o máximo de ${QUANTIDADE_MAX} unidades`);
    }
    const produto = await tx.produto.update({ where: { id }, data: { quantidade: final }, include: INCLUIR_PRODUTO });
    await registrarAuditoria(
      {
        usuarioId: usuario.id,
        casaId: usuario.casaId,
        acao: ACOES_AUDITORIA.PRODUTO_QUANTIDADE_SOMADA,
        entidade: 'Produto',
        entidadeId: id,
        detalhes: { anterior: atual.quantidade, somada: quantidade, final },
      },
      tx,
    );
    return produto;
  });
}

/**
 * POST /produtos (UC020, UC022, RF03, RF33). Ordem: tags → duplicidade (409) → fotos (422/409) → gravação.
 * `SOMAR` soma só a quantidade ao existente e descarta o resto (fotos inclusive).
 */
export async function criarProduto(usuario: UsuarioAutenticado, dto: CriarProdutoDto): Promise<ResultadoCadastro> {
  const { casaId } = usuario;
  const tagIds = dto.tagIds ?? [];
  const fotosInformadas = dto.fotos ?? [];
  const nomesDasTagsPorId = await exigirTagsDaCasa(casaId, tagIds);

  const existenteId = await buscarDuplicado(prisma, casaId, dto.nome);
  if (existenteId !== null) {
    const escolheuSomarCerto = dto.duplicado === 'SOMAR' && dto.duplicadoId === existenteId;
    if (dto.duplicado !== 'CADASTRAR_MESMO_ASSIM' && !escolheuSomarCerto) {
      const erro = await erroDeDuplicado(casaId, existenteId, dto.quantidade);
      if (erro) throw erro;
      // O existente sumiu neste instante: segue como cadastro novo.
    }
    if (escolheuSomarCerto) {
      const somado = await somarQuantidade(usuario, existenteId, dto.nome, dto.quantidade);
      if (somado) {
        await descartarObjetosNaoUsados(casaId, fotosInformadas.map((f) => f.chave));
        return { status: 200, corpo: { resultado: 'QUANTIDADE_SOMADA', produto: await paraDetalhe(somado) } };
      }
    }
  }

  if (fotosInformadas.length > FOTOS_MAX) {
    throw new HttpError(422, CODIGOS_ERRO.LIMITE_FOTOS, 'Um produto aceita até 3 fotos');
  }
  const confirmadas = await confirmarFotosNovas(
    casaId,
    fotosInformadas.map((f, indice) => ({ indice, chave: f.chave })),
  );

  let produto: ProdutoCompleto;
  try {
    produto = await comNovasTentativas(() =>
      prisma.$transaction(async (tx) => {
        if (confirmadas.length > 0) {
          // Com a Casa travada, dois cadastros simultâneos não estouram a cota juntos (ADR 0003 D7).
          await travarCasa(tx, casaId);
          await exigirCotaParaEnvio(casaId, confirmadas.reduce((s, f) => s + f.tamanhoBytes, 0), tx);
        }
        const criado = await tx.produto.create({
          data: {
            casaId,
            adicionadoPorId: usuario.id,
            nome: dto.nome,
            descricao: dto.descricao ?? null,
            preco: dto.preco,
            quantidade: dto.quantidade,
            dataCompra: new Date(`${dto.dataCompra}T00:00:00.000Z`),
            tags: { create: tagIds.map((tagId) => ({ tagId })) },
            fotos: { create: confirmadas.map((f, ordem) => ({ chave: f.chave, tipo: f.tipo, tamanhoBytes: f.tamanhoBytes, ordem })) },
          },
          include: INCLUIR_PRODUTO,
        });
        await registrarAuditoria(
          {
            usuarioId: usuario.id,
            casaId,
            acao: ACOES_AUDITORIA.PRODUTO_CRIADO,
            entidade: 'Produto',
            entidadeId: criado.id,
            detalhes: {
              nome: criado.nome,
              preco: criado.preco.toFixed(2),
              quantidade: criado.quantidade,
              tags: tagIds.map((id) => nomesDasTagsPorId.get(id) ?? '').sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })),
              fotos: confirmadas.length,
            },
          },
          tx,
        );
        return criado;
      }),
    );
  } catch (err) {
    // Conflito de chave = outra requisição confirmou a mesma foto agora: o objeto definitivo é dela, não se apaga.
    if (conflitoDeChaveDeFoto(err)) {
      throw new HttpError(422, CODIGOS_ERRO.ARQUIVO_INVALIDO, 'Use imagem JPEG ou PNG de até 5 MB', [
        { campo: 'fotos', mensagem: 'Foto já utilizada' },
      ]);
    }
    await descartarDefinitivosNaoUsados(confirmadas);
    throw err;
  }
  await apagarPendentes(confirmadas);
  return { status: 201, corpo: { resultado: 'CRIADO', produto: await paraDetalhe(produto) } };
}

// ---------------------------------------------------------------- consulta

/** GET /produtos (UC016, RF10, RF34): busca por nome (contém, sem diferenciar caixa), filtro por tag, paginação e ordem. */
export async function listarProdutos(casaId: number, q: ListarProdutosQuery) {
  const filtros: Prisma.Sql[] = [Prisma.sql`p.casa_id = ${casaId}`];
  // strpos compara literalmente: `%`, `_` e `\` valem como texto.
  if (q.busca) filtros.push(Prisma.sql`strpos(lower(p.nome), lower(${q.busca})) > 0`);
  if (q.tagId !== undefined) {
    filtros.push(Prisma.sql`EXISTS (SELECT 1 FROM produto_tag pt WHERE pt.produto_id = p.id AND pt.tag_id = ${q.tagId})`);
  }
  const onde = Prisma.join(filtros, ' AND ');
  const ordem = q.ordem === 'nome' ? Prisma.sql`lower(p.nome) ASC, p.id ASC` : Prisma.sql`p.data_cadastro DESC, p.id DESC`;

  const [{ total }] = await prisma.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total FROM produto p WHERE ${onde}`;
  const ids = await prisma.$queryRaw<{ id: number }[]>`
    SELECT p.id FROM produto p WHERE ${onde} ORDER BY ${ordem} LIMIT ${q.limite} OFFSET ${(q.pagina - 1) * q.limite}`;

  const linhas = ids.length
    ? await prisma.produto.findMany({ where: { casaId, id: { in: ids.map((i) => i.id) } }, include: INCLUIR_PRODUTO })
    : [];
  const porId = new Map(linhas.map((p) => [p.id, p]));
  const itens = await Promise.all(ids.flatMap(({ id }) => (porId.has(id) ? [paraResumo(porId.get(id)!)] : [])));
  return { itens, pagina: q.pagina, limite: q.limite, total, totalPaginas: Math.ceil(total / q.limite) };
}

/** GET /produtos/:id (UC024, RF36). */
export async function obterProduto(casaId: number, id: number) {
  const p = await prisma.produto.findFirst({ where: { id, casaId }, include: INCLUIR_PRODUTO });
  if (!p) throw naoEncontrado();
  return paraDetalhe(p);
}

// ---------------------------------------------------------------- edição

type Mudancas = {
  nome?: { de: string; para: string };
  descricao?: { de: string | null; para: string | null };
  preco?: { de: string; para: string };
  quantidade?: { de: number; para: number };
  dataCompra?: { de: string; para: string };
  tags?: { adicionadas: string[]; removidas: string[] };
  fotos?: { adicionadas: number; removidas: number };
};

/**
 * PATCH /produtos/:id (UC025, RF04 a RF08). Só os campos enviados mudam; `tagIds` e `fotos` substituem a lista inteira.
 * Sem verificação de duplicidade. Sem mudança real: devolve o produto sem gravar, sem evento e sem mexer em `atualizadoEm`.
 */
export async function editarProduto(usuario: UsuarioAutenticado, id: number, dto: EditarProdutoDto) {
  const { casaId } = usuario;
  const existe = await prisma.produto.findFirst({ where: { id, casaId }, select: { id: true } });
  if (!existe) throw naoEncontrado();

  const nomesDasTagsPorId = dto.tagIds ? await exigirTagsDaCasa(casaId, dto.tagIds) : new Map<number, string>();
  if (dto.fotos && dto.fotos.length > FOTOS_MAX) {
    throw new HttpError(422, CODIGOS_ERRO.LIMITE_FOTOS, 'Um produto aceita até 3 fotos');
  }
  const novas = (dto.fotos ?? []).flatMap((f, indice) => ('chave' in f ? [{ indice, chave: f.chave }] : []));
  const confirmadas = await confirmarFotosNovas(casaId, novas);
  // O cliente referencia a chave de ENVIO; a gravada é a definitiva (`FotoConfirmada.chave`).
  const confirmadaPorChave = new Map(confirmadas.map((f) => [f.chavePendente, f]));

  let resultado: { produto: ProdutoCompleto; chavesRemovidas: string[] };
  try {
    resultado = await comNovasTentativas(() =>
      prisma.$transaction(async (tx) => {
        // Trava Casa → Produto (ordem fixa, sem impasse). A Casa só é travada quando a cota pode mudar.
        if (dto.fotos) await travarCasa(tx, casaId);
        if (!(await travarProduto(tx, id, casaId))) throw naoEncontrado();
        const atual = await tx.produto.findUniqueOrThrow({ where: { id }, include: INCLUIR_PRODUTO });

        const mudancas: Mudancas = {};
        const dados: Prisma.ProdutoUpdateInput = {};
        if (dto.nome !== undefined && dto.nome !== atual.nome) {
          mudancas.nome = { de: atual.nome, para: dto.nome };
          dados.nome = dto.nome;
        }
        if (dto.descricao !== undefined && dto.descricao !== atual.descricao) {
          mudancas.descricao = { de: atual.descricao, para: dto.descricao };
          dados.descricao = dto.descricao;
        }
        if (dto.preco !== undefined && dto.preco !== atual.preco.toFixed(2)) {
          mudancas.preco = { de: atual.preco.toFixed(2), para: dto.preco };
          dados.preco = dto.preco;
        }
        if (dto.quantidade !== undefined && dto.quantidade !== atual.quantidade) {
          mudancas.quantidade = { de: atual.quantidade, para: dto.quantidade };
          dados.quantidade = dto.quantidade;
        }
        if (dto.dataCompra !== undefined && dto.dataCompra !== dataSemHora(atual.dataCompra)) {
          mudancas.dataCompra = { de: dataSemHora(atual.dataCompra), para: dto.dataCompra };
          dados.dataCompra = new Date(`${dto.dataCompra}T00:00:00.000Z`);
        }

        // tags
        let tagsAdicionar: number[] = [];
        let tagsRemover: number[] = [];
        if (dto.tagIds) {
          const antes = new Map(atual.tags.map((t) => [t.tag.id, t.tag.nome]));
          tagsAdicionar = dto.tagIds.filter((t) => !antes.has(t));
          tagsRemover = [...antes.keys()].filter((t) => !dto.tagIds!.includes(t));
          if (tagsAdicionar.length || tagsRemover.length) {
            const porNome = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' });
            mudancas.tags = {
              adicionadas: tagsAdicionar.map((t) => nomesDasTagsPorId.get(t) ?? '').sort(porNome),
              removidas: tagsRemover.map((t) => antes.get(t) ?? '').sort(porNome),
            };
          }
        }

        // fotos: lista final na ordem desejada
        let fotosFinal: ({ existente: ProdutoCompleto['fotos'][number] } | { nova: FotoConfirmada })[] | null = null;
        let removidas: ProdutoCompleto['fotos'] = [];
        let fotosMudaram = false;
        if (dto.fotos) {
          const atuaisPorId = new Map(atual.fotos.map((f) => [f.id, f]));
          fotosFinal = dto.fotos.map((f, i) => {
            if ('chave' in f) return { nova: confirmadaPorChave.get(f.chave)! };
            const existente = atuaisPorId.get(f.id);
            if (!existente) throw dadosInvalidos(`fotos.${i}.id`, 'Foto não pertence a este produto');
            return { existente };
          });
          const mantidas = new Set(fotosFinal.flatMap((f) => ('existente' in f ? [f.existente.id] : [])));
          removidas = atual.fotos.filter((f) => !mantidas.has(f.id));
          const ordemAntes = atual.fotos.map((f) => f.id).join(',');
          const ordemDepois = fotosFinal.map((f) => ('existente' in f ? f.existente.id : 'n')).join(',');
          const adicionadas = fotosFinal.length - mantidas.size;
          fotosMudaram = adicionadas > 0 || removidas.length > 0 || ordemAntes !== ordemDepois;
          if (fotosMudaram) mudancas.fotos = { adicionadas, removidas: removidas.length };
        }

        if (Object.keys(mudancas).length === 0) return { produto: atual, chavesRemovidas: [] };

        if (fotosMudaram) {
          // Cota pelo saldo líquido: bytes novos menos bytes removidos (saldo ≤ 0 nunca bloqueia).
          const saldo =
            confirmadas.reduce((s, f) => s + f.tamanhoBytes, 0) - removidas.reduce((s, f) => s + f.tamanhoBytes, 0);
          if (saldo > 0) await exigirCotaParaEnvio(casaId, saldo, tx);
        }

        await tx.produto.update({ where: { id }, data: { ...dados, atualizadoEm: new Date() } });
        if (tagsRemover.length) await tx.produtoTag.deleteMany({ where: { produtoId: id, tagId: { in: tagsRemover } } });
        if (tagsAdicionar.length) await tx.produtoTag.createMany({ data: tagsAdicionar.map((tagId) => ({ produtoId: id, tagId })) });
        if (fotosMudaram && fotosFinal) {
          if (removidas.length) await tx.foto.deleteMany({ where: { id: { in: removidas.map((f) => f.id) } } });
          for (const [ordem, f] of fotosFinal.entries()) {
            if ('existente' in f) {
              if (f.existente.ordem !== ordem) await tx.foto.update({ where: { id: f.existente.id }, data: { ordem } });
            } else {
              await tx.foto.create({
                data: { produtoId: id, chave: f.nova.chave, tipo: f.nova.tipo, tamanhoBytes: f.nova.tamanhoBytes, ordem },
              });
            }
          }
        }
        await registrarAuditoria(
          {
            usuarioId: usuario.id,
            casaId,
            acao: ACOES_AUDITORIA.PRODUTO_ALTERADO,
            entidade: 'Produto',
            entidadeId: id,
            detalhes: { alteracoes: mudancas },
          },
          tx,
        );
        const produto = await tx.produto.findUniqueOrThrow({ where: { id }, include: INCLUIR_PRODUTO });
        return { produto, chavesRemovidas: removidas.map((f) => f.chave) };
      }),
    );
  } catch (err) {
    if (conflitoDeChaveDeFoto(err)) {
      throw new HttpError(422, CODIGOS_ERRO.ARQUIVO_INVALIDO, 'Use imagem JPEG ou PNG de até 5 MB', [
        { campo: 'fotos', mensagem: 'Foto já utilizada' },
      ]);
    }
    await descartarDefinitivosNaoUsados(confirmadas);
    throw err;
  }
  await apagarPendentes(confirmadas);
  // Depois de gravar: se a limpeza falhar, a rotina de órfãos apaga o objeto depois (ADR 0003 D6).
  await apagarObjetos(resultado.chavesRemovidas);
  return paraDetalhe(resultado.produto);
}

// ---------------------------------------------------------------- exclusão

/** DELETE /produtos/:id (UC026, RF09, RNF05): definitivo; remove fotos (inclusive do S3) e vínculos com tags. */
export async function excluirProduto(usuario: UsuarioAutenticado, id: number): Promise<void> {
  const chaves = await prisma.$transaction(async (tx) => {
    const p = await tx.produto.findFirst({ where: { id, casaId: usuario.casaId }, include: { fotos: true } });
    if (!p) throw naoEncontrado();
    // deleteMany: se um pedido simultâneo já excluiu, o segundo recebe 404 em vez de erro do Prisma.
    const { count } = await tx.produto.deleteMany({ where: { id, casaId: usuario.casaId } });
    if (count === 0) throw naoEncontrado();
    await registrarAuditoria(
      {
        usuarioId: usuario.id,
        casaId: usuario.casaId,
        acao: ACOES_AUDITORIA.PRODUTO_EXCLUIDO,
        entidade: 'Produto',
        entidadeId: id,
        detalhes: { nome: p.nome, quantidade: p.quantidade, preco: p.preco.toFixed(2), fotos: p.fotos.length },
      },
      tx,
    );
    return p.fotos.map((f) => f.chave);
  });
  await apagarObjetos(chaves);
}
