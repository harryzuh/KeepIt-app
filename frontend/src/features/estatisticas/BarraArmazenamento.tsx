import { cn } from '@/components/cn';
import { formatBytes } from '@/lib/format';
import { percentualArmazenamento } from './util';

/** Uso do armazenamento do plano com barra (RF39). Acima de 90% muda de cor e escreve o aviso: cor nunca é o único sinal (RNF19). */
export function BarraArmazenamento({ usadoBytes, limiteBytes, compacta }: { usadoBytes: number; limiteBytes: number; compacta?: boolean }) {
  const pct = percentualArmazenamento(usadoBytes, limiteBytes);
  const cheio = pct >= 90;
  const texto = `${formatBytes(usadoBytes)} de ${formatBytes(limiteBytes)} usados`;
  return (
    <div className={cn('text-suave', compacta ? 'text-xs' : 'text-sm')}>
      <p>
        Armazenamento: {texto} ({pct}%)
      </p>
      <div
        role="progressbar"
        aria-label="Armazenamento usado"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={texto}
        className="mt-1 h-2 w-full overflow-hidden rounded-full bg-borda"
      >
        <div className={cn('h-full', cheio ? 'bg-erro' : 'bg-primary')} style={{ width: `${pct}%` }} />
      </div>
      {cheio && <p className="mt-1 font-semibold text-erro">Armazenamento quase cheio</p>}
    </div>
  );
}
