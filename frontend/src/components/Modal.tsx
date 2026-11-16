import { useEffect, useId, useRef, type ReactNode } from 'react';

const SELETOR_FOCAVEL = 'input,button,select,textarea,a[href],[tabindex]:not([tabindex="-1"])';

interface Props {
  aberto: boolean;
  titulo: string;
  aoFechar: () => void;
  children: ReactNode;
}

/** Modal de confirmação: sobe da parte de baixo no celular, centralizado no desktop. */
export function Modal({ aberto, titulo, aoFechar, children }: Props) {
  const idTitulo = useId();
  const painel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const anterior = document.activeElement as HTMLElement | null;
    const focaveis = () =>
      Array.from(painel.current?.querySelectorAll<HTMLElement>(SELETOR_FOCAVEL) ?? []).filter((el) => !el.hasAttribute('disabled'));
    focaveis()[0]?.focus();
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return aoFechar();
      if (e.key !== 'Tab') return;
      // Retém o foco dentro do diálogo (aria-modal)
      const lista = focaveis();
      if (lista.length === 0) return e.preventDefault();
      const primeiro = lista[0];
      const ultimo = lista[lista.length - 1];
      const ativo = document.activeElement;
      if (!painel.current?.contains(ativo)) {
        e.preventDefault();
        primeiro.focus();
      } else if (e.shiftKey && ativo === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && ativo === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    };
    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      anterior?.focus();
    };
  }, [aberto, aoFechar]);

  if (!aberto) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-texto/50 md:items-center">
      <div className="absolute inset-0" onClick={aoFechar} aria-hidden="true" />
      <div
        ref={painel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-6 md:rounded-3xl"
      >
        <h2 id={idTitulo} className="mb-2 text-xl font-bold">
          {titulo}
        </h2>
        {children}
      </div>
    </div>
  );
}
