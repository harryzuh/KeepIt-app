import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';

interface Props {
  titulo?: string;
  voltarPara?: string;
  aoVoltar?: () => void;
  /** Dentro do AppLayout (menos altura mínima). */
  logada?: boolean;
  children: ReactNode;
}

/** Moldura das telas de formulário: botão voltar, título e coluna única centralizada. */
export function PaginaForm({ titulo, voltarPara, aoVoltar, logada, children }: Props) {
  const navigate = useNavigate();
  return (
    <div className={`mx-auto flex w-full max-w-md flex-col px-4 pb-6 pt-4 ${logada ? 'min-h-[75vh]' : 'min-h-screen'}`}>
      <header className="relative mb-4 flex min-h-11 items-center justify-center">
        <button
          type="button"
          aria-label="Voltar"
          onClick={() => (aoVoltar ? aoVoltar() : voltarPara ? navigate(voltarPara) : navigate(-1))}
          className="absolute left-0 flex size-11 items-center justify-center rounded-full text-2xl hover:bg-primary-claro"
        >
          <span aria-hidden="true">‹</span>
        </button>
        {titulo && <h1 className="text-lg font-semibold">{titulo}</h1>}
      </header>
      {children}
    </div>
  );
}
