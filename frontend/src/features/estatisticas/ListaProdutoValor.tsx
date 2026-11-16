import { Link } from 'react-router';
import { Card } from '@/components/Card';
import { formatDataCompra } from '@/features/produtos/util';
import { formatDinheiro } from '@/lib/format';
import type { ProdutoValor } from './tipos';

/** "R$ 50,00 × 3": composição do valor do produto (preço unitário × quantidade). */
export const composicao = (p: ProdutoValor) => `${formatDinheiro(p.preco)} × ${p.quantidade.toLocaleString('pt-BR')}`;

/** Produtos mais antigos (tela 10): cada item leva ao detalhe (tela 07). Nome longo é truncado com `title`. */
export function ListaProdutoValor({ itens }: { itens: ProdutoValor[] }) {
  return (
    <Card>
      <ul className="divide-y divide-borda">
        {itens.map((p) => (
          <li key={p.id}>
            <Link to={`/produtos/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-primary-claro/50">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold" title={p.nome}>
                  {p.nome}
                </span>
                <span className="block text-xs text-suave">Comprado em {formatDataCompra(p.dataCompra)}</span>
              </span>
              <span className="shrink-0 text-right text-sm">
                <span className="block font-semibold">{formatDinheiro(p.valor)}</span>
                <span className="block text-xs text-suave">{composicao(p)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
