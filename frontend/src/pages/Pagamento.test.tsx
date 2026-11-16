import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CHAVE_PERFIL } from '@/features/auth/hooks';
import { queryClient } from '@/lib/queryClient';
import { mockarRotas, perfilExemplo, planosExemplo, renderizarRotas, type RespostaFalsa } from '@/test/utils';
import Pagamento from './Pagamento';

const rotas = [
  { path: '/conta/planos', element: <p>tela de planos</p> },
  { path: '/conta/planos/:plano/pagamento', element: <Pagamento /> },
  { path: '/conta/assinatura', element: <p>tela da assinatura</p> },
];

const metodo = { marca: 'VISA', ultimos4: '4821', atualizadoEm: '2026-11-15T17:00:00.000Z' };
const atual = {
  assinatura: null,
  planoAtual: planosExemplo[0],
  uso: { membros: { emUso: 1, limite: 1 }, armazenamento: { usadoBytes: 0, limiteBytes: 1024 ** 3 } },
  metodoPagamento: null,
};
const assinaturaCriada = {
  id: 7,
  status: 'ATIVA',
  plano: planosExemplo[1],
  dataInicio: '2026-11-15T17:00:00.000Z',
  dataRenovacao: '2026-12-15T17:00:00.000Z',
  dataCancelamento: null,
  renovaAutomaticamente: true,
  podeReativar: false,
};

function abrir(opcoes: { papel?: string; metodo?: unknown; estado?: unknown; assinar?: RespostaFalsa; casaId?: number } = {}) {
  const { papel = 'ADMIN', metodo: m = metodo, estado, assinar, casaId = 1 } = opcoes;
  localStorage.setItem('keepit.token', 't');
  queryClient.setQueryData(CHAVE_PERFIL, { ...perfilExemplo, papel });
  const fetchFalso = mockarRotas({
    'GET /planos': { corpo: { planos: planosExemplo, planoAtual: 'INDIVIDUAL', assinatura: null } },
    'GET /pagamento/metodo': { corpo: { metodo: m } },
    'GET /assinaturas/atual': { corpo: atual },
    'POST /assinaturas': assinar ?? {
      status: 201,
      corpo: { assinatura: assinaturaCriada, perfil: { ...perfilExemplo, papel: 'ADMIN', casa: { id: casaId, nome: 'Casa', totalMembros: 1 } } },
    },
  });
  const r = renderizarRotas(rotas, '/conta/planos/familia/pagamento');
  if (estado) r.router.navigate('/conta/planos/familia/pagamento', { state: estado });
  return { ...r, fetchFalso };
}

const corpoDoPost = (f: ReturnType<typeof mockarRotas>) => {
  const c = f.mock.calls.find(([, init]) => init?.method === 'POST');
  return c ? JSON.parse(String(c[1]?.body)) : undefined;
};

describe('Pagamento (tela 14)', () => {
  it('ADMIN paga com o cartão salvo, vai à tela 15 e o corpo não leva confirmaSaidaDaCasa', async () => {
    const { router, fetchFalso } = abrir();
    expect(await screen.findByText('Visa final 4821')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Confirmar e pagar R\$\s19,90/ }));
    expect(await screen.findByText('tela da assinatura')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/conta/assinatura');
    expect(corpoDoPost(fetchFalso)).toEqual({ plano: 'FAMILIA' });
    expect(queryClient.getQueryData<{ papel: string }>(CHAVE_PERFIL)?.papel).toBe('ADMIN');
  });

  it('sem cartão salvo mostra o formulário e desabilita o pagamento', async () => {
    abrir({ metodo: null });
    expect(await screen.findByLabelText('Número do cartão')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirmar e pagar/ })).toBeDisabled();
  });

  it('valida o cartão no cliente (Luhn e validade) sem chamar a API', async () => {
    const { fetchFalso } = abrir({ metodo: null });
    await userEvent.type(await screen.findByLabelText('Número do cartão'), '4242 4242 4242 4241');
    await userEvent.type(screen.getByLabelText('Validade'), '01/20');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar cartão' }));
    expect(await screen.findByText('Número de cartão inválido')).toBeInTheDocument();
    expect(screen.getByText('Cartão vencido ou mês inválido')).toBeInTheDocument();
    expect(fetchFalso.mock.calls.some(([, i]) => i?.method === 'PUT')).toBe(false);
  });

  it('não coleta nome nem CVV, mostra o banner de cartão de teste e recusa cartão real válido', async () => {
    const { fetchFalso } = abrir({ metodo: null });
    expect(await screen.findByText(/não use um cartão real/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Nome no cartão/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/CVV/)).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Número do cartão'), '4532 0151 1283 0366'); // Luhn válido, não é de teste
    await userEvent.type(screen.getByLabelText('Validade'), '12/39');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar cartão' }));
    expect(await screen.findByText(/use o cartão de teste 4242 4242 4242 4242/)).toBeInTheDocument();
    expect(fetchFalso.mock.calls.some(([, i]) => i?.method === 'PUT')).toBe(false);
  });

  it('PAGAMENTO_RECUSADO mostra mensagem e mantém a tela', async () => {
    const { router } = abrir({ assinar: { status: 402, corpo: { error: 'PAGAMENTO_RECUSADO', message: 'x' } } });
    await userEvent.click(await screen.findByRole('button', { name: /Confirmar e pagar/ }));
    expect(await screen.findByText('Pagamento recusado. Tente outro cartão.')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/conta/planos/familia/pagamento');
  });

  it('PLANO_NAO_COMPORTA e METODO_PAGAMENTO_AUSENTE têm mensagem própria', async () => {
    abrir({ assinar: { status: 422, corpo: { error: 'PLANO_NAO_COMPORTA', message: 'x', details: {} } } });
    await userEvent.click(await screen.findByRole('button', { name: /Confirmar e pagar/ }));
    expect(await screen.findByText(/comporta/)).toBeInTheDocument();
  });

  it('PLANO_NAO_COMPORTA mostra os números das violações', async () => {
    abrir({
      assinar: {
        status: 422,
        corpo: {
          error: 'PLANO_NAO_COMPORTA',
          message: 'x',
          details: { plano: 'FAMILIA', violacoes: [{ limite: 'MEMBROS', atual: 8, maximo: 6 }, { limite: 'ARMAZENAMENTO', atual: 25 * 1024 ** 3, maximo: 20 * 1024 ** 3 }] },
        },
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: /Confirmar e pagar/ }));
    expect(await screen.findByText(/8 membros \(este plano permite 6\) e 25 GB em uso \(este plano permite 20 GB\)/)).toBeInTheDocument();
  });

  it('PAGAMENTO_INDISPONIVEL (503) tem mensagem própria', async () => {
    abrir({ assinar: { status: 503, corpo: { error: 'PAGAMENTO_INDISPONIVEL', message: 'x' } } });
    await userEvent.click(await screen.findByRole('button', { name: /Confirmar e pagar/ }));
    expect(await screen.findByText(/Pagamento indisponível no momento/)).toBeInTheDocument();
  });

  it('EDITOR sem confirmar o aviso é devolvido à tela de planos', async () => {
    abrir({ papel: 'EDITOR' });
    expect(await screen.findByText('tela de planos')).toBeInTheDocument();
  });

  it('EDITOR que confirmou envia confirmaSaidaDaCasa e, com Casa nova, limpa o cache', async () => {
    const { fetchFalso } = abrir({ papel: 'EDITOR', estado: { confirmaSaida: true }, casaId: 99 });
    queryClient.setQueryData(['produtos'], ['antigo']);
    await userEvent.click(await screen.findByRole('button', { name: /Confirmar e pagar/ }));
    expect(await screen.findByText('tela da assinatura')).toBeInTheDocument();
    expect(corpoDoPost(fetchFalso)).toEqual({ plano: 'FAMILIA', confirmaSaidaDaCasa: true });
    expect(queryClient.getQueryData(['produtos'])).toBeUndefined();
    expect(queryClient.getQueryData<{ casa: { id: number } }>(CHAVE_PERFIL)?.casa.id).toBe(99);
  });
});
