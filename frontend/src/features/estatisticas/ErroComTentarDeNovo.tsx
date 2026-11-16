import { Alert } from '@/components/Alert';
import { mensagemDeErro } from '@/lib/mensagens';

/** Erro de carregamento (rede ou 5xx) com "Tentar de novo" (RNF24). */
export function ErroComTentarDeNovo({ erro, aoTentar }: { erro: unknown; aoTentar: () => void }) {
  return (
    <Alert tipo="erro">
      {mensagemDeErro(erro)}{' '}
      <button type="button" className="inline-flex min-h-11 items-center font-semibold underline" onClick={aoTentar}>
        Tentar de novo
      </button>
    </Alert>
  );
}
