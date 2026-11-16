import { Navigate, Outlet } from 'react-router';
import { useSaida, useToken } from '@/lib/sessao';
import { AppLayout } from '@/components/AppLayout';
import { Carregando } from '@/components/Carregando';
import { useUsuarioAtual } from './hooks';

/** Rotas protegidas: sem token vai para 02 (ou o destino definido ao sair). */
export function RotaProtegida() {
  const token = useToken();
  const saida = useSaida();
  const { isPending, isError, refetch } = useUsuarioAtual();

  if (!token) return <Navigate to={saida.destino} state={{ aviso: saida.aviso }} replace />;
  if (isPending) return <Carregando />;
  if (isError) {
    return (
      <div className="mx-auto max-w-sm p-6 text-center" role="alert">
        <p className="mb-4">Não foi possível carregar seus dados.</p>
        <button className="font-semibold text-primary underline" onClick={() => refetch()}>
          Tentar novamente
        </button>
      </div>
    );
  }
  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}

/** Rotas públicas de acesso: usuário com sessão vai para a tela 05. */
export function RotaPublica() {
  const token = useToken();
  if (token) return <Navigate to="/inicio" replace />;
  return <Outlet />;
}
