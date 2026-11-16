import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Carregando } from '@/components/Carregando';
import { cn } from '@/components/cn';
import { useUsuarioAtual } from '@/features/auth/hooks';
import { useProdutos, useTags } from '@/features/produtos/hooks';
import { ProdutoItem } from '@/features/produtos/ProdutoItem';
import type { OrdemProdutos } from '@/features/produtos/tipos';
import { mensagemDeErro } from '@/lib/mensagens';

const inteiro = (v: string | null) => (v && /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : undefined);

/** Tela 06 — Produtos (UC016, RF10, RF34): busca por nome, filtro por tag, ordenação e paginação. Filtros ficam na URL. */
export default function Produtos() {
  const { data: u } = useUsuarioAtual();
  const [params, setParams] = useSearchParams();
  const busca = params.get('busca') ?? '';
  const tagId = inteiro(params.get('tag'));
  const pagina = inteiro(params.get('pagina')) ?? 1;
  const ordem: OrdemProdutos = params.get('ordem') === 'nome' ? 'nome' : 'recentes';
  const aviso = (useLocation().state as { aviso?: string } | null)?.aviso;

  const [texto, setTexto] = useState(busca);
  const mudar = (novo: Record<string, string | undefined>) =>
    setParams(
      (atual) => {
        const p = new URLSearchParams(atual);
        for (const [k, v] of Object.entries(novo)) {
          if (v) p.set(k, v);
          else p.delete(k);
        }
        return p;
      },
      { replace: true },
    );

  // Busca com atraso para não consultar a cada tecla; volta à página 1
  useEffect(() => {
    if (texto.trim() === busca) return;
    const t = setTimeout(() => mudar({ busca: texto.trim() || undefined, pagina: undefined }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto, busca]);

  const tags = useTags();
  const lista = useProdutos({ busca: busca || undefined, tagId, pagina, ordem });
  if (!u) return null;
  const podeEditar = u.papel !== 'LEITOR';
  const filtrando = !!busca || tagId !== undefined;
  const limpar = () => {
    setTexto('');
    mudar({ busca: undefined, tag: undefined, pagina: undefined });
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Produtos</h1>
        {podeEditar && (
          <Link
            to="/produtos/novo"
            className="flex min-h-12 items-center justify-center rounded-campo bg-primary px-4 font-semibold text-white hover:bg-primary-escuro"
          >
            + Adicionar
          </Link>
        )}
      </header>

      {aviso && <Alert tipo="sucesso">{aviso}</Alert>}

      <div role="search" className="flex flex-col gap-3">
        <div>
          <label htmlFor="busca-produtos" className="sr-only">
            Buscar produto por nome
          </label>
          <input
            id="busca-produtos"
            type="search"
            value={texto}
            maxLength={120}
            placeholder="Buscar por nome"
            onChange={(e) => setTexto(e.target.value)}
            className="min-h-12 w-full rounded-campo border border-borda bg-white px-3.5 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1" role="group" aria-label="Filtrar por tag">
            <button
              type="button"
              aria-pressed={tagId === undefined}
              onClick={() => mudar({ tag: undefined, pagina: undefined })}
              className={cn(
                'min-h-11 shrink-0 rounded-full border px-3.5 text-sm font-medium',
                tagId === undefined ? 'border-primary bg-primary text-white' : 'border-borda bg-white hover:bg-primary-claro',
              )}
            >
              Todas
            </button>
            {tags.data?.itens.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={tagId === t.id}
                onClick={() => mudar({ tag: tagId === t.id ? undefined : String(t.id), pagina: undefined })}
                className={cn(
                  'min-h-11 shrink-0 rounded-full border px-3.5 text-sm font-medium',
                  tagId === t.id ? 'border-primary bg-primary text-white' : 'border-borda bg-white hover:bg-primary-claro',
                )}
              >
                {t.nome}
              </button>
            ))}
          </div>
          <label className="shrink-0 text-sm">
            <span className="sr-only">Ordenar por</span>
            <select
              value={ordem}
              onChange={(e) => mudar({ ordem: e.target.value === 'nome' ? 'nome' : undefined, pagina: undefined })}
              className="min-h-11 rounded-campo border border-borda bg-white px-2"
            >
              <option value="recentes">Mais recentes</option>
              <option value="nome">Nome (A–Z)</option>
            </select>
          </label>
        </div>
        {tags.isError && <p className="text-sm text-suave">Não foi possível carregar as tags para o filtro.</p>}
      </div>

      {lista.isPending && <Carregando />}
      {lista.isError && (
        <div className="flex flex-col gap-3">
          <Alert tipo="erro">{mensagemDeErro(lista.error)}</Alert>
          <Button variante="secundario" onClick={() => lista.refetch()}>
            Tentar novamente
          </Button>
        </div>
      )}
      {lista.data && lista.data.itens.length === 0 && (
        <Card className="flex flex-col items-center gap-3 p-6 text-center">
          {filtrando ? (
            <>
              <p className="font-semibold">Nenhum produto encontrado</p>
              <p className="text-sm text-suave">Tente outro nome ou outra tag.</p>
              <Button variante="secundario" className="w-auto" onClick={limpar}>
                Limpar filtros
              </Button>
            </>
          ) : (
            <>
              <p className="font-semibold">Nenhum produto cadastrado</p>
              <p className="text-sm text-suave">
                {podeEditar ? 'Cadastre o primeiro produto da sua Casa.' : 'Quando alguém da Casa cadastrar produtos, eles aparecem aqui.'}
              </p>
              {podeEditar && (
                <Link to="/produtos/novo" className="font-semibold text-primary underline">
                  Adicionar produto
                </Link>
              )}
            </>
          )}
        </Card>
      )}
      {lista.data && lista.data.itens.length > 0 && (
        <>
          <p className="text-sm text-suave" aria-live="polite">
            {lista.data.total} {lista.data.total === 1 ? 'produto' : 'produtos'}
          </p>
          <Card aria-busy={lista.isFetching || undefined} className={cn(lista.isPlaceholderData && 'opacity-60')}>
            <ul className="divide-y divide-borda">
              {lista.data.itens.map((p) => (
                <ProdutoItem key={p.id} produto={p} />
              ))}
            </ul>
          </Card>
          {lista.data.totalPaginas > 1 && (
            <nav aria-label="Paginação" className="flex items-center justify-between gap-3">
              <Button variante="secundario" className="w-auto" disabled={pagina <= 1} onClick={() => mudar({ pagina: pagina > 2 ? String(pagina - 1) : undefined })}>
                Anterior
              </Button>
              <span className="text-sm text-suave">
                Página {lista.data.pagina} de {lista.data.totalPaginas}
              </span>
              <Button
                variante="secundario"
                className="w-auto"
                disabled={pagina >= lista.data.totalPaginas}
                onClick={() => mudar({ pagina: String(pagina + 1) })}
              >
                Próxima
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
