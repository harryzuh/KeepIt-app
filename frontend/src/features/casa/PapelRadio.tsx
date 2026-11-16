import { useId } from 'react';
import { cn } from '@/components/cn';
import type { PapelAtribuivel } from './tipos';

const OPCOES: { valor: PapelAtribuivel; titulo: string; descricao: string }[] = [
  { valor: 'EDITOR', titulo: 'Editor', descricao: 'Adiciona, edita e exclui produtos e tags.' },
  { valor: 'LEITOR', titulo: 'Leitor', descricao: 'Só visualiza os produtos e as estatísticas.' },
];

interface Props {
  valor: PapelAtribuivel;
  aoMudar: (p: PapelAtribuivel) => void;
}

/** Escolha de papel (telas 12 e 22): grupo de rádios acessível por teclado. */
export function PapelRadio({ valor, aoMudar }: Props) {
  const nome = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-medium">Papel</legend>
      {OPCOES.map((o) => (
        <label
          key={o.valor}
          className={cn(
            'flex min-h-12 cursor-pointer items-start gap-3 rounded-campo border bg-white p-3 focus-within:ring-2 focus-within:ring-primary/20',
            valor === o.valor ? 'border-primary bg-primary-claro/40' : 'border-borda',
          )}
        >
          <input
            type="radio"
            name={nome}
            value={o.valor}
            checked={valor === o.valor}
            onChange={() => aoMudar(o.valor)}
            className="mt-1 size-4 accent-primary"
          />
          <span>
            <span className="block font-semibold">{o.titulo}</span>
            <span className="block text-sm text-suave">{o.descricao}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
