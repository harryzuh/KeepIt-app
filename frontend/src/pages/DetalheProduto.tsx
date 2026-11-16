import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Carregando } from '@/components/Carregando';
import { useUsuarioAtual } from '@/features/auth/hooks';
import { ExcluirProdutoModal } from '@/features/produtos/ExcluirProdutoModal';
import { FotoProduto } from '@/features/produtos/FotoProduto';
import { HistoricoProduto } from '@/features/produtos/HistoricoProduto';
import { useProduto } from '@/features/produtos/hooks';
import { formatDataCompra } from '@/features/produtos/util';
import { ApiError } from '@/lib/api';
import { formatBRL } from '@/lib/format';
import { mensagemDeErro } from '@/lib/mensagens';

/** Tela 07 — Detalhe do produto (UC024, RF36) com histórico (RF11). Editar e excluir (tela 23) só para ADMIN e EDITOR. */
export default function DetalheProduto() {
  const id = Number(useParams().id);
  const { data: u } = useUsuarioAtual();
  const { data: p, isPending, isError, error, refetch } = useProduto(id);
  const aviso = (useLocation().state as { aviso?: string } | null)?.aviso;
  const navigate = useNavigate();
  const [excluindo, setExcluindo] = useState(false);
  const refeito = useRef(false);
  // Foto que não carrega: a URL assinada de leitura (1 h) pode ter vencido; refaz a consulta uma vez
  useEffect(() => {
    refeito.current = false;
  }, [id]);
  const aoFalharFoto = () => {
    if (refeito.current) return;
    refeito.current = true;
    void refetch();
  };
  if (!u) return null;
  const podeEditar = u.papel !== 'LEITOR';

  if (!Number.isInteger(id) || id <= 0 || (isError && error instanceof ApiError && error.status === 404)) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold">Produto não encontrado</h1>
        <p className="text-suave">Ele pode ter sido excluído.</p>
        <Link to="/produtos" className="font-semibold text-primary underline">
          Voltar para Produtos
        </Link>
      </div>
    );
  }
  if (isPending) return <Carregando />;
  if (isError) {
    return (
      <div className="flex flex-col gap-3">
        <Alert tipo="erro">{mensagemDeErro(error)}</Alert>
        <Button variante="secundario" onClick={() => refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Link to="/produtos" className="inline-flex min-h-11 w-fit items-center text-sm font-semibold text-primary underline">
        ← Produtos
      </Link>
      {aviso && <Alert tipo="sucesso">{aviso}</Alert>}
      <h1 className="text-3xl font-bold">{p.nome}</h1>

      {p.fotos.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2" aria-label="Fotos do produto">
          {p.fotos.map((f, i) => (
            <li key={f.id} className={i === 0 ? 'col-span-3' : ''}>
              <FotoProduto
                key={f.url}
                foto={f}
                nome={`${p.nome} (foto ${i + 1} de ${p.fotos.length})`}
                aoFalhar={aoFalharFoto}
                className={i === 0 ? 'h-56 w-full rounded-card' : 'aspect-square w-full rounded-campo'}
              />
            </li>
          ))}
        </ul>
      ) : (
        <FotoProduto foto={null} nome={p.nome} className="h-40 w-full rounded-card" />
      )}

      <Card className="p-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div>
            <dt className="text-suave">Preço</dt>
            <dd className="text-lg font-bold">{formatBRL(Number(p.preco))}</dd>
          </div>
          <div>
            <dt className="text-suave">Quantidade</dt>
            <dd className="text-lg font-bold">{p.quantidade}</dd>
          </div>
          <div>
            <dt className="text-suave">Data da compra</dt>
            <dd className="font-medium">{formatDataCompra(p.dataCompra)}</dd>
          </div>
          <div>
            <dt className="text-suave">Adicionado por</dt>
            <dd className="font-medium">{p.adicionadoPor ? p.adicionadoPor.nome : 'ex-membro'}</dd>
          </div>
        </dl>
        {p.descricao && <p className="mt-4 whitespace-pre-line text-sm">{p.descricao}</p>}
        {p.tags.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Tags">
            {p.tags.map((t) => (
              <li key={t.id} className="rounded-md bg-apoio/20 px-2 py-0.5 text-xs font-medium">
                {t.nome}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {podeEditar && (
        <div className="flex flex-col gap-2">
          <Link
            to={`/produtos/${p.id}/editar`}
            className="flex min-h-12 w-full items-center justify-center rounded-campo bg-primary px-4 font-semibold text-white hover:bg-primary-escuro"
          >
            Editar produto
          </Link>
          <Button variante="contorno-perigo" onClick={() => setExcluindo(true)}>
            Excluir produto
          </Button>
          <ExcluirProdutoModal
            produto={p}
            aberto={excluindo}
            aoFechar={() => setExcluindo(false)}
            aoExcluir={() => navigate('/produtos', { replace: true, state: { aviso: 'Produto excluído.' } })}
          />
        </div>
      )}

      <HistoricoProduto produtoId={p.id} />
    </div>
  );
}
