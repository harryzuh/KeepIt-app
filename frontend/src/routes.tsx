import { Outlet, createBrowserRouter } from 'react-router';
import { ConexaoBanner } from './components/ConexaoBanner';
import { RotaProtegida, RotaPublica } from './features/auth/guardas';
import AdicionarMembro from './pages/AdicionarMembro';
import AlterarSenha from './pages/AlterarSenha';
import BoasVindas from './pages/BoasVindas';
import Conta from './pages/Conta';
import DetalheProduto from './pages/DetalheProduto';
import CriarConta from './pages/CriarConta';
import DadosCadastrais from './pages/DadosCadastrais';
import Entrar from './pages/Entrar';
import Estatisticas from './pages/Estatisticas';
import Familia from './pages/Familia';
import Inicio from './pages/Inicio';
import MinhaAssinatura from './pages/MinhaAssinatura';
import Pagamento from './pages/Pagamento';
import Planos from './pages/Planos';
import ProdutoEditar from './pages/ProdutoEditar';
import ProdutoNovo from './pages/ProdutoNovo';
import Produtos from './pages/Produtos';
import RecuperarSenha from './pages/RecuperarSenha';
import Termos from './pages/Termos';

function Raiz() {
  return (
    <>
      <ConexaoBanner />
      <Outlet />
    </>
  );
}

// Rotas do M1, M2, M5, M3 e M4 (docs/01-modelagem-produto/1.1-sitemap.md). Telas de outros módulos entram aqui conforme existirem.
export const rotas = [
  {
    element: <Raiz />,
    children: [
      { path: '/termos', element: <Termos /> }, // pública, com ou sem sessão
      {
        element: <RotaPublica />,
        children: [
          { path: '/', element: <BoasVindas /> }, // 01
          { path: '/entrar', element: <Entrar /> }, // 02
          { path: '/criar-conta', element: <CriarConta /> }, // 03
          { path: '/recuperar-senha', element: <RecuperarSenha /> }, // 04 e 18
        ],
      },
      {
        element: <RotaProtegida />,
        children: [
          { path: '/inicio', element: <Inicio /> }, // 05 e 17 (desktop)
          { path: '/estatisticas', element: <Estatisticas /> }, // 10
          { path: '/produtos', element: <Produtos /> }, // 06
          { path: '/produtos/novo', element: <ProdutoNovo /> }, // 08 (+ modal 09) — só ADMIN e EDITOR
          { path: '/produtos/:id', element: <DetalheProduto /> }, // 07 (+ modal 23)
          { path: '/produtos/:id/editar', element: <ProdutoEditar /> }, // 08 (edição) — só ADMIN e EDITOR
          { path: '/familia', element: <Familia /> }, // 11 (+ modal 22)
          { path: '/familia/adicionar', element: <AdicionarMembro /> }, // 12 (só ADMIN)
          { path: '/conta', element: <Conta /> }, // 16 (+ modal 21)
          { path: '/conta/dados', element: <DadosCadastrais /> }, // 20
          { path: '/conta/senha', element: <AlterarSenha /> }, // 19
          { path: '/conta/planos', element: <Planos /> }, // 13 (+ modal 24)
          { path: '/conta/planos/:plano/pagamento', element: <Pagamento /> }, // 14
          { path: '/conta/assinatura', element: <MinhaAssinatura /> }, // 15 (só ADMIN)
        ],
      },
      { path: '*', element: <NaoEncontrada /> },
    ],
  },
];

function NaoEncontrada() {
  return (
    <main className="mx-auto max-w-sm p-10 text-center">
      <h1 className="mb-2 text-2xl font-bold">Página não encontrada</h1>
      <a href="/" className="font-semibold text-primary underline">
        Voltar ao início
      </a>
    </main>
  );
}

export const router = createBrowserRouter(rotas);
