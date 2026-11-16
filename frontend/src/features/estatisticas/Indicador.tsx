import type { ReactNode } from 'react';
import { Card } from '@/components/Card';
import { cn } from '@/components/cn';

interface Props {
  rotulo: string;
  /** Texto do valor, também usado no rótulo acessível do cartão. */
  valor: string;
  detalhe?: ReactNode;
  destaque?: boolean;
  /** false quando o cartão está dentro de um link: o nome do link já é o texto visível (WCAG 2.5.3) e não pode haver grupo aninhado. */
  agrupar?: boolean;
  className?: string;
}

/** Cartão de indicador. O leitor de tela anuncia rótulo e valor juntos (RNF19); valor longo quebra linha em vez de rolar. */
export function Indicador({ rotulo, valor, detalhe, destaque, agrupar = true, className }: Props) {
  return (
    <Card {...(agrupar ? { role: 'group', 'aria-label': `${rotulo}: ${valor}` } : {})} className={cn('min-w-0 p-4', destaque && 'bg-primary text-white', className)}>
      <p className={cn('text-sm', destaque ? 'text-white/80' : 'text-suave')}>{rotulo}</p>
      <p className={cn('break-words font-bold leading-tight', destaque ? 'text-3xl' : 'text-xl')} title={valor}>
        {valor}
      </p>
      {detalhe && <div className={cn('mt-1 text-xs', destaque ? 'text-white/80' : 'text-suave')}>{detalhe}</div>}
    </Card>
  );
}

/** Esqueleto de carregamento com a mesma altura do cartão (sem saltos de layout). */
export function IndicadorEsqueleto({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('h-24 animate-pulse rounded-card bg-borda/70', className)} />;
}
