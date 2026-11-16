import { formatData } from '@/lib/format';
import type { Resumo } from './tipos';
import { nomeDoPlano } from './util';

/** Linha do plano: "Renova em dd/mm/aaaa", "Benefícios até dd/mm/aaaa" ou só o plano Individual (RF24). */
export function RenovacaoTexto({ plano, renovacao }: Pick<Resumo, 'plano' | 'renovacao'>) {
  if (!renovacao) return <span>Plano {nomeDoPlano(plano.nome)}</span>;
  const data = formatData(renovacao.data);
  return (
    <span>
      Plano {nomeDoPlano(plano.nome)} · {renovacao.status === 'ATIVA' ? `Renova em ${data}` : `Benefícios até ${data}`}
    </span>
  );
}
