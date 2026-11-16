import type { ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { useUsuarioAtual } from '@/features/auth/hooks';
import { BarraArmazenamento } from '@/features/estatisticas/BarraArmazenamento';
import { useResumo } from '@/features/estatisticas/hooks';
import { primeiraLetra } from '@/lib/format';
import { cn } from './cn';
import { Logo } from './Logo';

interface Item {
  rotulo: string;
  para?: string; // sem rota = módulo ainda não disponível
  icone: string;
}

const ITENS: Item[] = [
  { rotulo: 'Início', para: '/inicio', icone: '⌂' },
  { rotulo: 'Produtos', para: '/produtos', icone: '▢' },
  { rotulo: 'Família', para: '/familia', icone: '☺' },
  { rotulo: 'Conta', para: '/conta', icone: '●' },
];

function ItemNav({ item, lateral }: { item: Item; lateral: boolean }) {
  const base = lateral
    ? 'flex items-center gap-3 rounded-campo px-3 py-2.5 font-medium'
    : 'flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium';
  const conteudo = (
    <>
      <span aria-hidden="true" className={lateral ? 'w-5 text-center' : 'text-lg leading-none'}>
        {item.icone}
      </span>
      {item.rotulo}
    </>
  );
  if (!item.para) {
    return (
      <span aria-disabled="true" title="Em breve" className={cn(base, 'cursor-not-allowed text-suave/50')}>
        {conteudo}
      </span>
    );
  }
  return (
    <NavLink
      to={item.para}
      className={({ isActive }) =>
        cn(base, isActive ? (lateral ? 'bg-primary-claro text-primary' : 'text-primary') : 'text-suave hover:text-texto')
      }
    >
      {conteudo}
    </NavLink>
  );
}

/** Uso do armazenamento abaixo do menu lateral (tela 17). Só no Início, onde o resumo já é consultado. */
function UsoNoMenu() {
  const { data } = useResumo();
  if (!data) return null;
  return (
    <div className="mt-auto px-3 pb-3">
      <BarraArmazenamento compacta usadoBytes={data.armazenamento.usadoBytes} limiteBytes={data.armazenamento.limiteBytes} />
    </div>
  );
}

/** Layout das telas logadas: menu lateral no desktop, tab bar no celular (RNF10). */
export function AppLayout({ children }: { children: ReactNode }) {
  const { data: usuario } = useUsuarioAtual();
  const metade = ITENS.length / 2;
  // Início (05 e 17) usa a largura toda no desktop para os indicadores e a tabela; as outras telas ficam estreitas
  const noInicio = useLocation().pathname === '/inicio';

  return (
    <div className="min-h-screen md:flex">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-borda bg-white p-4 md:flex">
        <div className="mb-6 px-3 pt-2">
          <Logo />
        </div>
        <nav aria-label="Principal" className="flex flex-col gap-1">
          {ITENS.map((i) => (
            <ItemNav key={i.rotulo} item={i} lateral />
          ))}
        </nav>
        {noInicio && <UsoNoMenu />}
        {usuario && (
          <div className={cn('flex items-center gap-3 px-3 py-2', !noInicio && 'mt-auto')}>
            <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-full bg-primary font-semibold text-white">
              {primeiraLetra(usuario.nome)}
            </span>
            <span className="min-w-0 text-sm">
              <span className="block truncate font-medium">{usuario.nome}</span>
              <span className="block truncate text-suave">{usuario.casa.nome}</span>
            </span>
          </div>
        )}
      </aside>

      <main className={cn('mx-auto w-full max-w-3xl flex-1 px-4 pb-28 pt-6 md:px-8 md:pb-10', noInicio && 'lg:max-w-6xl')}>{children}</main>

      <nav
        aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-40 flex items-end border-t border-borda bg-white px-2 pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {ITENS.slice(0, metade).map((i) => (
          <ItemNav key={i.rotulo} item={i} lateral={false} />
        ))}
        {usuario && usuario.papel !== 'LEITOR' && (
          <Link
            to="/produtos/novo"
            aria-label="Adicionar produto"
            className="-mt-5 mb-2 flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-3xl text-white hover:bg-primary-escuro"
          >
            <span aria-hidden="true">+</span>
          </Link>
        )}
        {ITENS.slice(metade).map((i) => (
          <ItemNav key={i.rotulo} item={i} lateral={false} />
        ))}
      </nav>
    </div>
  );
}
