import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Carregando } from '@/components/Carregando';
import { PapelSelo } from '@/components/PapelSelo';
import { nomeDoPlano } from '@/features/assinatura/util';
import { useUsuarioAtual } from '@/features/auth/hooks';
import { EditarNomeCasa } from '@/features/casa/EditarNomeCasa';
import { GerenciarMembroModal } from '@/features/casa/GerenciarMembroModal';
import { SairDaCasaModal } from '@/features/casa/SairDaCasaModal';
import { useMembros } from '@/features/casa/hooks';
import type { MembroDaCasa } from '@/features/casa/tipos';
import { primeiraLetra } from '@/lib/format';
import { mensagemDeErro } from '@/lib/mensagens';

const PAPEIS = [
  ['ADMIN', 'Tudo, inclusive membros e assinatura'],
  ['EDITOR', 'Adicionar, editar e excluir produtos'],
  ['LEITOR', 'Apenas visualizar'],
] as const;

/** Tela 11 — Família (UC018, UC037, RF25): todos veem; só o ADMIN gerencia (telas 12 e 22). */
export default function Familia() {
  const { data: u } = useUsuarioAtual();
  const { data, isPending, isError, error, refetch } = useMembros();
  const [gerenciado, setGerenciado] = useState<MembroDaCasa | null>(null);
  const [saindo, setSaindo] = useState(false);
  const navigate = useNavigate();
  const aviso = (useLocation().state as { aviso?: string } | null)?.aviso;
  if (!u) return null;
  const admin = u.papel === 'ADMIN';

  if (isPending) return <Carregando />;
  if (isError) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold">Membros da Casa</h1>
        <Alert tipo="erro">{mensagemDeErro(error)}</Alert>
        <Button variante="secundario" onClick={() => refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  const pct = Math.min(100, Math.round((data.membrosEmUso / data.limiteMembros) * 100));
  const noLimite = data.membrosEmUso >= data.limiteMembros;
  return (
    <div className="flex flex-col gap-4">
      <header>
        <p className="text-suave">Plano {nomeDoPlano(data.plano.nome)}</p>
        <h1 className="text-3xl font-bold">Membros da Casa</h1>
        <p className="text-suave">{data.casa.nome}</p>
        {admin && <EditarNomeCasa nomeAtual={data.casa.nome} />}
      </header>

      {aviso && <Alert tipo="sucesso">{aviso}</Alert>}

      <Card className="flex items-center justify-between gap-4 p-4">
        <div>
          <p className="font-bold">
            {data.membrosEmUso} de {data.limiteMembros} membros
          </p>
          <p className="text-sm text-suave">O limite vem do seu plano</p>
        </div>
        <div
          role="progressbar"
          aria-label="Uso do limite de membros"
          aria-valuemin={0}
          aria-valuemax={data.limiteMembros}
          aria-valuenow={data.membrosEmUso}
          className="h-2 w-28 overflow-hidden rounded-full bg-borda"
        >
          <div className={noLimite ? 'h-full bg-erro' : 'h-full bg-apoio'} style={{ width: `${pct}%` }} />
        </div>
      </Card>

      {data.membros.length === 0 ? (
        <Alert>Nenhum membro encontrado.</Alert>
      ) : (
        <Card>
          <ul className="divide-y divide-borda">
            {data.membros.map((m) => (
              <li key={m.usuarioId} className="flex items-center gap-3 px-4 py-3">
                <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary font-bold text-white">
                  {primeiraLetra(m.nome)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {m.nome}
                    {m.usuarioId === u.id && ' (você)'}
                  </p>
                  {m.email && <p className="truncate text-sm text-suave">{m.email}</p>}
                </div>
                <PapelSelo papel={m.papel} />
                {admin && m.papel !== 'ADMIN' && (
                  <button
                    type="button"
                    aria-label={`Gerenciar ${m.nome}`}
                    onClick={() => setGerenciado(m)}
                    className="flex size-11 items-center justify-center rounded-full text-xl hover:bg-primary-claro"
                  >
                    <span aria-hidden="true">⋯</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-4">
        <h2 className="mb-2 font-bold">O que cada papel pode fazer</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {PAPEIS.map(([p, t]) => (
            <li key={p} className="flex items-center gap-3">
              <PapelSelo papel={p} />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </Card>

      {admin &&
        (noLimite ? (
          <Alert>
            Sua Casa atingiu o limite de membros do plano.{' '}
            <Link to="/conta/assinatura" className="font-semibold underline">
              Trocar de plano
            </Link>
          </Alert>
        ) : (
          <Link
            to="/familia/adicionar"
            className="flex min-h-12 w-full items-center justify-center rounded-campo bg-primary px-4 font-semibold text-white hover:bg-primary-escuro"
          >
            + Adicionar membro
          </Link>
        ))}

      {!admin && (
        <>
          <Button variante="contorno-perigo" onClick={() => setSaindo(true)}>
            Sair da Casa
          </Button>
          <SairDaCasaModal
            nomeCasa={data.casa.nome}
            aberto={saindo}
            aoFechar={() => setSaindo(false)}
            aoSair={() => {
              setSaindo(false);
              navigate('/familia', { replace: true, state: { aviso: 'Você saiu da Casa e agora tem uma Casa própria no plano Individual.' } });
            }}
          />
        </>
      )}

      {gerenciado && <GerenciarMembroModal key={gerenciado.usuarioId} membro={gerenciado} aoFechar={() => setGerenciado(null)} />}
    </div>
  );
}
