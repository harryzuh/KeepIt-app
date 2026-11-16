import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { queryClient } from '@/lib/queryClient';
import { CHAVE_PERFIL } from '@/features/auth/hooks';
import {
  BYTES_JPEG,
  BYTES_PNG,
  arquivoDeTeste,
  chamadas,
  corposEnviados,
  detalhe,
  entrarComo,
  mockarApi,
  mockarPutS3,
  tagsExemplo,
} from '@/test/produtos';
import { perfilExemplo, renderizarRotas } from '@/test/utils';
import DetalheProduto from './DetalheProduto';
import ProdutoEditar from './ProdutoEditar';
import ProdutoNovo from './ProdutoNovo';

const rotas = [
  { path: '/produtos/novo', element: <ProdutoNovo /> },
  { path: '/produtos/:id/editar', element: <ProdutoEditar /> },
  { path: '/produtos/:id', element: <DetalheProduto /> },
  { path: '/conta/planos', element: <p>Tela de planos</p> },
  { path: '/produtos', element: <p>Lista de produtos</p> },
];

const urlEnvio = (n: number) => ({
  chave: `casas/1/fotos/${n}.png`,
  url: `http://s3:9000/keepit-fotos/casas/1/fotos/${n}.png?X-Amz-Signature=s${n}`,
  metodo: 'PUT',
  cabecalhos: { 'Content-Type': 'image/png' },
  expiraEm: '2026-11-15T17:05:00.000Z',
  confirmarAte: '2026-11-15T19:00:00.000Z',
});

const vazio = { itens: [], pagina: 1, limite: 20, total: 0, totalPaginas: 0 };
const foto = (id: number, ordem: number) => ({
  id,
  ordem,
  tipo: 'PNG' as const,
  tamanhoBytes: 1000,
  url: `http://s3:9000/keepit-fotos/casas/1/fotos/${id}.png?X`,
  expiraEm: '2026-11-15T18:00:00.000Z',
});

function base(extra: Record<string, unknown> = {}) {
  let n = 0;
  return {
    'GET /tags': { corpo: tagsExemplo },
    'GET /produtos/21': { corpo: detalhe() },
    'GET /produtos/21/historico': { corpo: vazio },
    'POST /produtos/fotos/upload-url': () => ({ corpo: urlEnvio(++n) }),
    ...extra,
  } as Parameters<typeof mockarApi>[0];
}

async function preencher(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Nome do produto'), 'Cafeteira Elétrica');
  await user.type(screen.getByLabelText('Preço (R$)'), '249,90');
}

const escolher = (...arquivos: File[]) => userEvent.upload(screen.getByTestId('entrada-fotos'), arquivos);
const png = (nome = 'a.png', tamanho?: number) => arquivoDeTeste(nome, BYTES_PNG, 'image/png', tamanho);

beforeEach(() => {
  let u = 0;
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => `blob:prev-${++u}`), revokeObjectURL: vi.fn() }));
});

describe('Fotos no cadastro (tela 08)', () => {
  it('envia a foto ao S3 e salva o produto com a chave em `fotos`', async () => {
    entrarComo('EDITOR');
    const f = mockarApi(base({ 'POST /produtos': { status: 201, corpo: { resultado: 'CRIADO', produto: detalhe() } } }));
    const puts = mockarPutS3();
    renderizarRotas(rotas, '/produtos/novo');
    const user = userEvent.setup();
    await preencher(user);
    await escolher(png());
    expect(await screen.findByText(/Enviada/)).toBeInTheDocument();
    expect(screen.getByAltText('Prévia da foto 1 de Cafeteira Elétrica')).toBeInTheDocument();
    expect(puts).toHaveLength(1);
    expect(puts[0].cabecalhos).toEqual({ 'Content-Type': 'image/png' });
    await user.click(screen.getByRole('button', { name: 'Salvar produto' }));
    await screen.findByRole('heading', { name: 'Cafeteira Elétrica' });
    expect(corposEnviados(f, 'POST /produtos')[0].fotos).toEqual([{ chave: 'casas/1/fotos/1.png' }]);
  });

  it('mostra a barra de progresso enquanto envia e bloqueia o salvar', async () => {
    entrarComo('EDITOR');
    mockarApi(base());
    // PUT que não termina
    vi.stubGlobal(
      'XMLHttpRequest',
      class {
        upload = { onprogress: null as null | ((e: unknown) => void) };
        open() {}
        setRequestHeader() {}
        send() {
          setTimeout(() => this.upload.onprogress?.({ lengthComputable: true, loaded: 30, total: 100 }), 0);
        }
      },
    );
    renderizarRotas(rotas, '/produtos/novo');
    const user = userEvent.setup();
    await preencher(user);
    await escolher(png());
    const barra = await screen.findByRole('progressbar', { name: 'Enviando foto 1' });
    await waitFor(() => expect(barra).toHaveAttribute('aria-valuenow', '30'));
    expect(screen.getByRole('button', { name: 'Salvar produto' })).toBeDisabled();
  });

  it('recusa no cliente tipo falso, arquivo grande e o 4º arquivo, sem chamar a API', async () => {
    entrarComo('EDITOR');
    const f = mockarApi(base());
    mockarPutS3();
    renderizarRotas(rotas, '/produtos/novo');
    await screen.findByLabelText('Nome do produto');
    await escolher(arquivoDeTeste('x.png', [0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0], 'image/png'));
    expect(await screen.findByText('Use imagem JPEG ou PNG de até 5 MB.')).toBeInTheDocument();
    await escolher(png('grande.png', 5 * 1024 * 1024 + 1));
    expect(await screen.findByText('Use imagem JPEG ou PNG de até 5 MB.')).toBeInTheDocument();
    expect(chamadas(f).filter((c) => c.includes('upload-url'))).toHaveLength(0);

    await escolher(png('1.png'), arquivoDeTeste('2.jpg', BYTES_JPEG, 'image/jpeg'), png('3.png'), png('4.png'));
    expect(await screen.findByText('Um produto aceita até 3 fotos.')).toBeInTheDocument();
    await waitFor(() => expect(chamadas(f).filter((c) => c.includes('upload-url'))).toHaveLength(3));
    await waitFor(() => expect(screen.getAllByText(/Enviada/)).toHaveLength(3));
    expect(screen.getByRole('button', { name: 'Limite de 3 fotos atingido' })).toBeDisabled();
  });

  it('botões das fotos: nome acessível contém o texto visível (WCAG 2.5.3), alvo de 44px e aviso de privacidade', async () => {
    entrarComo('EDITOR');
    mockarApi(base({}));
    mockarPutS3();
    renderizarRotas(rotas, '/produtos/novo');
    const user = userEvent.setup();
    await preencher(user);
    await escolher(png('1.png'), png('2.png'));
    await waitFor(() => expect(screen.getAllByText(/Enviada/)).toHaveLength(2));
    const capa = screen.getByRole('button', { name: 'Tornar capa da foto 2' });
    expect(capa).toHaveTextContent('Tornar capa');
    expect(capa).toHaveClass('min-h-11');
    expect(screen.getByRole('button', { name: 'Remover foto 1' })).toHaveClass('min-h-11');
    expect(screen.getByText(/localização e outros dados ocultos da foto são removidos/)).toBeInTheDocument();
  });

  it('remover uma foto antes de salvar a tira da lista enviada', async () => {
    entrarComo('EDITOR');
    const f = mockarApi(base({ 'POST /produtos': { status: 201, corpo: { resultado: 'CRIADO', produto: detalhe() } } }));
    mockarPutS3();
    renderizarRotas(rotas, '/produtos/novo');
    const user = userEvent.setup();
    await preencher(user);
    await escolher(png('1.png'), png('2.png'));
    await waitFor(() => expect(screen.getAllByText(/Enviada/)).toHaveLength(2));
    await user.click(screen.getByRole('button', { name: 'Remover foto 1' }));
    await user.click(screen.getByRole('button', { name: 'Salvar produto' }));
    await screen.findByRole('heading', { name: 'Cafeteira Elétrica' });
    expect(corposEnviados(f, 'POST /produtos')[0].fotos).toEqual([{ chave: 'casas/1/fotos/2.png' }]);
  });

  it('COTA_EXCEDIDA no upload-url mostra a mensagem com link para os Planos', async () => {
    entrarComo('EDITOR');
    mockarApi(
      base({
        'POST /produtos/fotos/upload-url': {
          status: 409,
          corpo: { error: 'COTA_EXCEDIDA', message: 'x', details: { plano: 'INDIVIDUAL', usadoBytes: 1_000_000_000, limiteBytes: 1_073_741_824 } },
        },
      }),
    );
    const puts = mockarPutS3();
    renderizarRotas(rotas, '/produtos/novo');
    await screen.findByLabelText('Nome do produto');
    await escolher(png());
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Espaço do plano esgotado.');
    expect(alerta).toHaveTextContent(/Você usa 954 MB de 1 GB/);
    expect(within(alerta).getByRole('link', { name: 'Ver planos' })).toHaveAttribute('href', '/conta/planos');
    expect(puts).toHaveLength(0);
  });

  it('COTA_EXCEDIDA ao salvar mostra o alerta com link e mantém os dados', async () => {
    entrarComo('EDITOR');
    mockarApi(base({ 'POST /produtos': { status: 409, corpo: { error: 'COTA_EXCEDIDA', message: 'x', details: { plano: 'INDIVIDUAL', usadoBytes: 5, limiteBytes: 6 } } } }));
    mockarPutS3();
    renderizarRotas(rotas, '/produtos/novo');
    const user = userEvent.setup();
    await preencher(user);
    await escolher(png());
    await screen.findByText(/Enviada/);
    await user.click(screen.getByRole('button', { name: 'Salvar produto' }));
    expect(await screen.findByRole('link', { name: 'Ver planos' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nome do produto')).toHaveValue('Cafeteira Elétrica');
  });

  it('ARQUIVO_INVALIDO ao salvar (chave vencida) pede para reenviar a foto', async () => {
    entrarComo('EDITOR');
    mockarApi(
      base({ 'POST /produtos': { status: 422, corpo: { error: 'ARQUIVO_INVALIDO', message: 'x', details: [{ campo: 'fotos.0', mensagem: 'vencida' }] } } }),
    );
    mockarPutS3();
    renderizarRotas(rotas, '/produtos/novo');
    const user = userEvent.setup();
    await preencher(user);
    await escolher(png());
    await screen.findByText(/Enviada/);
    await user.click(screen.getByRole('button', { name: 'Salvar produto' }));
    expect(await screen.findByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
    expect(screen.getAllByText(/JPEG ou PNG de até 5 MB/).length).toBeGreaterThan(0);
  });

  it('mostra o uso de armazenamento do plano (RF39)', async () => {
    entrarComo('EDITOR');
    queryClient.setQueryData(CHAVE_PERFIL, {
      ...perfilExemplo,
      papel: 'EDITOR',
      uso: { armazenamento: { usadoBytes: 536_870_912, limiteBytes: 1_073_741_824 } },
    });
    mockarApi(base());
    renderizarRotas(rotas, '/produtos/novo');
    expect(await screen.findByText('Armazenamento: 512 MB de 1 GB usados')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Armazenamento usado' })).toHaveAttribute('aria-valuenow', '50');
  });

  it('sem o uso na API, mostra só o limite do plano', async () => {
    entrarComo('EDITOR');
    mockarApi(base());
    renderizarRotas(rotas, '/produtos/novo');
    expect(await screen.findByText('Armazenamento do plano: até 1 GB.')).toBeInTheDocument();
  });
});

describe('Aviso de que os produtos ficam na Casa (história 3.5)', () => {
  it('EDITOR vê a nota no cadastro, pode dispensá-la e a escolha é lembrada', async () => {
    entrarComo('EDITOR');
    mockarApi(base());
    const { unmount } = renderizarRotas(rotas, '/produtos/novo');
    expect(await screen.findByText('Os produtos ficam na Casa, mesmo que você saia dela.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Entendi' }));
    expect(screen.queryByText(/ficam na Casa/)).toBeNull();
    unmount();
    renderizarRotas(rotas, '/produtos/novo');
    await screen.findByLabelText('Nome do produto');
    expect(screen.queryByText(/ficam na Casa/)).toBeNull();
  });

  it('LEITOR não vê o formulário nem a nota', async () => {
    entrarComo('LEITOR');
    mockarApi(base());
    renderizarRotas(rotas, '/produtos/novo');
    await screen.findByText(/não tem permissão/);
    expect(screen.queryByText(/ficam na Casa/)).toBeNull();
  });
});

describe('Fotos na edição (tela 08) e no detalhe (tela 07)', () => {
  const comFotos = () => detalhe({ fotos: [foto(11, 0), foto(12, 1)] });

  it('remover uma foto existente manda a lista final com os ids restantes', async () => {
    entrarComo('ADMIN');
    const f = mockarApi(base({ 'GET /produtos/21': { corpo: comFotos() }, 'PATCH /produtos/21': { corpo: comFotos() } }));
    renderizarRotas(rotas, '/produtos/21/editar');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Remover foto 1' }));
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(corposEnviados(f, 'PATCH /produtos/21')).toHaveLength(1));
    expect(corposEnviados(f, 'PATCH /produtos/21')[0].fotos).toEqual([{ id: 12 }]);
  });

  it('sem mexer nas fotos, o PATCH não envia `fotos`; foto nova entra como { chave } depois dos ids', async () => {
    entrarComo('ADMIN');
    const f = mockarApi(base({ 'GET /produtos/21': { corpo: comFotos() }, 'PATCH /produtos/21': { corpo: comFotos() } }));
    mockarPutS3();
    renderizarRotas(rotas, '/produtos/21/editar');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(corposEnviados(f, 'PATCH /produtos/21')).toHaveLength(1));
    expect(corposEnviados(f, 'PATCH /produtos/21')[0]).not.toHaveProperty('fotos');

    renderizarRotas(rotas, '/produtos/21/editar');
    await screen.findAllByRole('button', { name: 'Salvar alterações' });
    await escolher(png());
    await screen.findByText(/Enviada/);
    await user.click(screen.getAllByRole('button', { name: 'Salvar alterações' }).at(-1)!);
    await waitFor(() => expect(corposEnviados(f, 'PATCH /produtos/21')).toHaveLength(2));
    expect(corposEnviados(f, 'PATCH /produtos/21')[1].fotos).toEqual([{ id: 11 }, { id: 12 }, { chave: 'casas/1/fotos/1.png' }]);
  });

  it('o detalhe mostra as fotos com texto alternativo; sem fotos mostra o quadro neutro', async () => {
    entrarComo('LEITOR');
    mockarApi(base({ 'GET /produtos/21': { corpo: comFotos() } }));
    renderizarRotas(rotas, '/produtos/21');
    expect(await screen.findByAltText('Foto de Cafeteira Elétrica (foto 1 de 2)')).toBeInTheDocument();
    expect(screen.getByAltText('Foto de Cafeteira Elétrica (foto 2 de 2)')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Editar produto' })).toBeNull();
  });
});
