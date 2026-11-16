import { formatBytes } from '@/lib/format';
import { useUsoArmazenamento } from './hooks';

/** Uso de armazenamento do plano (RF39), na tela 08. Sem o valor usado, mostra só o limite. */
export function UsoArmazenamento() {
  const uso = useUsoArmazenamento();
  if (!uso) return null;
  if (uso.usadoBytes === null) return <p className="text-xs text-suave">Armazenamento do plano: até {formatBytes(uso.limiteBytes)}.</p>;
  const pct = uso.limiteBytes > 0 ? Math.min(100, Math.round((uso.usadoBytes / uso.limiteBytes) * 100)) : 100;
  return (
    <div className="text-xs text-suave">
      <p>
        Armazenamento: {formatBytes(uso.usadoBytes)} de {formatBytes(uso.limiteBytes)} usados
      </p>
      <div
        role="progressbar"
        aria-label="Armazenamento usado"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-borda"
      >
        <div className={pct >= 90 ? 'h-full bg-erro' : 'h-full bg-primary'} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
