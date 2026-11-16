import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CHAVE_PERFIL } from '@/features/auth/hooks';
import { queryClient } from '@/lib/queryClient';
import { mockarRotas, perfilExemplo, planosExemplo, renderizarRotas } from '@/test/utils';
import AdicionarMembro from './AdicionarMembro';
import Familia from './Familia';

const rotas = [
  { path: '/familia', element: <Familia /> },
  { path: '/familia/adicionar', element: <AdicionarMembro /> },
];

const membros = [
  { usuarioId: 1, nome: 'Ana Silva', email: 'ana@keepit.test', papel: 'ADMIN', entrouEm: '2026-11-01T12:00:00.000Z' },
  { usuarioId: 12, nome: 'Caio Lima', email: 'caio@keepit.test', papel: 'EDITOR', entrouEm: '2026-11-05T12:00:00.000Z' },
  { usuarioId: 15, nome: 'Bia Rocha', email: 'bia@keepit.test', papel: 'LEITOR', entrouEm: '2026-11-09T12:00:00.000Z' },
];
const lista = (emUso = 3, limite = 6) => ({
  casa: { id: 1, nome: 'Casa de Ana' },
  plano: planosExemplo[1],
  assinatura: { status: 'ATIVA', dataRenovacao: '2026-12-12T12:00:00.000Z' },
  limiteMembros: limite,
  membrosEmUso: emUso,
  membros,
});

function abrir(papel: string, api: Parameters<typeof mockarRotas>[0], inicial = '/familia') {
  localStorage.setItem('keepit.token', 't');
  queryClient.setQueryData(CHAVE_PERFIL, { ...perfilExemplo, papel });
  const f = mockarRotas(api);
  return { ...renderizarRotas(rotas, inicial), f };
}
const chamou = (f: ReturnType<typeof mockarRotas>, metodo: string) => f.mock.calls.some(([, i]) => i?.method === metodo);

describe('Família (tela 11)', () => {
  it('ADMIN vê membros, uso, "(você)" e as ações de gestão', async () => {
    abrir('ADMIN', { 'GET /casa/membros': { corpo: lista() } });
    expect(await screen.findByText('Ana Silva (você)')).toBeInTheDocument();
    expect(screen.getByText('3 de 6 membros')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+ Adicionar membro' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gerenciar Caio Lima' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar nome da Casa' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gerenciar Ana Silva' })).toBeNull();
  });

  it.each(['EDITOR', 'LEITOR'])('%s só visualiza: sem adicionar, gerenciar nem editar nome', async (papel) => {
    abrir(papel, { 'GET /casa/membros': { corpo: lista() } });
    expect(await screen.findByText('Caio Lima')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '+ Adicionar membro' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Gerenciar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar nome da Casa' })).toBeNull();
  });

  it('no limite do plano troca o botão por aviso com link para trocar de plano', async () => {
    abrir('ADMIN', { 'GET /casa/membros': { corpo: lista(6, 6) } });
    expect(await screen.findByText(/atingiu o limite de membros/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '+ Adicionar membro' })).toBeNull();
  });

  it('erro de rede mostra mensagem e "Tentar novamente"', async () => {
    localStorage.setItem('keepit.token', 't');
    queryClient.setQueryData(CHAVE_PERFIL, { ...perfilExemplo, papel: 'ADMIN' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('falha')));
    renderizarRotas(rotas, '/familia');
    expect(await screen.findByText(/Sem conexão/, undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });

  it('altera o papel pelo modal (PATCH com o papel escolhido)', async () => {
    const { f } = abrir('ADMIN', {
      'GET /casa/membros': { corpo: lista() },
      'PATCH /casa/membros/12': { corpo: { membro: { ...membros[1], papel: 'LEITOR' } } },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Gerenciar Caio Lima' }));
    const modal = screen.getByRole('dialog', { name: 'Caio Lima' });
    expect(within(modal).getByRole('button', { name: 'Salvar papel' })).toBeDisabled();
    await userEvent.click(within(modal).getByRole('radio', { name: /Leitor/ }));
    await userEvent.click(within(modal).getByRole('button', { name: 'Salvar papel' }));
    const patch = f.mock.calls.find(([, i]) => i?.method === 'PATCH');
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ papel: 'LEITOR' });
  });

  it('remover exige confirmação: só chama DELETE após "Confirmar remoção"', async () => {
    const { f } = abrir('ADMIN', {
      'GET /casa/membros': { corpo: lista() },
      'DELETE /casa/membros/12': { status: 204 },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Gerenciar Caio Lima' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remover da Casa' }));
    expect(chamou(f, 'DELETE')).toBe(false);
    const confirma = screen.getByRole('dialog', { name: 'Remover Caio Lima da Casa?' });
    expect(within(confirma).getByText(/continuam na Casa/)).toBeInTheDocument();
    await userEvent.click(within(confirma).getByRole('button', { name: 'Confirmar remoção' }));
    await screen.findByRole('button', { name: 'Gerenciar Caio Lima' }).catch(() => null);
    expect(chamou(f, 'DELETE')).toBe(true);
  });

  it('cancelar a confirmação não remove', async () => {
    const { f } = abrir('ADMIN', { 'GET /casa/membros': { corpo: lista() } });
    await userEvent.click(await screen.findByRole('button', { name: 'Gerenciar Caio Lima' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remover da Casa' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(chamou(f, 'DELETE')).toBe(false);
  });

  it('renomeia a Casa e valida o nome no cliente', async () => {
    const { f } = abrir('ADMIN', {
      'GET /casa/membros': { corpo: lista() },
      'PATCH /casa': { corpo: { casa: { id: 1, nome: 'Família Souza' } } },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Editar nome da Casa' }));
    const campo = screen.getByLabelText('Nome');
    await userEvent.clear(campo);
    await userEvent.click(screen.getByRole('button', { name: 'Salvar nome' }));
    expect(await screen.findByText('Informe o nome da Casa')).toBeInTheDocument();
    expect(chamou(f, 'PATCH')).toBe(false);
    await userEvent.type(campo, 'Família Souza');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar nome' }));
    const patch = await vi.waitFor(() => {
      const c = f.mock.calls.find(([, i]) => i?.method === 'PATCH');
      if (!c) throw new Error('sem PATCH');
      return c;
    });
    expect(JSON.parse(String(patch[1]?.body))).toEqual({ nome: 'Família Souza' });
  });
});

describe('Adicionar membro (tela 12)', () => {
  it('EDITOR e LEITOR são redirecionados para a lista', async () => {
    abrir('EDITOR', { 'GET /casa/membros': { corpo: lista() } }, '/familia/adicionar');
    expect(await screen.findByText('Membros da Casa')).toBeInTheDocument();
  });

  it('valida o e-mail no cliente e envia papel padrão LEITOR', async () => {
    const { f } = abrir(
      'ADMIN',
      {
        'POST /casa/membros': { status: 201, corpo: { membro: { ...membros[2], nome: 'Lucas' }, membrosEmUso: 4, limiteMembros: 6 } },
        'GET /casa/membros': { corpo: lista(4) },
      },
      '/familia/adicionar',
    );
    await userEvent.type(screen.getByLabelText('E-mail do membro'), 'invalido');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar à Casa' }));
    expect(await screen.findByText('E-mail inválido')).toBeInTheDocument();
    expect(chamou(f, 'POST')).toBe(false);
    const campo = screen.getByLabelText('E-mail do membro');
    await userEvent.clear(campo);
    await userEvent.type(campo, 'Lucas@Email.com');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar à Casa' }));
    expect(await screen.findByText('Lucas foi adicionado à Casa.')).toBeInTheDocument();
    const post = f.mock.calls.find(([, i]) => i?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ email: 'Lucas@Email.com', papel: 'LEITOR' });
  });

  it.each([
    ['USUARIO_NAO_ENCONTRADO', 404, 'A pessoa precisa ter uma conta KeepIT'],
    ['MEMBRO_JA_NA_CASA', 409, 'Esta pessoa já faz parte da sua Casa'],
    ['MEMBRO_NAO_TRANSFERIVEL', 409, 'Esta pessoa não pode ser adicionada agora.'],
  ])('%s mostra a mensagem', async (codigo, status, texto) => {
    abrir('ADMIN', { 'POST /casa/membros': { status, corpo: { error: codigo, message: 'x' } } }, '/familia/adicionar');
    await userEvent.type(screen.getByLabelText('E-mail do membro'), 'a@b.com');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar à Casa' }));
    expect(await screen.findByText(texto)).toBeInTheDocument();
  });

  it('LIMITE_MEMBROS sugere trocar de plano', async () => {
    abrir('ADMIN', { 'POST /casa/membros': { status: 409, corpo: { error: 'LIMITE_MEMBROS', message: 'x' } } }, '/familia/adicionar');
    await userEvent.type(screen.getByLabelText('E-mail do membro'), 'a@b.com');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar à Casa' }));
    expect(await screen.findByText(/atingiu o limite/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Trocar de plano' })).toBeInTheDocument();
  });
});

describe('Família (tela 11) — sair da Casa e e-mail ausente', () => {
  const semEmail = membros.map((m) => ({ usuarioId: m.usuarioId, nome: m.nome, papel: m.papel, entrouEm: m.entrouEm }));

  it('EDITOR não vê parágrafo de e-mail vazio quando a API omite o e-mail', async () => {
    abrir('EDITOR', { 'GET /casa/membros': { corpo: { ...lista(), membros: semEmail } } });
    const item = (await screen.findByText('Caio Lima')).closest('li')!;
    expect(item.querySelectorAll('p')).toHaveLength(1);
  });

  it('ADMIN não vê o botão Sair da Casa', async () => {
    abrir('ADMIN', { 'GET /casa/membros': { corpo: lista() } });
    await screen.findByText('Ana Silva (você)');
    expect(screen.queryByRole('button', { name: 'Sair da Casa' })).not.toBeInTheDocument();
  });

  it('LEITOR confirma a saída, chama POST /casa/sair e passa a ver a Casa própria', async () => {
    const perfilNovo = { ...perfilExemplo, papel: 'ADMIN', casa: { id: 99, nome: 'Casa de Bia', totalMembros: 1 } };
    let saiu = false;
    const f = abrir('LEITOR', {
      'GET /casa/membros': () => ({ corpo: saiu ? { ...lista(1, 1), casa: { id: 99, nome: 'Casa de Bia' }, membros: [membros[2]] } : lista() }),
      'POST /casa/sair': () => {
        saiu = true;
        return { corpo: { perfil: perfilNovo } };
      },
    }).f;
    await userEvent.click(await screen.findByRole('button', { name: 'Sair da Casa' }));
    const dialogo = screen.getByRole('dialog', { name: 'Sair da Casa?' });
    expect(within(dialogo).getByText(/continuam em/)).toBeInTheDocument();
    expect(chamou(f, 'POST')).toBe(false);
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Sair da Casa' }));
    expect(await screen.findByText(/Você saiu da Casa/)).toBeInTheDocument();
    expect(chamou(f, 'POST')).toBe(true);
    expect(queryClient.getQueryData<{ papel: string }>(CHAVE_PERFIL)?.papel).toBe('ADMIN');
    expect(await screen.findByText('Casa de Bia')).toBeInTheDocument();
  });

  it('cancelar fecha o diálogo sem chamar a API', async () => {
    const f = abrir('EDITOR', { 'GET /casa/membros': { corpo: lista() } }).f;
    await userEvent.click(await screen.findByRole('button', { name: 'Sair da Casa' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Sair da Casa?' })).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog', { name: 'Sair da Casa?' })).not.toBeInTheDocument();
    expect(chamou(f, 'POST')).toBe(false);
  });
});

