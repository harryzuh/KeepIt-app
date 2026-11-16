import { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Carregando } from '@/components/Carregando';
import { PaginaForm } from '@/components/PaginaForm';
import { CancelarAssinaturaModal } from '@/features/assinatura/CancelarAssinaturaModal';
import { useAssinaturaAtual, useReativarAssinatura } from '@/features/assinatura/hooks';
import { formatGb, MARCAS, nomeDoPlano, precoDoPlano } from '@/features/assinatura/util';
import { useUsuarioAtual } from '@/features/auth/hooks';
import { formatData } from '@/lib/format';
import { mensagemDeErro } from '@/lib/mensagens';

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <dt className="text-suave">{rotulo}</dt>
      <dd className="text-right font-semibold">{children}</dd>
    </div>
  );
}

const botaoLink = 'flex min-h-12 w-full items-center justify-center rounded-campo border border-borda bg-white px-4 font-semibold hover:bg-primary-claro';

/** Tela 15 — Minha assinatura (UC031, RF16): só ADMIN. Cancelar pede confirmação (RNF12). */
export default function MinhaAssinatura() {
  const { data: u } = useUsuarioAtual();
  const { data, isPending, isError, error, refetch } = useAssinaturaAtual();
  const reativar = useReativarAssinatura();
  const [cancelando, setCancelando] = useState(false);
  const aviso = (useLocation().state as { aviso?: string } | null)?.aviso;
  if (!u) return null;
  if (u.papel !== 'ADMIN') return <Navigate to="/conta/planos" replace />;

  const a = data?.assinatura ?? null;
  return (
    <PaginaForm titulo="Minha assinatura" voltarPara="/conta" logada>
      {aviso && <Alert tipo="sucesso" className="mb-4">{aviso}</Alert>}
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
          <Card className="p-4">
            <dl>
              <Linha rotulo="Plano">{nomeDoPlano(data.planoAtual.nome)}</Linha>
              {a ? (
                <>
                  <Linha rotulo="Valor">{precoDoPlano(a.plano)}/mês</Linha>
                  <Linha rotulo="Status">
                    <span className={a.status === 'ATIVA' ? 'rounded-md bg-primary-claro px-2 py-0.5 text-xs font-bold text-primary' : 'rounded-md bg-erro-claro px-2 py-0.5 text-xs font-bold text-erro'}>
                      {a.status}
                    </span>
                  </Linha>
                  <Linha rotulo={a.status === 'ATIVA' ? 'Renova em' : 'Benefícios até'}>{formatData(a.dataRenovacao)}</Linha>
                </>
              ) : (
                <Linha rotulo="Valor">Grátis</Linha>
              )}
              <Linha rotulo="Membros">
                {data.uso.membros.emUso} de {data.uso.membros.limite}
              </Linha>
              <Linha rotulo="Armazenamento">
                {formatGb(data.uso.armazenamento.usadoBytes)} de {formatGb(data.uso.armazenamento.limiteBytes)}
              </Linha>
              {data.metodoPagamento && (
                <Linha rotulo="Pagamento">
                  {MARCAS[data.metodoPagamento.marca]} final {data.metodoPagamento.ultimos4}
                </Linha>
              )}
            </dl>
          </Card>

          {!a && <Alert>Sua Casa está no plano Individual. Conheça os planos para ter mais membros e espaço.</Alert>}
          {a?.status === 'CANCELADA' && (
            <Alert tipo="info">
              Assinatura cancelada. Você mantém os benefícios até {formatData(a.dataRenovacao)}; depois a Casa volta ao plano Individual.
            </Alert>
          )}
          {reativar.error && <Alert tipo="erro">{mensagemDeErro(reativar.error)}</Alert>}

          <Link to="/conta/planos" className={botaoLink}>
            {a ? 'Trocar de plano' : 'Ver planos'}
          </Link>
          {a?.status === 'CANCELADA' && a.podeReativar && (
            <Button onClick={() => reativar.mutate(undefined)} carregando={reativar.isPending}>
              Reativar assinatura
            </Button>
          )}
          {a?.status === 'ATIVA' && (
            <Button variante="contorno-perigo" onClick={() => setCancelando(true)}>
              Cancelar assinatura
            </Button>
          )}
          {a && <CancelarAssinaturaModal assinatura={a} aberto={cancelando} aoFechar={() => setCancelando(false)} />}
        </div>
      )}
    </PaginaForm>
  );
}
