import { PrismaClient } from '@prisma/client';
import { PLANOS_PADRAO } from '../src/lib/planos.js';
import { hashSenha } from '../src/lib/senha.js';

const prisma = new PrismaClient();

// Usuário de demonstração para desenvolvimento (NUNCA use estas credenciais fora do ambiente local).
const DEMO = { nome: 'Ana Demo', email: 'demo@keepit.local', senha: 'keepit-demo-123' };

/** Produtos de exemplo da Casa demo (M3). Preço como texto decimal; `dias` = quantos dias atrás foi comprado. */
const PRODUTOS_DEMO: ReadonlyArray<{
  nome: string;
  descricao?: string;
  preco: string;
  quantidade: number;
  dias: number;
  tags: string[];
  foto?: 'PNG' | 'JPEG';
}> = [
  { nome: 'Geladeira Frost Free 375 L', descricao: 'Inox, 110 V. Nota fiscal na gaveta do escritório.', preco: '3299.90', quantidade: 1, dias: 420, tags: ['Cozinha', 'Eletrodomésticos', 'Garantia'], foto: 'PNG' },
  { nome: 'Smart TV 50 polegadas', descricao: 'Sala de estar. Suporte de parede incluso.', preco: '2199.00', quantidade: 1, dias: 200, tags: ['Sala', 'Eletrônicos', 'Garantia'], foto: 'JPEG' },
  { nome: 'Furadeira de impacto', descricao: 'Com maleta e 12 brocas.', preco: '349.90', quantidade: 1, dias: 90, tags: ['Ferramentas'] },
  { nome: 'Jogo de panelas antiaderentes', preco: '289.50', quantidade: 2, dias: 60, tags: ['Cozinha'] },
  { nome: 'Cadeira de escritório ergonômica', preco: '799.00', quantidade: 1, dias: 45, tags: ['Escritório', 'Garantia'] },
  { nome: 'Notebook 14 polegadas', descricao: 'Trabalho remoto. Garantia de 12 meses.', preco: '4599.00', quantidade: 1, dias: 30, tags: ['Eletrônicos', 'Escritório', 'Garantia'], foto: 'PNG' },
  { nome: 'Lâmpada LED 9 W', preco: '12.90', quantidade: 12, dias: 14, tags: ['Sala'] },
  { nome: 'Aspirador de pó robô', preco: '1299.00', quantidade: 1, dias: 5, tags: ['Eletrodomésticos', 'Garantia'] },
  // Sprint 4 (M4): dados que exercitam todos os indicadores das telas 05 e 10.
  // Produtos bem antigos (lista "mais antigos", por dataCompra, não por cadastro).
  { nome: 'Sofá retrátil 3 lugares', preco: '2890.00', quantidade: 1, dias: 1500, tags: ['Sala'] },
  { nome: 'Bicicleta aro 29', preco: '1850.00', quantidade: 1, dias: 900, tags: ['Lazer'] },
  // Vários valores e quantidades; produto com 2 tags conta inteiro em cada uma.
  { nome: 'Taças de cristal', preco: '45.00', quantidade: 6, dias: 700, tags: ['Cozinha', 'Sala'] },
  // Tag mais comprada por quantidade (Utilidades: 60 unidades em 2 produtos), com valor baixo.
  { nome: 'Pilhas AA (cartela)', preco: '24.90', quantidade: 40, dias: 10, tags: ['Utilidades'] },
  { nome: 'Fita isolante', preco: '6.50', quantidade: 20, dias: 25, tags: ['Utilidades', 'Ferramentas'] },
  // Preço R$ 0,00 válido (brinde) e produto sem tag (linha "Sem tag").
  { nome: 'Cabo HDMI 2 m (brinde)', preco: '0.00', quantidade: 3, dias: 3, tags: [] },
  { nome: 'Caixa organizadora', preco: '39.90', quantidade: 4, dias: 8, tags: [] },
];

/** Tags de exemplo sem nenhum produto (não devem aparecer em "Valor por tag"; contam em "tags" do resumo). */
const TAGS_SEM_PRODUTO = ['Jardim'];

/** PNG 1x1 e JPEG mínimo usados como fotos de exemplo (objetos reais no S3 local, para exercitar a leitura assinada). */
const PNG_EXEMPLO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const JPEG_EXEMPLO = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

/** Cadastra produtos, tags e fotos de exemplo na Casa demo. Idempotente por produto (compara lower(nome)):
 *  numa Casa demo antiga só entram os que faltam, sem duplicar nem alterar os existentes. */
async function semearProdutosDemo(usuarioId: number): Promise<string> {
  const membro = await prisma.membro.findUnique({ where: { usuarioId } });
  if (!membro) return 'sem Casa';
  const casaId = membro.casaId;

  const nomesTags = [...new Set([...PRODUTOS_DEMO.flatMap((p) => p.tags), ...TAGS_SEM_PRODUTO])];
  for (const nome of nomesTags) {
    await prisma.tag.upsert({ where: { casaId_nome: { casaId, nome } }, update: {}, create: { casaId, nome } });
  }
  const tags = new Map((await prisma.tag.findMany({ where: { casaId } })).map((t) => [t.nome, t.id]));
  const { enviarObjeto, gerarChaveFoto } = await import('../src/lib/s3.js');

  let fotos = 0;
  let criados = 0;
  for (const [i, p] of PRODUTOS_DEMO.entries()) {
    const existe = await prisma.produto.findFirst({
      where: { casaId, nome: { equals: p.nome, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existe) continue;
    criados++;
    const dataCompra = new Date();
    dataCompra.setUTCDate(dataCompra.getUTCDate() - p.dias);
    const produto = await prisma.produto.create({
      data: {
        casaId,
        adicionadoPorId: usuarioId,
        nome: p.nome,
        descricao: p.descricao ?? null,
        preco: p.preco,
        quantidade: p.quantidade,
        dataCompra,
        // Espalha o cadastro no tempo para a lista de recentes (tela 05) e a ordenação terem o que mostrar.
        dataCadastro: new Date(Date.now() - (PRODUTOS_DEMO.length - i) * 3_600_000),
        tags: { create: p.tags.map((t) => ({ tagId: tags.get(t)! })) },
      },
    });
    await prisma.logAuditoria.create({
      data: {
        usuarioId,
        casaId,
        acao: 'PRODUTO_CRIADO',
        entidade: 'Produto',
        entidadeId: produto.id,
        detalhes: { nome: p.nome, quantidade: p.quantidade, preco: p.preco, tags: p.tags, fotos: p.foto ? 1 : 0 },
      },
    });
    if (p.foto) {
      try {
        const tipo = p.foto;
        const corpo = tipo === 'PNG' ? PNG_EXEMPLO : JPEG_EXEMPLO;
        const chave = gerarChaveFoto(casaId, tipo);
        await enviarObjeto(chave, corpo, tipo === 'PNG' ? 'image/png' : 'image/jpeg');
        await prisma.foto.create({ data: { produtoId: produto.id, chave, tipo, tamanhoBytes: corpo.length, ordem: 0 } });
        fotos++;
      } catch {
        // S3 fora do ar: o produto fica sem foto (o seed não depende do armazenamento).
      }
    }
  }
  return `${criados} produtos novos (de ${PRODUTOS_DEMO.length}), ${nomesTags.length} tags e ${fotos} fotos de exemplo`;
}

async function main() {
  for (const p of PLANOS_PADRAO) {
    await prisma.plano.upsert({
      where: { nome: p.nome },
      update: {
        preco: p.preco,
        limiteMembros: p.limiteMembros,
        limiteArmazenamentoGb: p.limiteArmazenamentoGb,
      },
      create: { ...p },
    });
  }

  // Nunca cria o usuário demo (senha conhecida) em produção.
  const demoPermitido = process.env.NODE_ENV !== 'production';
  const existente = await prisma.usuario.findUnique({ where: { email: DEMO.email } });
  if (demoPermitido && !existente) {
    // Mesmo efeito do cadastro (RF32): usuário + Casa + vínculo ADMIN em uma transação; sem assinatura.
    await prisma.$transaction(async (tx) => {
      const usuario = await tx.usuario.create({
        data: { nome: DEMO.nome, email: DEMO.email, senhaHash: await hashSenha(DEMO.senha) },
      });
      const casa = await tx.casa.create({ data: { nome: `Casa de ${DEMO.nome.split(' ')[0]}` } });
      await tx.membro.create({ data: { usuarioId: usuario.id, casaId: casa.id, papel: 'ADMIN' } });
    });
  }
  let produtosDemo = '';
  if (demoPermitido) {
    const demo = await prisma.usuario.findUniqueOrThrow({ where: { email: DEMO.email } });
    produtosDemo = ` Produtos: ${await semearProdutosDemo(demo.id)}.`;
  }
  console.log(
    (demoPermitido
      ? `Seed concluído: ${PLANOS_PADRAO.length} planos e usuário de demonstração (${DEMO.email}).`
      : `Seed concluído: ${PLANOS_PADRAO.length} planos (usuário de demonstração NÃO criado em produção).`) + produtosDemo,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
