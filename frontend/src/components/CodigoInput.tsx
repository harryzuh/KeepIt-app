import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { cn } from './cn';

interface Props {
  valor: string;
  aoMudar: (v: string) => void;
  erro?: boolean;
  tamanho?: number;
}

/** Código de verificação em caixas separadas (tela 04). Aceita colar e navegar com as setas. */
export function CodigoInput({ valor, aoMudar, erro, tamanho = 6 }: Props) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const foco = (i: number) => refs.current[Math.max(0, Math.min(tamanho - 1, i))]?.focus();

  const digitar = (i: number, texto: string) => {
    const digitos = texto.replace(/\D/g, '');
    if (!digitos) return;
    const base = valor.padEnd(tamanho, ' ').split('');
    digitos.split('').forEach((d, k) => {
      if (i + k < tamanho) base[i + k] = d;
    });
    aoMudar(base.join('').replace(/ /g, '').slice(0, tamanho));
    foco(i + digitos.length);
  };

  const teclar = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const base = valor.padEnd(tamanho, ' ').split('');
      if (base[i] !== ' ') base[i] = ' ';
      else if (i > 0) base[i - 1] = ' ';
      aoMudar(base.join('').trimEnd());
      foco(base[i] === ' ' && valor[i] === undefined ? i - 1 : i);
    } else if (e.key === 'ArrowLeft') foco(i - 1);
    else if (e.key === 'ArrowRight') foco(i + 1);
  };

  const colar = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    digitar(0, e.clipboardData.getData('text'));
  };

  return (
    <div role="group" aria-label="Código de 6 dígitos" className="flex gap-2">
      {Array.from({ length: tamanho }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={valor[i] ?? ''}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={tamanho}
          aria-label={`Dígito ${i + 1}`}
          aria-invalid={erro || undefined}
          onChange={(e) => digitar(i, e.target.value)}
          onKeyDown={(e) => teclar(i, e)}
          onPaste={colar}
          onFocus={(e) => e.target.select()}
          className={cn(
            'size-12 min-w-0 flex-1 rounded-campo border bg-white text-center text-2xl font-semibold outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 sm:size-14',
            erro ? 'border-erro' : 'border-borda',
          )}
        />
      ))}
    </div>
  );
}
