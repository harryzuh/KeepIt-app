import { Card } from '@/components/Card';
import { cn } from '@/components/cn';
import type { ReactNode } from 'react';
import type { PlanoDetalhe } from './tipos';
import { BENEFICIOS, nomeDoPlano, precoDoPlano } from './util';

interface Props {
  plano: PlanoDetalhe;
  atual: boolean;
  destaque?: boolean;
  /** Botão ou aviso do rodapé do cartão. */
  acao?: ReactNode;
}

function Item({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden="true" className="text-primary">✓</span>
      {children}
    </li>
  );
}

/** Cartão de plano da tela 13 (preço, benefícios e ação). */
export function PlanoCard({ plano, atual, destaque, acao }: Props) {
  const nome = nomeDoPlano(plano.nome);
  const gratis = Number(plano.preco) === 0;
  return (
    <Card className={cn('p-4', destaque && 'border-2 border-primary')} aria-label={`Plano ${nome}`}>
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-lg font-bold">{nome}</h2>
        {atual ? (
          <span className="rounded-md bg-borda px-2 py-0.5 text-xs font-semibold text-suave">Plano atual</span>
        ) : destaque ? (
          <span className="rounded-md bg-primary px-2 py-0.5 text-xs font-semibold text-white">Mais escolhido</span>
        ) : null}
      </div>
      <p className="text-3xl font-bold">
        {gratis ? 'Grátis' : precoDoPlano(plano)}
        {!gratis && <span className="text-sm font-normal text-suave"> /mês</span>}
      </p>
      <ul className="my-3 flex flex-col gap-1 text-sm">
        <Item>{plano.limiteMembros === 1 ? '1 membro' : `Até ${plano.limiteMembros} membros`}</Item>
        <Item>{plano.limiteArmazenamentoGb} GB de fotos</Item>
        <Item>{BENEFICIOS[plano.nome]}</Item>
      </ul>
      {acao}
    </Card>
  );
}
