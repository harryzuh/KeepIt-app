import { useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Carregando } from '@/components/Carregando';
import { PaginaForm } from '@/components/PaginaForm';
import { CartaoFormulario } from '@/features/assinatura/CartaoForm';
import { useAssinaturaAtual, useAssinar, useMetodoPagamento, usePlanos } from '@/features/assinatura/hooks';
import type { PlanoContratavel } from '@/features/assinatura/tipos';
import { formatGb, MARCAS, nomeDoPlano, precoDoPlano } from '@/features/assinatura/util';
import { useUsuarioAtual } from '@/features/auth/hooks';
import { ApiError } from '@/lib/api';
import { mensagemDeErro } from '@/lib/mensagens';

const PLANOS_URL: Record<string, PlanoContratavel> = { familia: 'FAMILIA', business: 'BUSINESS' };

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex justify-between gap-3 py-1">
      <dt className="text-suave">{rotulo}</dt>
      <dd className="font-semibold">{valor}</dd>
    </div>
  );
}

interface Violacao {
  limite: 'MEMBROS' | 'ARMAZENAMENTO';
  atual: number;
  maximo: number;
}

const gb = (bytes: number) => (bytes / 1024 ** 3).toLocaleString('pt-BR', { maximumFractionDigits: 1 });

/**
 * Mensagem de erro da assinatura. PLANO_NAO_COMPORTA traz `details: { plano, violacoes }` (contrato 3.4):
 * a mensagem mostra os números de cada limite estourado.
 */
export function textoDoErro(erro: unknown): string {
  if (erro instanceof ApiError && erro.codigo === 'PLANO_NAO_COMPORTA') {
    const violacoes = ((erro.details as unknown as { violacoes?: Violacao[] } | null)?.violacoes ?? []).filter(
      (v) => v && typeof v.atual === 'number' && typeof v.maximo === 'number',
    );
    const partes = violacoes.map((v) =>
      v.limite === 'MEMBROS'
        ? `${v.atual} membros (este plano permite ${v.maximo})`
        : `${gb(v.atual)} GB em uso (este plano permite ${gb(v.maximo)} GB)`,
    );
    return partes.length
      ? `Sua Casa tem ${partes.join(' e ')}. Remova membros ou arquivos, ou escolha outro plano.`
      : 'Seu plano atual tem mais membros ou espaço em uso do que este plano comporta. Remova membros ou escolha outro plano.';
  }
  return mensagemDeErro(erro);
}

/**
 * Tela 14 — Pagamento simulado (UC028, RF13, RF15). O pagamento usa o cartão salvo do usuário;
 * EDITOR e LEITOR só chegam aqui depois de confirmar o aviso da tela 24.
 */
export default function Pagamento() {
  const { plano: slug = '' } = useParams();
  const nomePlano = PLANOS_URL[slug];
  const confirmaSaida = (useLocation().state as { confirmaSaida?: boolean } | null)?.confirmaSaida === true;
  const navigate = useNavigate();
  const { data: u } = useUsuarioAtual();
  const planos = usePlanos();
  const metodo = useMetodoPagamento();
  const ehAdmin = u?.papel === 'ADMIN';
  const atual = useAssinaturaAtual();
  const assinar = useAssinar();
  const [adicionando, setAdicionando] = useState(false);

  if (!u) return null;
  // Sem plano válido, ou membro que não confirmou o aviso: volta para a escolha.
  if (!nomePlano || (!ehAdmin && !confirmaSaida)) return <Navigate to="/conta/planos" replace />;

  const plano = planos.data?.planos.find((p) => p.nome === nomePlano);
  const carregando = planos.isPending || metodo.isPending;
  const cartao = metodo.data?.metodo ?? null;
  const usarNovo = adicionando || (!carregando && cartao === null);

  const uso = ehAdmin ? atual.data?.uso : undefined;
  const cabe = plano && uso ? uso.membros.emUso <= plano.limiteMembros && uso.armazenamento.usadoBytes <= plano.limiteArmazenamentoGb * 1024 ** 3 : null;

  const pagar = () =>
    assinar.mutate(
      { plano: nomePlano, ...(ehAdmin ? {} : { confirmaSaidaDaCasa: true }) },
      { onSuccess: () => navigate('/conta/assinatura', { replace: true, state: { aviso: `Assinatura do plano ${nomeDoPlano(nomePlano)} ativada.` } }) },
    );

  return (
    <PaginaForm titulo={`Assinar ${nomeDoPlano(nomePlano)}`} voltarPara="/conta/planos" logada>
      {carregando ? (
        <Carregando />
      ) : planos.isError || metodo.isError || !plano ? (
        <Alert tipo="erro">{mensagemDeErro(planos.error ?? metodo.error)}</Alert>
      ) : (
        <div className="flex flex-1 flex-col gap-4">
          <Card className="p-4">
            <dl>
              <Linha rotulo="Plano" valor={nomeDoPlano(plano.nome)} />
              <Linha rotulo="Valor" valor={`${precoDoPlano(plano)}/mês`} />
              <Linha rotulo="Renovação" valor="Mensal, automática" />
            </dl>
          </Card>
          {uso && cabe !== null && (
            <p className={cabe ? 'text-sm text-primary' : 'text-sm text-erro'} role="status">
              {cabe ? '✓ ' : ''}
              Seus {uso.membros.emUso} {uso.membros.emUso === 1 ? 'membro' : 'membros'} e {formatGb(uso.armazenamento.usadoBytes)}{' '}
              {cabe ? 'cabem no plano' : 'não cabem no plano'}
            </p>
          )}

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Método de pagamento</legend>
            {cartao && (
              <label className="flex cursor-pointer items-center gap-3 rounded-card border border-borda bg-white p-4 has-[:checked]:border-2 has-[:checked]:border-primary">
                <input type="radio" name="metodo" checked={!adicionando} onChange={() => setAdicionando(false)} className="size-5 accent-primary" />
                <span>
                  <span className="block font-semibold">Cartão de crédito</span>
                  <span className="block text-sm text-suave">
                    {MARCAS[cartao.marca]} final {cartao.ultimos4}
                  </span>
                </span>
              </label>
            )}
            {cartao ? (
              <label className="flex cursor-pointer items-center gap-3 rounded-card border border-borda bg-white p-4 has-[:checked]:border-2 has-[:checked]:border-primary">
                <input type="radio" name="metodo" checked={adicionando} onChange={() => setAdicionando(true)} className="size-5 accent-primary" />
                <span className="font-semibold">Adicionar novo cartão</span>
              </label>
            ) : (
              <p className="font-semibold">Adicionar novo cartão</p>
            )}
            {usarNovo && <CartaoFormulario aoSalvar={() => setAdicionando(false)} />}
          </fieldset>
          <p className="text-sm text-suave">O pagamento é simulado. O KeepIT guarda só a marca e os 4 últimos dígitos do cartão.</p>

          {assinar.error && <Alert tipo="erro">{textoDoErro(assinar.error)}</Alert>}
          <Button className="mt-auto" onClick={pagar} disabled={!cartao || adicionando} carregando={assinar.isPending}>
            Confirmar e pagar {precoDoPlano(plano)}
          </Button>
        </div>
      )}
    </PaginaForm>
  );
}
