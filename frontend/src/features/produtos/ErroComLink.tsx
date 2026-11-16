import { Link } from 'react-router';
import { ApiError } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { mensagemDeErro } from '@/lib/mensagens';

/** Texto do erro; COTA_EXCEDIDA mostra o uso do plano e um link para os Planos (tela 13). */
export function ErroComLink({ erro }: { erro: unknown }) {
  const cota = erro instanceof ApiError && erro.codigo === 'COTA_EXCEDIDA';
  const det = cota ? (erro.extra as { usadoBytes?: number; limiteBytes?: number } | undefined) : undefined;
  return (
    <>
      {mensagemDeErro(erro)}
      {det?.usadoBytes !== undefined && det.limiteBytes !== undefined && ` Você usa ${formatBytes(det.usadoBytes)} de ${formatBytes(det.limiteBytes)}.`}
      {cota && (
        <>
          {' '}
          <Link to="/conta/planos" className="font-semibold underline">
            Ver planos
          </Link>
        </>
      )}
    </>
  );
}
