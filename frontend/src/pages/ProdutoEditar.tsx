import { Link, useParams } from 'react-router';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Carregando } from '@/components/Carregando';
import { useUsuarioAtual } from '@/features/auth/hooks';
import { useProduto } from '@/features/produtos/hooks';
import { ProdutoFormulario } from '@/features/produtos/ProdutoFormulario';
import { ApiError } from '@/lib/api';
import { mensagemDeErro } from '@/lib/mensagens';

/** Tela 08 (edição, UC025) — só ADMIN e EDITOR. */
export default function ProdutoEditar() {
  const id = Number(useParams().id);
  const { data: u } = useUsuarioAtual();
  const { data: p, isPending, isError, error, refetch } = useProduto(id);
  if (!u) return null;

  if (u.papel === 'LEITOR') {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl font-bold">Editar produto</h1>
        <Alert tipo="erro">Você não tem permissão para editar produtos.</Alert>
        <Link to={`/produtos/${id}`} className="font-semibold text-primary underline">
          Voltar ao produto
        </Link>
      </div>
    );
  }
  if (isPending) return <Carregando />;
  if (isError) {
    const naoEncontrado = error instanceof ApiError && error.status === 404;
    return (
      <div className="flex flex-col gap-3">
        <Alert tipo="erro">{naoEncontrado ? 'Produto não encontrado. Ele pode ter sido excluído.' : mensagemDeErro(error)}</Alert>
        {naoEncontrado ? (
          <Link to="/produtos" className="font-semibold text-primary underline">
            Voltar para Produtos
          </Link>
        ) : (
          <Button variante="secundario" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-bold">Editar produto</h1>
      <ProdutoFormulario key={p.atualizadoEm} produto={p} />
    </div>
  );
}
