import { cn } from './cn';

/** Linha de validação em tempo real ("Mínimo de 8 caracteres", "As senhas conferem"). */
export function Requisito({ ok, children }: { ok: boolean; children: string }) {
  return (
    <p className={cn('mt-1.5 flex items-center gap-1.5 text-sm', ok ? 'text-primary' : 'text-suave')}>
      <span aria-hidden="true">{ok ? '✓' : '○'}</span>
      <span>{children}</span>
      <span className="sr-only">{ok ? '(atendido)' : '(pendente)'}</span>
    </p>
  );
}
