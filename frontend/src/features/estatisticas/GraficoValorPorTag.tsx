import { cn } from '@/components/cn';
import { formatDinheiro, percentualDe } from '@/lib/format';
import type { Estatisticas } from './tipos';
import { produtosTexto, unidadesTexto } from './util';

interface Linha {
  chave: string;
  nome: string;
  valor: string;
  unidades: number;
  produtos: number;
  semTag?: boolean;
}

/**
 * Valor por tag em barras de CSS (RF23). Cada barra é uma imagem com texto alternativo e a linha traz o valor e o
 * percentual por escrito: cor e tamanho nunca são o único sinal (RNF19). Percentual calculado aqui, em inteiros (contrato, seção 1).
 */
export function GraficoValorPorTag({ dados }: { dados: Pick<Estatisticas, 'valorPorTag' | 'semTag' | 'valorTotal'> }) {
  const linhas: Linha[] = dados.valorPorTag.map((t) => ({ chave: `t${t.id}`, nome: t.nome, valor: t.valor, unidades: t.unidades, produtos: t.produtos }));
  if (dados.semTag) linhas.push({ chave: 'sem', nome: 'Sem tag', valor: dados.semTag.valor, unidades: dados.semTag.unidades, produtos: dados.semTag.produtos, semTag: true });

  return (
    <ul className="flex flex-col gap-4">
      {linhas.map((l) => {
        const pct = percentualDe(l.valor, dados.valorTotal);
        const rotuloPct = pct ? pct.texto : '—';
        const alt = `${l.nome}: ${formatDinheiro(l.valor)}, ${pct ? `${pct.texto} do valor total` : 'participação indisponível'}, ${produtosTexto(l.produtos)}`;
        return (
          <li key={l.chave}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate font-semibold" title={l.nome}>
                {l.nome}
              </span>
              <span className="shrink-0 text-sm">
                {formatDinheiro(l.valor)} · {rotuloPct}
              </span>
            </div>
            <div role="img" aria-label={alt} className="mt-1 h-3 w-full overflow-hidden rounded-full bg-borda">
              <div className={cn('h-full', l.semTag ? 'bg-suave' : 'bg-primary')} style={{ width: `${pct?.largura ?? 0}%` }} />
            </div>
            <p className="mt-0.5 text-xs text-suave">
              {unidadesTexto(l.unidades)} em {produtosTexto(l.produtos)}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
