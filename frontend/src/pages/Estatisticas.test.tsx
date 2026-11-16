import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { completaExemplo, completaVazia } from '@/test/estatisticas';
import { entrarComo, mockarApi } from '@/test/produtos';
import { renderizarRotas } from '@/test/utils';
import Estatisticas from './Estatisticas';

const rotas = [
  { path: '/estatisticas', element: <Estatisticas /> },
  { path: '/inicio', element: <p>Tela 05</p> },
  { path: '/produtos/novo', element: <p>Tela de cadastro</p> },
  { path: '/produtos/:id', element: <p>Tela de detalhe</p> },
];

describe('Estatísticas (tela 10)', () => {
  it('mostra maior gasto com composição e data, valor médio, tag mais comprada, valor por tag e mais antigos', async () => {
    entrarComo('EDITOR');
    mockarApi({ 'GET /estatisticas': { corpo: completaExemplo() } });
    renderizarRotas(rotas, '/estatisticas');
    const maior = await screen.findByRole('link', { name: /Maior gasto.*Notebook 14 polegadas/ });
    expect(maior).toHaveAttribute('href', '/produtos/31');
    expect(maior).toHaveTextContent(/R\$\s*4\.599,00 × 1/);
    expect(maior).toHaveTextContent('16/10/2026');
    expect(screen.getByRole('group', { name: /Valor médio: R\$\s*1\.918,20/ })).toBeInTheDocument();
    const tag = screen.getByRole('group', { name: /Tag mais comprada: Utilidades/ });
    expect(tag).toHaveTextContent('40 unidades em 1 produto');

    // barras com texto alternativo e percentual por escrito; "Sem tag" por último
    const barra = screen.getByRole('img', { name: /Utilidades: R\$\s*996,00, 17,3% do valor total, 1 produto/ });
    expect(barra).toBeInTheDocument();
    const imgs = screen.getAllByRole('img');
    expect(imgs[imgs.length - 1]).toHaveAccessibleName(/^Sem tag: R\$\s*159,60/);
    expect(screen.getByText('Produtos com mais de uma tag aparecem em cada uma.')).toBeInTheDocument();

    const antigos = screen.getByRole('region', { name: 'Produtos mais antigos' });
    const itens = within(antigos).getAllByRole('link');
    expect(itens).toHaveLength(3);
    expect(itens[0]).toHaveTextContent('Notebook 14 polegadas');
    expect(itens[1]).toHaveTextContent(/R\$\s*24,90 × 40/);
    expect(itens[1]).toHaveAttribute('href', '/produtos/32');
  });

  it('sem sobreposição a nota não aparece; sem tag em uso mostra "Sem tags ainda"', async () => {
    entrarComo('ADMIN');
    mockarApi({
      'GET /estatisticas': {
        corpo: completaExemplo({ valorPorTag: [], totalTagsComProduto: 0, tagMaisComprada: null, semTag: { valor: '5754.60', unidades: 45, produtos: 3 } }),
      },
    });
    renderizarRotas(rotas, '/estatisticas');
    expect(await screen.findByRole('group', { name: /Tag mais comprada: Sem tags ainda/ })).toBeInTheDocument();
    expect(screen.queryByText(/mais de uma tag/)).toBeNull();
    expect(screen.getByRole('img', { name: /Sem tag: R\$\s*5\.754,60, 100,0% do valor total/ })).toBeInTheDocument();
  });

  it('avisa quando só as 50 maiores tags são mostradas', async () => {
    entrarComo('ADMIN');
    mockarApi({ 'GET /estatisticas': { corpo: completaExemplo({ totalTagsComProduto: 200 }) } });
    renderizarRotas(rotas, '/estatisticas');
    expect(await screen.findByText(/Mostrando as 3 tags de maior valor, de 200 em uso/)).toBeInTheDocument();
  });

  it('Casa vazia: estado vazio com atalho de cadastro para ADMIN', async () => {
    entrarComo('ADMIN');
    mockarApi({ 'GET /estatisticas': { corpo: completaVazia } });
    renderizarRotas(rotas, '/estatisticas');
    expect(await screen.findByText('Ainda não há dados para estatísticas')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Adicionar produto' })).toHaveAttribute('href', '/produtos/novo');
    expect(document.body.textContent).not.toMatch(/NaN/);
  });

  it('LEITOR com Casa vazia vê só a mensagem, sem atalho de cadastro', async () => {
    entrarComo('LEITOR');
    mockarApi({ 'GET /estatisticas': { corpo: completaVazia } });
    renderizarRotas(rotas, '/estatisticas');
    expect(await screen.findByText('Ainda não há dados para estatísticas')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Adicionar produto' })).toBeNull();
  });

  it('erro mostra mensagem com "Tentar de novo" e recarrega; o link volta ao Início', async () => {
    entrarComo('EDITOR');
    let falhar = true;
    mockarApi({
      'GET /estatisticas': () => (falhar ? { status: 500, corpo: { error: 'ERRO_INTERNO', message: 'x' } } : { corpo: completaExemplo() }),
    });
    renderizarRotas(rotas, '/estatisticas');
    const user = userEvent.setup();
    const botao = await screen.findByRole('button', { name: 'Tentar de novo' }, { timeout: 4000 });
    falhar = false;
    await user.click(botao);
    expect(await screen.findByRole('group', { name: /Valor médio/ })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: /Voltar ao Início/ }));
    expect(await screen.findByText('Tela 05')).toBeInTheDocument();
  });

  it('falta de conexão mostra a mensagem de rede', async () => {
    entrarComo('ADMIN');
    const f = mockarApi({});
    f.mockRejectedValue(new TypeError('Failed to fetch'));
    renderizarRotas(rotas, '/estatisticas');
    expect(await screen.findByText(/Sem conexão com a internet/, {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it('503 ESTATISTICAS_INDISPONIVEL mostra mensagem própria com "Tentar de novo"', async () => {
    entrarComo('EDITOR');
    mockarApi({ 'GET /estatisticas': { status: 503, corpo: { error: 'ESTATISTICAS_INDISPONIVEL', message: 'x' } } });
    renderizarRotas(rotas, '/estatisticas');
    expect(await screen.findByText(/estatísticas estão indisponíveis/, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
  });

  it('WCAG 2.5.3: o nome do link de maior gasto contém o texto visível e não há grupo aninhado', async () => {
    entrarComo('EDITOR');
    mockarApi({ 'GET /estatisticas': { corpo: completaExemplo() } });
    renderizarRotas(rotas, '/estatisticas');
    const maior = await screen.findByRole('link', { name: /Maior gasto/ });
    expect(maior).not.toHaveAttribute('aria-label');
    expect(maior.querySelector('[role="group"]')).toBeNull();
    expect(maior.textContent?.replace(/\s+/g, ' ').trim()).toContain('Maior gasto');
    expect(maior).toHaveAccessibleName(/^Maior gasto/);
  });

  it('layout: o grid e o link do maior gasto têm min-w-0 (sem rolagem horizontal a 360 px)', async () => {
    entrarComo('EDITOR');
    mockarApi({ 'GET /estatisticas': { corpo: completaExemplo() } });
    renderizarRotas(rotas, '/estatisticas');
    const maior = await screen.findByRole('link', { name: /Maior gasto/ });
    expect(maior).toHaveClass('min-w-0');
    expect(maior.parentElement?.className).toContain('grid-cols-[minmax(0,1fr)]');
  });
});
