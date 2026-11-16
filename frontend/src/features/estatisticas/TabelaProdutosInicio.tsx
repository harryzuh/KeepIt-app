import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Carregando } from '@/components/Carregando';
import { cn } from '@/components/cn';
import type { Papel } from '@/features/auth/tipos';
import { useProdutos, useTags } from '@/features/produtos/hooks';
import { formatDataCompra } from '@/features/produtos/util';
import { formatBRL } from '@/lib/format';
import { ErroComTentarDeNovo } from './ErroComTentarDeNovo';

/** Tela 17: busca, botão de adicionar e tabela de produtos (reaproveita a lista do M3, com busca por nome, filtro por tag e paginação). */
export function TabelaProdutosInicio({ papel }: { papel: Papel }) {
  const podeEditar = papel !== 'LEITOR';
  const [texto, setTexto] = useState('');
  const [busca, setBusca] = useState('');
  const [tagId, setTagId] = useState<number | undefined>();
  const [pagina, setPagina] = useState(1);
  const tags = useTags();
  const lista = useProdutos({ busca: busca || undefined, tagId, pagina, limite: 10 });

  useEffect(() => {
    const t = setTimeout(() => {
      setBusca(texto.trim());
      setPagina(1);
    }, 300);
    return () => clearTimeout(t);
  }, [texto]);

  const filtrando = !!busca || tagId !== undefined;
  return (
    <section aria-labelledby="titulo-tabela" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="titulo-tabela" className="mr-auto text-xl font-bold">
          Produtos
        </h2>
        <div role="search" className="flex items-center gap-2">
          <label htmlFor="busca-inicio" className="sr-only">
            Buscar produto por nome
          </label>
          <input
            id="busca-inicio"
            type="search"
            value={texto}
            maxLength={120}
            placeholder="Buscar por nome"
            onChange={(e) => setTexto(e.target.value)}
            className="min-h-11 w-64 rounded-campo border border-borda bg-white px-3.5 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <label className="text-sm">
            <span className="sr-only">Filtrar por tag</span>
            <select
              value={tagId ?? ''}
              onChange={(e) => {
                setTagId(e.target.value ? Number(e.target.value) : undefined);
                setPagina(1);
              }}
              className="min-h-11 rounded-campo border border-borda bg-white px-2"
            >
              <option value="">Todas as tags</option>
              {tags.data?.itens.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            </select>
          </label>
        </div>
        {podeEditar && (
          <Link to="/produtos/novo" className="flex min-h-11 items-center rounded-campo bg-primary px-4 font-semibold text-white hover:bg-primary-escuro">
            + Adicionar produto
          </Link>
        )}
      </div>

      {lista.isPending && <Carregando />}
      {lista.isError && <ErroComTentarDeNovo erro={lista.error} aoTentar={() => lista.refetch()} />}
      {lista.data && lista.data.itens.length === 0 && (
        <Alert>
          {filtrando
            ? 'Nenhum produto encontrado. Tente outro nome ou outra tag.'
            : podeEditar
              ? 'Sua Casa ainda não tem produtos. Cadastre o primeiro.'
              : 'A Casa ainda não tem produtos cadastrados.'}
        </Alert>
      )}
      {lista.data && lista.data.itens.length > 0 && (
        <>
          <Card className={cn('overflow-x-auto', lista.isPlaceholderData && 'opacity-60')} aria-busy={lista.isFetching || undefined}>
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Produtos da Casa</caption>
              <thead className="border-b border-borda text-suave">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Produto</th>
                  <th scope="col" className="px-4 py-3 font-medium">Tags</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Preço</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Qtd.</th>
                  <th scope="col" className="px-4 py-3 font-medium">Compra</th>
                  <th scope="col" className="px-4 py-3 font-medium">Adicionado por</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borda">
                {lista.data.itens.map((p) => (
                  <tr key={p.id} className="hover:bg-primary-claro/50">
                    <th scope="row" className="max-w-64 px-4 py-3 font-semibold">
                      <Link to={`/produtos/${p.id}`} className="block truncate text-primary underline" title={p.nome}>
                        {p.nome}
                      </Link>
                    </th>
                    <td className="px-4 py-3">{p.tags.length ? p.tags.map((t) => t.nome).join(', ') : '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">{formatBRL(Number(p.preco))}</td>
                    <td className="px-4 py-3 text-right">{p.quantidade}</td>
                    <td className="whitespace-nowrap px-4 py-3">{formatDataCompra(p.dataCompra)}</td>
                    <td className="px-4 py-3">{p.adicionadoPor?.nome ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {lista.data.totalPaginas > 1 && (
            <nav aria-label="Paginação da tabela" className="flex items-center justify-between gap-3">
              <Button variante="secundario" className="w-auto" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>
                Anterior
              </Button>
              <span className="text-sm text-suave">
                Página {lista.data.pagina} de {lista.data.totalPaginas}
              </span>
              <Button variante="secundario" className="w-auto" disabled={pagina >= lista.data.totalPaginas} onClick={() => setPagina(pagina + 1)}>
                Próxima
              </Button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
