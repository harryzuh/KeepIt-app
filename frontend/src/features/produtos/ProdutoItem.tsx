import { Link } from 'react-router';
import { formatBRL } from '@/lib/format';
import { FotoProduto } from './FotoProduto';
import type { ProdutoResumo } from './tipos';
import { formatDataCompra } from './util';

/** Linha da lista de produtos (telas 05 e 06): foto, nome, preço, quantidade e tags. O item todo leva ao detalhe (tela 07). */
export function ProdutoItem({ produto: p }: { produto: ProdutoResumo }) {
  return (
    <li>
      <Link to={`/produtos/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-primary-claro/50">
        <FotoProduto foto={p.fotoCapa} nome={p.nome} className="size-16 rounded-campo" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{p.nome}</span>
          <span className="block text-sm text-suave">
            {formatBRL(Number(p.preco))} · {p.quantidade} {p.quantidade === 1 ? 'unidade' : 'unidades'}
          </span>
          <span className="block text-xs text-suave">Comprado em {formatDataCompra(p.dataCompra)}</span>
          {p.tags.length > 0 && (
            <span className="mt-1 flex flex-wrap gap-1.5">
              {p.tags.map((t) => (
                <span key={t.id} className="rounded-md bg-apoio/20 px-2 py-0.5 text-xs font-medium">
                  {t.nome}
                </span>
              ))}
            </span>
          )}
        </span>
        <span aria-hidden="true" className="text-suave">
          ›
        </span>
      </Link>
    </li>
  );
}
