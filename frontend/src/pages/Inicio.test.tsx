import { screen, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import { completaExemplo, resumoExemplo, resumoVazio } from '@/test/estatisticas';
import { chamadas, entrarComo, mockarApi, pagina, resumo, tagsExemplo } from '@/test/produtos';
import { renderizarRotas } from '@/test/utils';
import Inicio from './Inicio';

const rotas = [
  { path: '/inicio', element: <Inicio /> },
  { path: '/estatisticas', element: <p>Tela 10</p> },
  { path: '/produtos/novo', element: <p>Tela de cadastro</p> },
];

const base = { 'GET /produtos': { corpo: pagina([resumo()]) }, 'GET /tags': { corpo: tagsExemplo } };

function simularDesktop() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((q: string) => ({ matches: true, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
}

describe('Início (tela 05, celular)', () => {
  it('mostra valor total em destaque, contagens, membros, armazenamento e renovação', async () => {
    entrarComo('ADMIN');
    mockarApi({ ...base, 'GET /estatisticas/resumo': { corpo: resumoExemplo() } });
    renderizarRotas(rotas, '/inicio');
    const total = await screen.findByRole('group', { name: /Valor total do patrimônio/ });
    expect(total).toHaveTextContent(/R\$\s*5\.754,60/);
    expect(screen.getByRole('group', { name: 'Produtos: 3' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Tags: 4' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Membros: 3 de 6' })).toBeInTheDocument();
    const barra = screen.getByRole('progressbar', { name: 'Armazenamento usado' });
    expect(barra).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText(/Plano Família · Renova em 15\/12\/2026/)).toBeInTheDocument();
    expect(screen.queryByText('Armazenamento quase cheio')).toBeNull();
    expect(screen.getByRole('link', { name: 'Ver estatísticas' })).toHaveAttribute('href', '/estatisticas');
  });

  it('assinatura cancelada vigente mostra "Benefícios até" e Individual mostra só o plano', async () => {
    entrarComo('ADMIN');
    mockarApi({
      ...base,
      'GET /estatisticas/resumo': { corpo: resumoExemplo({ renovacao: { status: 'CANCELADA', data: '2026-12-15T17:00:00.000Z' } }) },
    });
    const { unmount } = renderizarRotas(rotas, '/inicio');
    expect(await screen.findByText(/Benefícios até 15\/12\/2026/)).toBeInTheDocument();
    unmount();
    mockarApi({ ...base, 'GET /estatisticas/resumo': { corpo: resumoExemplo({ plano: { nome: 'INDIVIDUAL' }, renovacao: null }) } });
    renderizarRotas(rotas, '/inicio');
    const linhas = await screen.findAllByText(/Plano Individual/);
    expect(linhas.some((l) => !/Renova|Benef/.test(l.textContent ?? ''))).toBe(true);
    expect(screen.queryByText(/Renova em/)).toBeNull();
  });

  it('armazenamento acima de 90% muda a barra e escreve o aviso', async () => {
    entrarComo('ADMIN');
    mockarApi({
      ...base,
      'GET /estatisticas/resumo': { corpo: resumoExemplo({ armazenamento: { usadoBytes: 950, limiteBytes: 1000 } }) },
    });
    renderizarRotas(rotas, '/inicio');
    expect(await screen.findByText('Armazenamento quase cheio')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Armazenamento usado' })).toHaveAttribute('aria-valuenow', '95');
  });

  it('valor gigante é formatado sem notação científica', async () => {
    entrarComo('ADMIN');
    mockarApi({ ...base, 'GET /estatisticas/resumo': { corpo: resumoExemplo({ valorTotal: '9999999999990000.00' }) } });
    renderizarRotas(rotas, '/inicio');
    expect(await screen.findByRole('group', { name: /9\.999\.999\.999\.990\.000,00/ })).toBeInTheDocument();
  });

  it('Casa vazia: R$ 0,00, zeros e mensagem de estado vazio, sem NaN', async () => {
    entrarComo('ADMIN');
    mockarApi({ 'GET /estatisticas/resumo': { corpo: resumoVazio }, 'GET /produtos': { corpo: pagina([]) } });
    renderizarRotas(rotas, '/inicio');
    expect(await screen.findByText(/Nenhum produto cadastrado ainda/)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Valor total do patrimônio: R\$\s*0,00/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Produtos: 0' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
    // atalho de cadastro (do M3) para quem pode cadastrar
    expect(screen.getByRole('link', { name: '+ Adicionar produto' })).toBeInTheDocument();
  });

  it('LEITOR com Casa vazia não vê atalho de cadastro', async () => {
    entrarComo('LEITOR');
    mockarApi({ 'GET /estatisticas/resumo': { corpo: resumoVazio }, 'GET /produtos': { corpo: pagina([]) } });
    renderizarRotas(rotas, '/inicio');
    await screen.findByText(/Nenhum produto cadastrado ainda/);
    expect(screen.queryByRole('link', { name: /Adicionar produto/ })).toBeNull();
  });

  it('erro no resumo mostra mensagem com "Tentar de novo" e o resto da tela segue usável', async () => {
    entrarComo('EDITOR');
    let falhar = true;
    const f = mockarApi({
      ...base,
      'GET /estatisticas/resumo': () => (falhar ? { status: 500, corpo: { error: 'ERRO_INTERNO', message: 'x' } } : { corpo: resumoExemplo() }),
    });
    renderizarRotas(rotas, '/inicio');
    const botao = await screen.findByRole('button', { name: 'Tentar de novo' }, { timeout: 4000 });
    expect(await screen.findByRole('link', { name: /Cafeteira Elétrica/ })).toBeInTheDocument(); // recentes continuam
    falhar = false;
    botao.click();
    expect(await screen.findByRole('group', { name: /Valor total do patrimônio/ })).toBeInTheDocument();
    expect(chamadas(f).filter((c) => c === 'GET /estatisticas/resumo').length).toBeGreaterThanOrEqual(2);
  });

  it('não consulta GET /estatisticas completo no celular', async () => {
    entrarComo('ADMIN');
    const f = mockarApi({ ...base, 'GET /estatisticas/resumo': { corpo: resumoExemplo() } });
    renderizarRotas(rotas, '/inicio');
    await screen.findByRole('group', { name: /Valor total/ });
    expect(chamadas(f)).not.toContain('GET /estatisticas');
  });
});

describe('Início (tela 17, desktop)', () => {
  it('mostra quatro indicadores (valor total, maior gasto, valor médio, membros) e a tabela de produtos', async () => {
    simularDesktop();
    entrarComo('ADMIN');
    mockarApi({
      ...base,
      'GET /estatisticas/resumo': { corpo: resumoExemplo() },
      'GET /estatisticas': { corpo: completaExemplo() },
    });
    renderizarRotas(rotas, '/inicio');
    expect(await screen.findByRole('group', { name: /Maior gasto: R\$\s*4\.599,00/ })).toHaveTextContent('Notebook 14 polegadas');
    expect(screen.getByRole('group', { name: /Valor total: R\$\s*5\.754,60/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Valor médio: R\$\s*1\.918,20/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Membros: 3 de 6' })).toBeInTheDocument();
    const tabela = await screen.findByRole('table', { name: 'Produtos da Casa' });
    expect(within(tabela).getByRole('link', { name: 'Cafeteira Elétrica' })).toHaveAttribute('href', '/produtos/21');
    expect(screen.getByRole('searchbox', { name: 'Buscar produto por nome' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+ Adicionar produto' })).toBeInTheDocument();
  });

  it('Casa vazia no desktop: traços em maior gasto e valor médio, sem NaN; LEITOR sem botão de adicionar', async () => {
    simularDesktop();
    entrarComo('LEITOR');
    mockarApi({
      'GET /estatisticas/resumo': { corpo: resumoVazio },
      'GET /estatisticas': { corpo: completaExemplo({ produtos: 0, valorTotal: '0.00', valorMedio: '0.00', maiorGasto: null }) },
      'GET /produtos': { corpo: pagina([]) },
      'GET /tags': { corpo: { itens: [] } },
    });
    renderizarRotas(rotas, '/inicio');
    expect(await screen.findByRole('group', { name: 'Maior gasto: —' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Valor médio: —' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('A Casa ainda não tem produtos cadastrados.')).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: /Adicionar produto/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/NaN/);
  });
});
