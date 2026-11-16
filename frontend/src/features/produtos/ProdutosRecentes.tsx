import { Link } from 'react-router';
import { Alert } from '@/components/Alert';
import { Card } from '@/components/Card';
import type { Papel } from '@/features/auth/tipos';
import { mensagemDeErro } from '@/lib/mensagens';
import { useProdutos } from './hooks';
import { ProdutoItem } from './ProdutoItem';

/** Parte do M3 na tela 05 (RF11): os 5 produtos mais recentes e o atalho de cadastro (oculto para o LEITOR). */
export function ProdutosRecentes({ papel }: { papel: Papel }) {
  const { data, isPending, isError, error, refetch } = useProdutos({ limite: 5 });
  const podeEditar = papel !== 'LEITOR';
  return (
    <section aria-labelledby="titulo-recentes" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="titulo-recentes" className="text-xl font-bold">
          Adicionados recentemente
        </h2>
        <Link to="/produtos" className="inline-flex min-h-11 items-center text-sm font-semibold text-primary underline">
          Ver todos
        </Link>
      </div>
      {podeEditar && (
        <Link
          to="/produtos/novo"
          className="flex min-h-12 w-full items-center justify-center rounded-campo bg-primary px-4 font-semibold text-white hover:bg-primary-escuro"
        >
          + Adicionar produto
        </Link>
      )}
      {isPending && <p className="text-sm text-suave">Carregando produtos...</p>}
      {isError && (
        <Alert tipo="erro">
          {mensagemDeErro(error)}{' '}
          <button type="button" className="font-semibold underline" onClick={() => refetch()}>
            Tentar novamente
          </button>
        </Alert>
      )}
      {data && data.itens.length === 0 && (
        <Alert>{podeEditar ? 'Sua Casa ainda não tem produtos. Cadastre o primeiro.' : 'A Casa ainda não tem produtos cadastrados.'}</Alert>
      )}
      {data && data.itens.length > 0 && (
        <Card>
          <ul className="divide-y divide-borda">
            {data.itens.map((p) => (
              <ProdutoItem key={p.id} produto={p} />
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
