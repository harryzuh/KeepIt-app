import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { corposEnviados, detalhe, entrarComo, mockarApi, tagsExemplo } from '@/test/produtos';
import { renderizarRotas } from '@/test/utils';
import DetalheProduto from './DetalheProduto';
import ProdutoNovo from './ProdutoNovo';

const rotas = [
  { path: '/produtos/novo', element: <ProdutoNovo /> },
  { path: '/produtos/:id', element: <DetalheProduto /> },
  { path: '/produtos', element: <p>Lista de produtos</p> },
];

const duplicadoApi = {
  status: 409,
  corpo: {
    error: 'PRODUTO_DUPLICADO',
    message: 'Já existe',
    details: {
      existente: { id: 17, nome: 'Cafeteira elétrica', preco: '199.00', quantidade: 2, dataCompra: '2025-10-02', fotoCapaId: null },
      quantidadeInformada: 1,
      opcoes: ['SOMAR', 'CADASTRAR_MESMO_ASSIM', 'CANCELAR'],
    },
  },
};

const corpos = corposEnviados;

async function preencher(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Nome do produto'), 'Cafeteira Elétrica');
  await user.type(screen.getByLabelText('Preço (R$)'), '1.249,90');
  await user.clear(screen.getByLabelText('Quantidade'));
  await user.type(screen.getByLabelText('Quantidade'), '1');
}

const baseApi = {
  'GET /tags': { corpo: tagsExemplo },
  'GET /produtos/21': { corpo: detalhe() },
  'GET /produtos/17': { corpo: detalhe({ id: 17, quantidade: 3 }) },
  'GET /produtos/21/historico': { corpo: { itens: [], pagina: 1, limite: 20, total: 0, totalPaginas: 0 } },
  'GET /produtos/17/historico': { corpo: { itens: [], pagina: 1, limite: 20, total: 0, totalPaginas: 0 } },
};

describe('Cadastrar produto (tela 08)', () => {
  it('valida os campos em tempo real sem chamar a API', async () => {
    entrarComo('EDITOR');
    const f = mockarApi(baseApi);
    renderizarRotas(rotas, '/produtos/novo');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Salvar produto' }));
    expect(await screen.findByText('Informe o nome do produto')).toBeInTheDocument();
    expect(screen.getByText('Informe o preço')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Preço (R$)'), '12,345');
    await user.tab();
    expect(await screen.findByText('Use o formato 1.234,50')).toBeInTheDocument();
    expect(corpos(f, 'POST /produtos')).toHaveLength(0);
  });

  it('cadastra com preço convertido e tag escolhida e abre o detalhe', async () => {
    entrarComo('EDITOR');
    const f = mockarApi({ ...baseApi, 'POST /produtos': { status: 201, corpo: { resultado: 'CRIADO', produto: detalhe() } } });
    renderizarRotas(rotas, '/produtos/novo');
    const user = userEvent.setup();
    await preencher(user);
    await user.click(await screen.findByRole('button', { name: 'Cozinha' }));
    await user.click(screen.getByRole('button', { name: 'Salvar produto' }));
    expect(await screen.findByRole('heading', { name: 'Cafeteira Elétrica' })).toBeInTheDocument();
    expect(screen.getByText('Produto cadastrado.')).toBeInTheDocument();
    expect(corpos(f, 'POST /produtos')[0]).toMatchObject({
      nome: 'Cafeteira Elétrica',
      preco: '1249.90',
      quantidade: 1,
      tagIds: [3],
    });
    expect(corpos(f, 'POST /produtos')[0]).not.toHaveProperty('duplicado');
  });

  it('cria uma tag nova e a seleciona; tag repetida (409) seleciona a existente', async () => {
    entrarComo('ADMIN');
    mockarApi({
      ...baseApi,
      'POST /tags': { status: 409, corpo: { error: 'TAG_EXISTENTE', message: 'x', details: { existente: { id: 3, nome: 'Cozinha' } } } },
    });
    renderizarRotas(rotas, '/produtos/novo');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Nova tag'), 'cozinha');
    await user.click(screen.getByRole('button', { name: 'Criar tag' }));
    expect(await screen.findByText(/Essa tag já existe/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cozinha', pressed: true })).toBeInTheDocument();
  });

  it('LEITOR vê aviso de permissão e nenhum formulário', async () => {
    entrarComo('LEITOR');
    mockarApi(baseApi);
    renderizarRotas(rotas, '/produtos/novo');
    expect(await screen.findByText(/não tem permissão para cadastrar/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Nome do produto')).toBeNull();
  });
});

describe('Produto duplicado (tela 09)', () => {
  it('abre o modal com o existente e as 3 opções; Cancelar só fecha, sem nova chamada', async () => {
    entrarComo('EDITOR');
    const f = mockarApi({ ...baseApi, 'POST /produtos': duplicadoApi });
    renderizarRotas(rotas, '/produtos/novo');
    const user = userEvent.setup();
    await preencher(user);
    await user.click(screen.getByRole('button', { name: 'Salvar produto' }));
    const modal = await screen.findByRole('dialog', { name: 'Este produto já existe' });
    expect(within(modal).getByText('Quantidade atual:', { exact: false })).toBeInTheDocument();
    expect(within(modal).getByText(/2 \+ 1 = 3/)).toBeInTheDocument();
    expect(within(modal).getByRole('button', { name: 'Somar à quantidade' })).toBeInTheDocument();
    expect(within(modal).getByRole('button', { name: 'Cadastrar mesmo assim' })).toBeInTheDocument();
    await user.click(within(modal).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(corpos(f, 'POST /produtos')).toHaveLength(1);
    expect(screen.getByLabelText('Nome do produto')).toHaveValue('Cafeteira Elétrica'); // dados preservados
  });

  it('tela 09 busca a miniatura no detalhe, pois o 409 só traz fotoCapaId (contrato)', async () => {
    entrarComo('EDITOR');
    const comFoto = { ...duplicadoApi, corpo: { ...duplicadoApi.corpo, details: { ...duplicadoApi.corpo.details, existente: { ...duplicadoApi.corpo.details.existente, fotoCapaId: 5 } } } };
    const foto = { id: 5, ordem: 0, tipo: 'PNG' as const, tamanhoBytes: 10, url: 'http://s3:9000/keepit-fotos/capa.png', expiraEm: '2026-11-15T17:00:00.000Z' };
    const f = mockarApi({ ...baseApi, 'GET /produtos/17': { corpo: detalhe({ id: 17, fotos: [foto] }) }, 'POST /produtos': comFoto });
    renderizarRotas(rotas, '/produtos/novo');
    const user = userEvent.setup();
    await preencher(user);
    await user.click(screen.getByRole('button', { name: 'Salvar produto' }));
    const modal = await screen.findByRole('dialog', { name: 'Este produto já existe' });
    expect(await within(modal).findByRole('img', { name: /Foto de Cafeteira elétrica/ })).toBeInTheDocument();
    expect(f.mock.calls.some(([u]) => String(u).endsWith('/produtos/17'))).toBe(true);
  });

  it('Somar abre o produto existente já com a quantidade somada', async () => {
    entrarComo('EDITOR');
    const respostas = [duplicadoApi, { status: 200, corpo: { resultado: 'QUANTIDADE_SOMADA', produto: detalhe({ id: 17, quantidade: 3 }) } }];
    let n = 0;
    mockarApi({ ...baseApi, 'POST /produtos': () => respostas[n++] });
    renderizarRotas(rotas, '/produtos/novo');
    const user = userEvent.setup();
    await preencher(user);
    await user.click(screen.getByRole('button', { name: 'Salvar produto' }));
    await user.click(await screen.findByRole('button', { name: 'Somar à quantidade' }));
    expect(await screen.findByText(/Quantidade somada: agora são 3 unidades/)).toBeInTheDocument();
  });

  it('Cadastrar mesmo assim reenvia o mesmo corpo só com duplicado', async () => {
    entrarComo('EDITOR');
    const respostas = [
      duplicadoApi,
      { status: 201, corpo: { resultado: 'CRIADO', produto: detalhe() } },
      duplicadoApi,
      { status: 201, corpo: { resultado: 'CRIADO', produto: detalhe() } },
    ];
    let n = 0;
    const f = mockarApi({ ...baseApi, 'POST /produtos': () => respostas[n++] });
    renderizarRotas(rotas, '/produtos/novo');
    const user = userEvent.setup();
    await preencher(user);
    await user.click(screen.getByRole('button', { name: 'Salvar produto' }));
    await user.click(await screen.findByRole('button', { name: 'Cadastrar mesmo assim' }));
    await screen.findByText('Produto cadastrado.');
    const [primeiro, segundo] = corpos(f, 'POST /produtos');
    expect(primeiro).not.toHaveProperty('duplicado');
    expect(segundo).toMatchObject({ nome: 'Cafeteira Elétrica', preco: '1249.90', duplicado: 'CADASTRAR_MESMO_ASSIM' });
    expect(segundo).not.toHaveProperty('duplicadoId');
  });

  it('Somar manda duplicadoId do existente e avisa quando o original sumiu', async () => {
    entrarComo('EDITOR');
    const respostas = [duplicadoApi, { status: 201, corpo: { resultado: 'CRIADO', produto: detalhe() } }];
    let n = 0;
    const f = mockarApi({ ...baseApi, 'POST /produtos': () => respostas[n++] });
    renderizarRotas(rotas, '/produtos/novo');
    const user = userEvent.setup();
    await preencher(user);
    await user.click(screen.getByRole('button', { name: 'Salvar produto' }));
    await user.click(await screen.findByRole('button', { name: 'Somar à quantidade' }));
    expect(await screen.findByText('O produto original não existe mais; cadastramos como novo.')).toBeInTheDocument();
    expect(corpos(f, 'POST /produtos')[1]).toMatchObject({ duplicado: 'SOMAR', duplicadoId: 17 });
  });
});
