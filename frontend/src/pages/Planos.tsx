import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Carregando } from '@/components/Carregando';
import { PaginaForm } from '@/components/PaginaForm';
import { AssinarComoMembroModal } from '@/features/assinatura/AssinarComoMembroModal';
import { usePlanos } from '@/features/assinatura/hooks';
import { PlanoCard } from '@/features/assinatura/PlanoCard';
import type { PlanoDetalhe } from '@/features/assinatura/tipos';
import { nomeDoPlano, planoParaUrl } from '@/features/assinatura/util';
import { useUsuarioAtual } from '@/features/auth/hooks';
import { formatData } from '@/lib/format';
import { mensagemDeErro } from '@/lib/mensagens';

/**
 * Tela 13 — Planos (UC019, UC029, UC030) + modal da tela 24 (RF38).
 * Aberta a qualquer papel (UC019); o cartão Individual não tem botão Assinar.
 * ADMIN segue direto ao pagamento; EDITOR e LEITOR veem antes o aviso de saída da Casa.
 */
export default function Planos() {
  const { data: u } = useUsuarioAtual();
  const { data, isPending, isError, error, refetch } = usePlanos();
  const navigate = useNavigate();
  const [escolhido, setEscolhido] = useState<PlanoDetalhe | null>(null);
  if (!u) return null;
  const ehAdmin = u.papel === 'ADMIN';

  const irParaPagamento = (p: PlanoDetalhe, confirmaSaida: boolean) =>
    navigate(`/conta/planos/${planoParaUrl(p.nome)}/pagamento`, { state: confirmaSaida ? { confirmaSaida: true } : undefined });
  const assinar = (p: PlanoDetalhe) => (ehAdmin ? irParaPagamento(p, false) : setEscolhido(p));

  return (
    <PaginaForm titulo="Planos" voltarPara="/conta" logada>
      <p className="mb-4 text-suave">Mais membros e mais espaço para as fotos dos seus bens.</p>
      {isPending ? (
        <Carregando />
      ) : isError ? (
        <div className="flex flex-col gap-3">
          <Alert tipo="erro">{mensagemDeErro(error)}</Alert>
          <Button variante="secundario" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {data.assinatura?.status === 'CANCELADA' && (
            <Alert tipo="info">Assinatura cancelada: benefícios até {formatData(data.assinatura.dataRenovacao)}.</Alert>
          )}
          {data.planos.map((p) => {
            const atual = p.nome === data.planoAtual;
            const pago = p.nome !== 'INDIVIDUAL';
            let acao = null;
            if (atual && ehAdmin) {
              acao =
                data.assinatura?.status === 'CANCELADA' ? (
                  <Link to="/conta/assinatura" className="flex min-h-12 items-center justify-center rounded-campo border border-borda font-semibold text-primary">
                    Reativar em Minha assinatura
                  </Link>
                ) : (
                  <Button variante="secundario" disabled>
                    Plano atual
                  </Button>
                );
            } else if (pago) {
              acao = (
                <Button onClick={() => assinar(p)} aria-label={`Assinar ${nomeDoPlano(p.nome)}`}>
                  Assinar
                </Button>
              );
            }
            return <PlanoCard key={p.id} plano={p} atual={atual} destaque={p.nome === 'FAMILIA'} acao={acao} />;
          })}
        </div>
      )}
      <AssinarComoMembroModal
        aberto={escolhido !== null}
        plano={escolhido}
        casaNome={u.casa.nome}
        aoFechar={() => setEscolhido(null)}
        aoContinuar={() => escolhido && irParaPagamento(escolhido, true)}
      />
    </PaginaForm>
  );
}

