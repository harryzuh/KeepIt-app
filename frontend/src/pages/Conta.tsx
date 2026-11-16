import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { Alert } from '@/components/Alert';
import { Card } from '@/components/Card';
import { PapelSelo } from '@/components/PapelSelo';
import { nomeDoPlano } from '@/features/assinatura/util';
import { ExcluirContaModal } from '@/features/auth/ExcluirContaModal';
import { useLogout, useUsuarioAtual } from '@/features/auth/hooks';
import { mascararEmail, primeiraLetra } from '@/lib/format';
import { mensagemDeErro } from '@/lib/mensagens';

const linha = 'flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-primary-claro/50';

function Item({ para, titulo, descricao }: { para: string; titulo: string; descricao?: string }) {
  return (
    <Link to={para} className={linha}>
      <span>
        <span className="block font-medium">{titulo}</span>
        {descricao && <span className="block text-sm text-suave">{descricao}</span>}
      </span>
      <span aria-hidden="true" className="text-suave">›</span>
    </Link>
  );
}

function Lista({ children }: { children: ReactNode }) {
  return <Card className="divide-y divide-borda overflow-hidden">{children}</Card>;
}

/** Tela 16 — Conta (UC012, UC013, UC015). E-mail mascarado (RNF25). */
export default function Conta() {
  const { data: u } = useUsuarioAtual();
  const logout = useLogout();
  const aviso = (useLocation().state as { aviso?: string } | null)?.aviso;
  const [excluindo, setExcluindo] = useState(false);
  if (!u) return null;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-bold">Minha conta</h1>
      {aviso && <Alert tipo="sucesso">{aviso}</Alert>}
      <Card className="flex items-center gap-4 p-4">
        <span aria-hidden="true" className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-xl font-bold text-white">
          {primeiraLetra(u.nome)}
        </span>
        <div className="min-w-0">
          <p className="truncate font-bold">{u.nome}</p>
          <p className="truncate text-sm text-suave">{mascararEmail(u.email)}</p>
          <div className="mt-1">
            <PapelSelo papel={u.papel} />
          </div>
        </div>
      </Card>

      <Lista>
        <Item para="/conta/dados" titulo="Dados cadastrais" descricao="Nome e e-mail" />
        <Item para="/conta/senha" titulo="Alterar senha" />
        <Item para="/familia" titulo="Membros da Casa" descricao={`${u.casa.totalMembros} de ${u.plano.limiteMembros}`} />
        {u.papel === 'ADMIN' ? (
          <Item para="/conta/assinatura" titulo="Minha assinatura" descricao={`Plano ${nomeDoPlano(u.plano.nome)}`} />
        ) : (
          <Item para="/conta/planos" titulo="Planos" descricao={`Plano ${nomeDoPlano(u.plano.nome)}`} />
        )}
      </Lista>
      <Lista>
        <Item para="/termos" titulo="Termos de uso e privacidade" />
      </Lista>

      {logout.error && <Alert tipo="erro">{mensagemDeErro(logout.error)}</Alert>}
      <Lista>
        <button type="button" className={linha} onClick={() => logout.mutate()} disabled={logout.isPending}>
          <span className="font-medium">{logout.isPending ? 'Encerrando...' : 'Encerrar sessão'}</span>
        </button>
        <button type="button" className={`${linha} text-erro`} onClick={() => setExcluindo(true)}>
          <span>
            <span className="block font-medium">Excluir conta</span>
            <span className="block text-sm text-suave">Seus dados pessoais são apagados em até 24 h</span>
          </span>
        </button>
      </Lista>
      <ExcluirContaModal perfil={u} aberto={excluindo} aoFechar={() => setExcluindo(false)} />
    </div>
  );
}
