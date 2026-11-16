import { useId, useState, type InputHTMLAttributes, type Ref } from 'react';
import { cn } from './cn';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  erro?: string;
  dica?: string;
  ref?: Ref<HTMLInputElement>;
}

/** Campo com rótulo, mensagem de erro ligada por aria e botão de mostrar senha. */
export function Input({ label, erro, dica, type = 'text', className, ref, ...resto }: Props) {
  const id = useId();
  const [visivel, setVisivel] = useState(false);
  const ehSenha = type === 'password';
  const descricao = erro ? `${id}-erro` : dica ? `${id}-dica` : undefined;

  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          ref={ref}
          type={ehSenha && visivel ? 'text' : type}
          aria-invalid={erro ? true : undefined}
          aria-describedby={descricao}
          className={cn(
            'min-h-12 w-full rounded-campo border bg-white px-3.5 text-base outline-none placeholder:text-suave/60 focus:border-primary focus:ring-2 focus:ring-primary/20',
            erro ? 'border-erro' : 'border-borda',
            ehSenha && 'pr-20',
          )}
          {...resto}
        />
        {ehSenha && (
          <button
            type="button"
            onClick={() => setVisivel((v) => !v)}
            aria-pressed={visivel}
            aria-label={visivel ? 'Ocultar senha' : 'Mostrar senha'}
            aria-controls={id}
            className="absolute inset-y-0 right-0 px-3.5 text-sm font-medium text-primary"
          >
            {visivel ? 'Ocultar' : 'Mostrar'}
          </button>
        )}
      </div>
      {erro ? (
        <p id={`${id}-erro`} role="alert" className="mt-1.5 text-sm text-erro">
          {erro}
        </p>
      ) : dica ? (
        <p id={`${id}-dica`} className="mt-1.5 text-sm text-suave">
          {dica}
        </p>
      ) : null}
    </div>
  );
}
