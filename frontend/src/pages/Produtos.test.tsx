import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { chamadas, entrarComo, mockarApi, pagina, resumo, tagsExemplo } from '@/test/produtos';
import { renderizarRotas } from '@/test/utils';
import Inicio from './Inicio';
import Produtos from './Produtos';

const rotas = [
  { path: '/produtos', element: <Produtos /> },
  { path: '/produtos/novo', element: <p>Tela de cadastro</p> },
  { path: '/produtos/:id', element: <p>Tela de detalhe</p> },
  { path: '/inicio', element: <Inicio /> },
];

const urls = (f: ReturnType<typeof mockarApi>) => chamadas(f).map((c) => c.replace(/^GET /, ''));

describe('Produtos (tela 06)', () => {
  it('lista produtos com preço em BRL, quantidade, tags e link para o detalhe; ADMIN vê o botão de adicionar', async () => {
    entrarComo('ADMIN');
    mockarApi({
      'GET /tags': { corpo: tagsExemplo },
      'GET /produtos': { corpo: pagina([resumo(), resumo({ id: 22, nome: 'Notebook', preco: '3500.00', quantidade: 2, tags: [] })]) },
    });
    renderizarRotas(rotas, '/produtos');
    const item = await screen.findByRole('link', { name: /Cafeteira Elétrica/ });
    expect(item).toHaveAttribute('href', '/produtos/21');
    expect(within(item).getByText(/R\$\s*249,90/)).toBeInTheDocument();
    expect(within(item).getByText('Cozinha')).toBeInTheDocument();
    expect(screen.getByText('2 produtos')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+ Adicionar' })).toBeInTheDocument();
  });

  it('LEITOR só consulta: sem botão de adicionar', async () => {
    entrarComo('LEITOR');
    mockarApi({ 'GET /tags': { corpo: tagsExemplo }, 'GET /produtos': { corpo: pagina([resumo()]) } });
    renderizarRotas(rotas, '/produtos');
    await screen.findByRole('link', { name: /Cafeteira/ });
    expect(screen.queryByRole('link', { name: '+ Adicionar' })).toBeNull();
  });

  it('busca por nome e filtro por tag viram parâmetros da consulta', async () => {
    entrarComo('EDITOR');
    const f = mockarApi({
      'GET /tags': { corpo: tagsExemplo },
      'GET /produtos': { corpo: pagina([resumo()]) },
    });
    renderizarRotas(rotas, '/produtos');
    const user = userEvent.setup();
    await user.type(await screen.findByRole('searchbox', { name: 'Buscar produto por nome' }), 'caf');
    await waitFor(() => expect(urls(f)).toContain('/produtos?busca=caf'));
    await user.click(await screen.findByRole('button', { name: 'Cozinha' }));
    await waitFor(() => expect(urls(f)).toContain('/produtos?busca=caf&tagId=3'));
    expect(screen.getByRole('button', { name: 'Cozinha', pressed: true })).toBeInTheDocument();
  });

  it('mostra estado vazio com filtro (limpar filtros) e sem filtro (cadastrar o primeiro)', async () => {
    entrarComo('EDITOR');
    mockarApi({ 'GET /tags': { corpo: tagsExemplo }, 'GET /produtos': { corpo: pagina([]) } });
    renderizarRotas(rotas, '/produtos');
    expect(await screen.findByText('Nenhum produto cadastrado')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Adicionar produto' })).toBeInTheDocument();
  });

  it('com filtro e sem resultado oferece limpar filtros', async () => {
    entrarComo('EDITOR');
    mockarApi({ 'GET /tags': { corpo: tagsExemplo }, 'GET /produtos': { corpo: pagina([]) } });
    renderizarRotas(rotas, '/produtos?tag=5');
    expect(await screen.findByText('Nenhum produto encontrado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Limpar filtros' })).toBeInTheDocument();
  });

  it('pagina com Anterior e Próxima', async () => {
    entrarComo('EDITOR');
    const f = mockarApi({
      'GET /tags': { corpo: tagsExemplo },
      'GET /produtos': (q) =>
        q.get('pagina') === '2'
          ? { corpo: pagina([resumo({ id: 30, nome: 'Liquidificador' })], { pagina: 2, total: 40, totalPaginas: 2 }) }
          : { corpo: pagina([resumo()], { total: 40, totalPaginas: 2 }) },
    });
    renderizarRotas(rotas, '/produtos');
    const user = userEvent.setup();
    expect(await screen.findByText('Página 1 de 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Próxima' }));
    expect(await screen.findByRole('link', { name: /Liquidificador/ })).toBeInTheDocument();
    expect(urls(f)).toContain('/produtos?pagina=2');
  });

  it('erro de rede mostra mensagem e permite tentar de novo (RNF24)', async () => {
    entrarComo('EDITOR');
    let falha = true;
    mockarApi({ 'GET /tags': { corpo: tagsExemplo }, 'GET /produtos': () => (falha ? { status: 500, corpo: { error: 'ERRO_INTERNO', message: 'x' } } : { corpo: pagina([resumo()]) }) });
    renderizarRotas(rotas, '/produtos');
    const user = userEvent.setup();
    expect(await screen.findByRole('alert', {}, { timeout: 3000 })).toHaveTextContent('Algo deu errado');
    falha = false;
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('link', { name: /Cafeteira/ })).toBeInTheDocument();
  });
});

describe('Início (tela 05): produtos recentes', () => {
  it('pede os 5 mais recentes e mostra o atalho de cadastro para EDITOR', async () => {
    entrarComo('EDITOR');
    const f = mockarApi({ 'GET /produtos': { corpo: pagina([resumo()]) } });
    renderizarRotas(rotas, '/inicio');
    expect(await screen.findByRole('link', { name: /Cafeteira Elétrica/ })).toBeInTheDocument();
    expect(urls(f)).toContain('/produtos?limite=5');
    expect(screen.getByRole('link', { name: '+ Adicionar produto' })).toHaveAttribute('href', '/produtos/novo');
  });

  it('LEITOR vê os recentes sem o atalho de cadastro', async () => {
    entrarComo('LEITOR');
    mockarApi({ 'GET /produtos': { corpo: pagina([]) } });
    renderizarRotas(rotas, '/inicio');
    expect(await screen.findByText('A Casa ainda não tem produtos cadastrados.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '+ Adicionar produto' })).toBeNull();
  });
});
