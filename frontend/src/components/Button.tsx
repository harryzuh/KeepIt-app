import type { ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: 'primario' | 'secundario' | 'perigo' | 'contorno-perigo' | 'texto' | 'cinza';
  carregando?: boolean;
}

const VARIANTES = {
  primario: 'bg-primary text-white hover:bg-primary-escuro disabled:bg-primary/40',
  secundario: 'border border-borda bg-white text-texto hover:bg-primary-claro',
  perigo: 'bg-erro text-white hover:bg-erro/90 disabled:bg-erro/40',
  'contorno-perigo': 'border border-erro/40 bg-white text-erro hover:bg-erro-claro',
  texto: 'text-suave hover:text-texto',
  /** Ação indisponível (ex.: planos desativados): cinza, sem hover. */
  cinza: 'bg-gray-200 text-gray-600',
};

export function Button({ variante = 'primario', carregando, disabled, className, children, ...resto }: Props) {
  return (
    <button
      type="button"
      {...resto}
      disabled={disabled || carregando}
      aria-busy={carregando || undefined}
      className={cn(
        'inline-flex min-h-12 w-full items-center justify-center rounded-campo px-4 font-semibold transition-colors disabled:cursor-not-allowed',
        VARIANTES[variante],
        className,
      )}
    >
      {carregando ? 'Aguarde...' : children}
    </button>
  );
}
