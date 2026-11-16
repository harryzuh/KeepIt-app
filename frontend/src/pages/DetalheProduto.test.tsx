import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { chamadas, detalhe, entrarComo, mockarApi, tagsExemplo } from '@/test/produtos';
import { renderizarRotas } from '@/test/utils';
import DetalheProduto from './DetalheProduto';
import ProdutoEditar from './ProdutoEditar';

const rotas = [
  { path: '/produtos', element: <p>Lista de produtos</p> },
  { path: '/produtos/:id', element: <DetalheProduto /> },
  { path: '/produtos/:id/editar', element: <ProdutoEditar /> },
];

const historico = {
  itens: [
    { id: '3', tipo: 'QUANTIDADE_SOMADA', criadoEm: '2026-11-15T18:00:00.000Z', autor: { nome: 'Caio' }, detalhes: { anterior: 1, somada: 2, final: 3 } },
    {
      id: '2',
      tipo: 'ALTERADO',
      criadoEm: '2026-11-15T17:00:00.000Z',
      autor: null,
      detalhes: { alteracoes: { preco: { de: '200.00', para: '249.90' }, tags: { adicionadas: ['Cozinha'], removidas: [] } } },
    },
    { id: '1', tipo: 'CRIADO', criadoEm: '2026-11-15T16:00:00.000Z', autor: { nome: 'Ana' }, detalhes: { nome: 'Cafeteira', preco: '200.00', quantidade: 1, tags: [], fotos: 0 } },
  ],
  pagina: 1,
  limite: 20,
  total: 3,
  totalPaginas: 1,
};

const base = { 'GET /produtos/21': { corpo: detalhe() }, 'GET /produtos/21/historico': { corpo: historico }, 'GET /tags': { corpo: tagsExemplo } };

describe('Detalhe do produto (tela 07)', () => {
  it('mostra os dados, o histórico e, para EDITOR, editar e excluir', async () => {
    entrarComo('EDITOR');
    mockarApi(base);
    renderizarRotas(rotas, '/produtos/21');
    expect(await screen.findByRole('heading', { name: 'Cafeteira Elétrica' })).toBeInTheDocument();
    expect(screen.getByText(/R\$\s*249,90/)).toBeInTheDocument();
    expect(screen.getByText('15/03/2026')).toBeInTheDocument();
    expect(screen.getByText('Ana Souza')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Editar produto' })).toHaveAttribute('href', '/produtos/21/editar');
    expect(screen.getByRole('button', { name: 'Excluir produto' })).toBeInTheDocument();
    expect(await screen.findByText('Quantidade somada: 1 + 2 = 3')).toBeInTheDocument();
    expect(screen.getByText(/Preço: R\$\s*200,00 → R\$\s*249,90/)).toBeInTheDocument();
    expect(screen.getByText(/ex-membro/)).toBeInTheDocument();
    expect(screen.getByText('Produto cadastrado (1 unidade)')).toBeInTheDocument();
  });

  it('LEITOR vê tudo, mas sem editar nem excluir', async () => {
    entrarComo('LEITOR');
    mockarApi(base);
    renderizarRotas(rotas, '/produtos/21');
    await screen.findByRole('heading', { name: 'Cafeteira Elétrica' });
    expect(screen.queryByRole('link', { name: 'Editar produto' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Excluir produto' })).toBeNull();
    expect(await screen.findByText('Histórico')).toBeInTheDocument();
  });

  it('mostra as fotos com alt e produto inexistente como não encontrado', async () => {
    entrarComo('ADMIN');
    const foto = { id: 1, ordem: 0, tipo: 'PNG' as const, tamanhoBytes: 10, url: 'http://s3:9000/b/x.png?X=1', expiraEm: '2026-11-15T19:00:00.000Z' };
    mockarApi({ ...base, 'GET /produtos/21': { corpo: detalhe({ fotos: [foto] }) } });
    renderizarRotas(rotas, '/produtos/21');
    expect(await screen.findByAltText('Foto de Cafeteira Elétrica (foto 1 de 1)')).toBeInTheDocument();
  });

  it('produto inexistente (404) mostra aviso com volta para a lista', async () => {
    entrarComo('ADMIN');
    mockarApi({ 'GET /produtos/21': { status: 404, corpo: { error: 'NAO_ENCONTRADO', message: 'x' } } });
    renderizarRotas(rotas, '/produtos/21');
    expect(await screen.findByRole('heading', { name: 'Produto não encontrado' })).toBeInTheDocument();
  });

  it('exclusão pede confirmação (tela 23), só chama DELETE ao confirmar e volta à lista', async () => {
    entrarComo('EDITOR');
    const f = mockarApi({ ...base, 'DELETE /produtos/21': { status: 204 } });
    renderizarRotas(rotas, '/produtos/21');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Excluir produto' }));
    const modal = screen.getByRole('dialog', { name: 'Excluir produto?' });
    expect(within(modal).getByText(/não pode ser desfeita/)).toBeInTheDocument();
    await user.click(within(modal).getByRole('button', { name: 'Cancelar' }));
    expect(chamadas(f).some((c) => c.startsWith('DELETE'))).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Excluir produto' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir produto' }));
    expect(await screen.findByText('Lista de produtos')).toBeInTheDocument();
    expect(chamadas(f).filter((c) => c.startsWith('DELETE'))).toHaveLength(1);
  });

  it('excluir produto que já sumiu (404) conta como sucesso', async () => {
    entrarComo('EDITOR');
    mockarApi({ ...base, 'DELETE /produtos/21': { status: 404, corpo: { error: 'NAO_ENCONTRADO', message: 'x' } } });
    renderizarRotas(rotas, '/produtos/21');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Excluir produto' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir produto' }));
    expect(await screen.findByText('Lista de produtos')).toBeInTheDocument();
  });
});

describe('Editar produto (tela 08)', () => {
  it('abre preenchido, salva por PATCH e volta ao detalhe', async () => {
    entrarComo('EDITOR');
    const f = mockarApi({ ...base, 'PATCH /produtos/21': { corpo: detalhe({ quantidade: 4 }) } });
    renderizarRotas(rotas, '/produtos/21/editar');
    const user = userEvent.setup();
    const qtd = await screen.findByLabelText('Quantidade');
    expect(screen.getByLabelText('Nome do produto')).toHaveValue('Cafeteira Elétrica');
    expect(screen.getByLabelText('Preço (R$)')).toHaveValue('249,90');
    expect(await screen.findByRole('button', { name: 'Cozinha', pressed: true })).toBeInTheDocument();
    await user.clear(qtd);
    await user.type(qtd, '4');
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    expect(await screen.findByText('Alterações salvas.')).toBeInTheDocument();
    const patch = f.mock.calls.find(([, i]) => i?.method === 'PATCH');
    expect(JSON.parse(String(patch?.[1]?.body))).toMatchObject({ nome: 'Cafeteira Elétrica', preco: '249.90', quantidade: 4, tagIds: [3] });
  });

  it('LEITOR que abre a URL de edição vê aviso de permissão', async () => {
    entrarComo('LEITOR');
    mockarApi(base);
    renderizarRotas(rotas, '/produtos/21/editar');
    expect(await screen.findByText(/não tem permissão para editar/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Nome do produto')).toBeNull();
  });
});
