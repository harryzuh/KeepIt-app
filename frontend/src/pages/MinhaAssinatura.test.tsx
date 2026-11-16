import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CHAVE_PERFIL } from '@/features/auth/hooks';
import { queryClient } from '@/lib/queryClient';
import { mockarRotas, perfilExemplo, planosExemplo, renderizarRotas } from '@/test/utils';
import MinhaAssinatura from './MinhaAssinatura';

const rotas = [
  { path: '/conta/assinatura', element: <MinhaAssinatura /> },
  { path: '/conta/planos', element: <p>tela de planos</p> },
];

const base = {
  id: 7,
  plano: planosExemplo[1],
  dataInicio: '2026-11-15T17:00:00.000Z',
  dataRenovacao: '2026-12-12T12:00:00.000Z',
};
const ativa = { ...base, status: 'ATIVA', dataCancelamento: null, renovaAutomaticamente: true, podeReativar: false };
const cancelada = { ...base, status: 'CANCELADA', dataCancelamento: '2026-11-20T10:00:00.000Z', renovaAutomaticamente: false, podeReativar: true };

const resposta = (assinatura: unknown) => ({
  assinatura,
  planoAtual: planosExemplo[1],
  uso: { membros: { emUso: 3, limite: 6 }, armazenamento: { usadoBytes: 0, limiteBytes: 20 * 1024 ** 3 } },
  metodoPagamento: { marca: 'VISA', ultimos4: '4242', atualizadoEm: '2026-11-15T17:00:00.000Z' },
});

function abrir(papel: string, rotasApi: Parameters<typeof mockarRotas>[0]) {
  localStorage.setItem('keepit.token', 't');
  queryClient.setQueryData(CHAVE_PERFIL, { ...perfilExemplo, papel });
  const f = mockarRotas(rotasApi);
  return { ...renderizarRotas(rotas, '/conta/assinatura'), f };
}

describe('MinhaAssinatura (tela 15)', () => {
  it('mostra plano, status, renovação, uso e cartão', async () => {
    abrir('ADMIN', { 'GET /assinaturas/atual': { corpo: resposta(ativa) } });
    expect(await screen.findByText('12/12/2026')).toBeInTheDocument();
    expect(screen.getByText('ATIVA')).toBeInTheDocument();
    expect(screen.getByText('3 de 6')).toBeInTheDocument();
    expect(screen.getByText('Visa final 4242')).toBeInTheDocument();
  });

  it('cancelar exige confirmação: só chama a API no "Confirmar cancelamento" e envia o motivo', async () => {
    let atual: unknown = ativa;
    const { f } = abrir('ADMIN', {
      'GET /assinaturas/atual': () => ({ corpo: resposta(atual) }),
      'POST /assinaturas/atual/cancelar': () => {
        atual = cancelada;
        return { corpo: { assinatura: cancelada } };
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar assinatura' }));
    const modal = screen.getByRole('dialog', { name: 'Cancelar a assinatura?' });
    expect(within(modal).getByText('12/12/2026')).toBeInTheDocument();
    expect(f.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(false);
    await userEvent.type(within(modal).getByLabelText('Motivo (opcional)'), 'Mudei de casa');
    await userEvent.click(within(modal).getByRole('button', { name: 'Confirmar cancelamento' }));
    expect(await screen.findByText(/Assinatura cancelada\. Você mantém/)).toBeInTheDocument();
    const post = f.mock.calls.find(([, i]) => i?.method === 'POST')!;
    expect(JSON.parse(String(post[1]?.body))).toEqual({ motivo: 'Mudei de casa' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Reativar assinatura' })).toBeInTheDocument();
  });

  it('"Manter assinatura" fecha o modal sem chamar a API', async () => {
    const { f } = abrir('ADMIN', { 'GET /assinaturas/atual': { corpo: resposta(ativa) } });
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar assinatura' }));
    await userEvent.click(screen.getByRole('button', { name: 'Manter assinatura' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(f.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(false);
  });

  it('reativa uma assinatura cancelada', async () => {
    let atual: unknown = cancelada;
    abrir('ADMIN', {
      'GET /assinaturas/atual': () => ({ corpo: resposta(atual) }),
      'POST /assinaturas/atual/reativar': () => {
        atual = ativa;
        return { corpo: { assinatura: ativa } };
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Reativar assinatura' }));
    expect(await screen.findByRole('button', { name: 'Cancelar assinatura' })).toBeInTheDocument();
  });

  it('Casa Individual: estado vazio com link para os planos e sem botão de cancelar', async () => {
    abrir('ADMIN', { 'GET /assinaturas/atual': { corpo: { ...resposta(null), planoAtual: planosExemplo[0] } } });
    expect(await screen.findByText(/plano Individual/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver planos' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar assinatura' })).toBeNull();
  });

  it.each(['EDITOR', 'LEITOR'])('%s é redirecionado e não chama GET /assinaturas/atual', async (papel) => {
    const { f } = abrir(papel, {});
    expect(await screen.findByText('tela de planos')).toBeInTheDocument();
    expect(f).not.toHaveBeenCalled();
  });

  it('erro sem conexão mostra mensagem e permite tentar de novo', async () => {
    localStorage.setItem('keepit.token', 't');
    queryClient.setQueryData(CHAVE_PERFIL, perfilExemplo);
    const { vi } = await import('vitest');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    renderizarRotas(rotas, '/conta/assinatura');
    expect(await screen.findByText(/Sem conexão/, undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });
});
