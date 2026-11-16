import { Link } from 'react-router';
import { Alert } from '@/components/Alert';
import { useUsuarioAtual } from '@/features/auth/hooks';
import { ProdutoFormulario } from '@/features/produtos/ProdutoFormulario';

/** Tela 08 (cadastro) — só ADMIN e EDITOR; o LEITOR que abrir a URL vê um aviso (a API recusa com 403). */
export default function ProdutoNovo() {
  const { data: u } = useUsuarioAtual();
  if (!u) return null;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-bold">Adicionar produto</h1>
      {u.papel === 'LEITOR' ? (
        <>
          <Alert tipo="erro">Você não tem permissão para cadastrar produtos. Peça a um ADMIN da Casa para mudar seu papel.</Alert>
          <Link to="/produtos" className="font-semibold text-primary underline">
            Voltar para Produtos
          </Link>
        </>
      ) : (
        <ProdutoFormulario />
      )}
    </div>
  );
}
