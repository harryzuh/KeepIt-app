import { Link } from 'react-router';
import { Card } from '@/components/Card';
import { PapelSelo } from '@/components/PapelSelo';
import { useUsuarioAtual } from '@/features/auth/hooks';
import { ResumoCasa } from '@/features/estatisticas/ResumoCasa';
import { TabelaProdutosInicio } from '@/features/estatisticas/TabelaProdutosInicio';
import { useDesktop } from '@/features/estatisticas/useDesktop';
import { nomeDoPlano } from '@/features/estatisticas/util';
import { ProdutosRecentes } from '@/features/produtos/ProdutosRecentes';

/**
 * Telas 05 (celular) e 17 (desktop, 1024 px ou mais): saudação, Casa, indicadores do M4 (resumo), produtos
 * (recentes no celular, tabela com busca no desktop) e acesso às demais áreas.
 */
export default function Inicio() {
  const { data: u } = useUsuarioAtual();
  const desktop = useDesktop();
  if (!u) return null;
  const primeiroNome = u.nome.trim().split(/\s+/)[0];
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-bold">Olá, {primeiroNome}</h1>
      <Card className="p-5">
        <p className="text-sm text-suave">Sua Casa</p>
        <p className="text-xl font-bold">{u.casa.nome}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-suave">
          <PapelSelo papel={u.papel} />
          <span>Plano {nomeDoPlano(u.plano.nome)}</span>
          <span>
            {u.casa.totalMembros} {u.casa.totalMembros === 1 ? 'membro' : 'membros'}
          </span>
        </div>
      </Card>
      <ResumoCasa desktop={desktop} />
      {desktop ? <TabelaProdutosInicio papel={u.papel} /> : <ProdutosRecentes papel={u.papel} />}
      <Link to={u.papel === 'ADMIN' ? '/conta/assinatura' : '/conta/planos'} className="inline-flex min-h-11 w-fit items-center font-semibold text-primary underline">
        {u.papel === 'ADMIN' ? 'Minha assinatura' : 'Ver planos'}
      </Link>
      <Link to="/familia" className="inline-flex min-h-11 w-fit items-center font-semibold text-primary underline">
        Membros da Casa
      </Link>
      <Link to="/conta" className="inline-flex min-h-11 w-fit items-center font-semibold text-primary underline">
        Ir para Minha conta
      </Link>
    </div>
  );
}
