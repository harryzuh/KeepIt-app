import { Link } from 'react-router';
import { Alert } from '@/components/Alert';
import { Card } from '@/components/Card';
import { formatDinheiro } from '@/lib/format';
import { BarraArmazenamento } from './BarraArmazenamento';
import { ErroComTentarDeNovo } from './ErroComTentarDeNovo';
import { useEstatisticas, useResumo } from './hooks';
import { Indicador, IndicadorEsqueleto } from './Indicador';
import { RenovacaoTexto } from './RenovacaoTexto';
import { produtosTexto } from './util';

const linkEstatisticas = (
  <Link to="/estatisticas" className="inline-flex min-h-11 w-fit items-center font-semibold text-primary underline">
    Ver estatísticas
  </Link>
);

/**
 * Indicadores do Início (UC017, RF24). Celular (tela 05): valor total em destaque, contagens e membros.
 * Desktop (tela 17): quatro indicadores lado a lado (valor total, maior gasto, valor médio e membros), os dois do meio vindos da tela 10.
 * Só exibe o que a API devolve; nada é calculado aqui além da formatação.
 */
export function ResumoCasa({ desktop }: { desktop: boolean }) {
  const resumo = useResumo();
  const completa = useEstatisticas({ enabled: desktop });

  if (resumo.isPending) {
    return (
      <section aria-label="Resumo da Casa" aria-busy="true" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div role="status" className="sr-only">
          Carregando indicadores...
        </div>
        <IndicadorEsqueleto className="sm:col-span-2 lg:col-span-1" />
        <IndicadorEsqueleto />
        <IndicadorEsqueleto />
        <IndicadorEsqueleto />
      </section>
    );
  }
  if (resumo.isError) {
    return (
      <section aria-label="Resumo da Casa">
        <ErroComTentarDeNovo erro={resumo.error} aoTentar={() => resumo.refetch()} />
      </section>
    );
  }

  const r = resumo.data;
  const vazio = r.produtos === 0;
  const membros = `${r.membros.emUso} de ${r.membros.limite}`;
  const c = completa.data;
  const maior = c?.maiorGasto;

  return (
    <section aria-label="Resumo da Casa" className="flex flex-col gap-3">
      {desktop ? (
        <div className="grid grid-cols-4 gap-3">
          <Indicador rotulo="Valor total" valor={formatDinheiro(r.valorTotal)} destaque detalhe={produtosTexto(r.produtos)} />
          <Indicador
            rotulo="Maior gasto"
            valor={maior ? formatDinheiro(maior.valor) : '—'}
            detalhe={maior && <span className="block truncate" title={maior.nome}>{maior.nome}</span>}
          />
          <Indicador rotulo="Valor médio" valor={c && !vazio ? formatDinheiro(c.valorMedio) : '—'} detalhe="por produto" />
          <Indicador rotulo="Membros" valor={membros} detalhe={`${r.tags} ${r.tags === 1 ? 'tag' : 'tags'}`} />
        </div>
      ) : (
        <>
          <Indicador rotulo="Valor total do patrimônio" valor={formatDinheiro(r.valorTotal)} destaque />
          <div className="grid grid-cols-3 gap-3">
            <Indicador rotulo="Produtos" valor={r.produtos.toLocaleString('pt-BR')} />
            <Indicador rotulo="Tags" valor={r.tags.toLocaleString('pt-BR')} />
            <Indicador rotulo="Membros" valor={membros} />
          </div>
        </>
      )}
      {desktop && completa.isError && <ErroComTentarDeNovo erro={completa.error} aoTentar={() => completa.refetch()} />}
      {vazio && <Alert>Nenhum produto cadastrado ainda. Os indicadores aparecem aqui quando houver produtos.</Alert>}
      <Card className="flex flex-col gap-3 p-4">
        <BarraArmazenamento usadoBytes={r.armazenamento.usadoBytes} limiteBytes={r.armazenamento.limiteBytes} />
        <p className="text-sm text-suave">
          <RenovacaoTexto plano={r.plano} renovacao={r.renovacao} />
        </p>
      </Card>
      {linkEstatisticas}
    </section>
  );
}
