import type { ReactNode } from 'react';
import { cn } from './cn';

interface Props {
  tipo?: 'erro' | 'sucesso' | 'info';
  children: ReactNode;
  className?: string;
}

const ESTILOS = {
  erro: 'bg-erro-claro text-erro',
  sucesso: 'bg-primary-claro text-primary',
  info: 'bg-primary-claro text-texto',
};

/** Mensagem de feedback. Erros são anunciados na hora (role="alert"), o resto educadamente. */
export function Alert({ tipo = 'info', children, className }: Props) {
  return (
    <div
      role={tipo === 'erro' ? 'alert' : 'status'}
      className={cn('rounded-campo px-4 py-3 text-sm', ESTILOS[tipo], className)}
    >
      {children}
    </div>
  );
}
