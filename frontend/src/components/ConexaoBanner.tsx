import { useSemConexao } from '@/lib/conexao';

/** RNF24: avisa quando não há conexão com a internet. */
export function ConexaoBanner() {
  const sem = useSemConexao();
  if (!sem) return null;
  return (
    <div role="alert" className="sticky top-0 z-[60] bg-erro px-4 py-2 text-center text-sm font-medium text-white">
      Sem conexão com a internet
    </div>
  );
}
