import type { Papel } from '@/features/auth/tipos';
import { cn } from './cn';

const ESTILO: Record<Papel, string> = {
  ADMIN: 'bg-primary-claro text-primary',
  EDITOR: 'bg-editor-claro text-editor',
  LEITOR: 'bg-borda text-suave',
};

/** Selo de papel (ADMIN verde, EDITOR azul, LEITOR cinza). */
export function PapelSelo({ papel }: { papel: Papel }) {
  return <span className={cn('rounded-md px-2 py-0.5 text-xs font-bold', ESTILO[papel])}>{papel}</span>;
}
