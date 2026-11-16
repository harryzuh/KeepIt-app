import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { sessao } from '@/lib/sessao';
import { mockarFetch, perfilExemplo, renderizarRotas } from '@/test/utils';
import type { Perfil } from './tipos';
import { ExcluirContaModal } from './ExcluirContaModal';

describe('ExcluirContaModal', () => {
  it('SENHA_INCORRETA mostra "Senha incorreta" e não encerra a sessão', async () => {
    sessao.definirToken('t');
    mockarFetch({ status: 401, corpo: { error: 'SENHA_INCORRETA', message: 'x' } });
    renderizarRotas([{ path: '/', element: <ExcluirContaModal perfil={perfilExemplo as Perfil} aberto aoFechar={() => {}} /> }]);
    await userEvent.type(screen.getByLabelText('Digite sua senha para confirmar'), 'errada123');
    await userEvent.click(screen.getByRole('button', { name: 'Excluir minha conta' }));
    expect(await screen.findByText('Senha incorreta')).toBeInTheDocument();
    expect(screen.queryByText('Senha atual incorreta')).toBeNull();
    expect(localStorage.getItem('keepit.token')).toBe('t');
  });
});

describe('ExcluirContaModal: aviso do ADMIN (m2-casa.md, seção 7)', () => {
  const titular = {
    ...perfilExemplo,
    casa: { id: 1, nome: 'Casa', totalMembros: 2 },
    plano: { nome: 'FAMILIA', preco: '19.90', limiteMembros: 5, limiteArmazenamentoGb: 50 },
    assinatura: { status: 'ATIVA', dataRenovacao: '2026-12-15T12:00:00.000Z' },
  } as unknown as Perfil;

  it('cita plano, renovação e a promoção do herdeiro, sem dizer que membros perdem acesso', () => {
    renderizarRotas([{ path: '/', element: <ExcluirContaModal perfil={titular} aberto aoFechar={() => {}} /> }]);
    const texto = document.body.textContent ?? '';
    expect(texto).toMatch(/plano Família/);
    expect(texto).toMatch(/renovação em/);
    expect(texto).toMatch(/membro mais antigo assume como ADMIN/);
    expect(texto).toMatch(/Casa própria/);
    expect(texto).not.toMatch(/perdem o acesso/);
  });
});
