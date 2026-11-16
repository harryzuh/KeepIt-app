import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CHAVE_PERFIL } from '@/features/auth/hooks';
import { queryClient } from '@/lib/queryClient';
import { mockarRotas, perfilExemplo, planosExemplo, renderizarRotas } from '@/test/utils';
import Planos from './Planos';

const rotas = [
  { path: '/conta/planos', element: <Planos /> },
  { path: '/conta/planos/:plano/pagamento', element: <p>tela de pagamento</p> },
  { path: '/conta/assinatura', element: <p>tela da assinatura</p> },
];

function abrir(papel: string, assinatura: unknown = null, planoAtual = 'INDIVIDUAL', contratacaoDisponivel = true) {
  localStorage.setItem('keepit.token', 't');
  queryClient.setQueryData(CHAVE_PERFIL, { ...perfilExemplo, papel });
  mockarRotas({ 'GET /planos': { corpo: { planos: planosExemplo, planoAtual, assinatura, contratacaoDisponivel } } });
  return renderizarRotas(rotas, '/conta/planos');
}

describe('Planos (tela 13)', () => {
  it('planos desativados: mostra os planos e o aviso, com os botões Assinar desabilitados', async () => {
    const { router } = abrir('ADMIN', null, 'INDIVIDUAL', false);
    expect(await screen.findByRole('heading', { name: 'Família' })).toBeInTheDocument();
    expect(screen.getByText(/planos pagos estão desativados/)).toBeInTheDocument();
    const botoes = screen.getAllByRole('button', { name: /^Assinar .*\(desativado\)$/ });
    expect(botoes).toHaveLength(2);
    for (const b of botoes) expect(b).toBeDisabled();
    await userEvent.click(botoes[0]);
    expect(router.state.location.pathname).toBe('/conta/planos');
  });

  it('com a contratação disponível, não mostra o aviso de planos desativados', async () => {
    abrir('ADMIN');
    await screen.findByRole('heading', { name: 'Família' });
    expect(screen.queryByText(/planos pagos estão desativados/)).toBeNull();
  });

  it('lista os três planos; o Individual não tem botão Assinar e mostra "Plano atual"', async () => {
    abrir('ADMIN');
    expect(await screen.findByRole('heading', { name: 'Família' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Individual' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Business' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Assinar/ })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Plano atual' })).toBeDisabled();
  });

  it('ADMIN vai direto ao pagamento, sem o aviso da tela 24', async () => {
    const { router } = abrir('ADMIN');
    await userEvent.click(await screen.findByRole('button', { name: 'Assinar Família' }));
    expect(router.state.location.pathname).toBe('/conta/planos/familia/pagamento');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each(['EDITOR', 'LEITOR'])('%s vê o aviso de saída da Casa antes do pagamento (tela 24)', async (papel) => {
    const { router } = abrir(papel);
    await userEvent.click(await screen.findByRole('button', { name: 'Assinar Business' }));
    const modal = screen.getByRole('dialog', { name: 'Você vai criar uma nova Casa' });
    expect(within(modal).getByText(/Casa de Ana/, { selector: 'strong' })).toBeInTheDocument();
    // "Ficar na Casa atual" fecha sem navegar
    await userEvent.click(within(modal).getByRole('button', { name: 'Ficar na Casa atual' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(router.state.location.pathname).toBe('/conta/planos');
    await userEvent.click(screen.getByRole('button', { name: 'Assinar Business' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continuar para o pagamento' }));
    expect(router.state.location.pathname).toBe('/conta/planos/business/pagamento');
    expect(router.state.location.state).toEqual({ confirmaSaida: true });
  });

  it('assinatura cancelada mostra o aviso com a data e leva à reativação', async () => {
    abrir('ADMIN', { status: 'CANCELADA', dataRenovacao: '2026-12-12T12:00:00.000Z' }, 'FAMILIA');
    expect(await screen.findByText(/benefícios até 12\/12\/2026/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reativar em Minha assinatura' })).toBeInTheDocument();
  });

  it('mostra erro e permite tentar de novo quando a API falha', async () => {
    localStorage.setItem('keepit.token', 't');
    queryClient.setQueryData(CHAVE_PERFIL, perfilExemplo);
    mockarRotas({ 'GET /planos': { status: 500, corpo: { error: 'ERRO_INTERNO', message: 'x' } } });
    renderizarRotas(rotas, '/conta/planos');
    expect(await screen.findByRole('alert', undefined, { timeout: 3000 })).toBeInTheDocument(); // 1 nova tentativa em falha 5xx
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });
});
