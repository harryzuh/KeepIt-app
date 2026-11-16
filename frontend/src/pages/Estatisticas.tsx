import { Link } from 'react-router';
import { Card } from '@/components/Card';
import { Alert } from '@/components/Alert';
import { useUsuarioAtual } from '@/features/auth/hooks';
import { ErroComTentarDeNovo } from '@/features/estatisticas/ErroComTentarDeNovo';
import { GraficoValorPorTag } from '@/features/estatisticas/GraficoValorPorTag';
import { useEstatisticas } from '@/features/estatisticas/hooks';
import { Indicador, IndicadorEsqueleto } from '@/features/estatisticas/Indicador';
import { composicao, ListaProdutoValor } from '@/features/estatisticas/ListaProdutoValor';
import { haSobreposicao, produtosTexto, unidadesTexto } from '@/features/estatisticas/util';
import { formatDataCompra } from '@/features/produtos/util';
import { formatDinheiro } from '@/lib/format';

/** Tela 10 — Estatísticas (UC027, RF23): maior gasto, valor médio, tag mais comprada, valor por tag e produtos mais antigos. Só leitura. */
export default function Estatisticas() {
  const { data: u } = useUsuarioAtual();
  const q = useEstatisticas();
  if (!u) return null;
  const podeEditar = u.papel !== 'LEITOR';
  const d = q.data;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-x-4">
        <Link to="/inicio" className="inline-flex min-h-11 items-center font-semibold text-primary underline">
          ← Voltar ao Início
        </Link>
        <h1 className="w-full text-3xl font-bold">Estatísticas</h1>
      </header>

      {q.isPending && (
        <div aria-busy="true" className="flex flex-col gap-3">
          <p role="status" className="sr-only">
            Carregando estatísticas...
          </p>
          <IndicadorEsqueleto />
          <IndicadorEsqueleto />
          <IndicadorEsqueleto />
        </div>
      )}
      {q.isError && <ErroComTentarDeNovo erro={q.error} aoTentar={() => q.refetch()} />}

      {d && d.produtos === 0 && (
        <Card className="flex flex-col items-center gap-3 p-6 text-center">
          <p className="font-semibold">Ainda não há dados para estatísticas</p>
          <p className="text-sm text-suave">
            {podeEditar ? 'Cadastre produtos para ver o valor da sua Casa por tag, o maior gasto e mais.' : 'Quando alguém da Casa cadastrar produtos, as estatísticas aparecem aqui.'}
          </p>
          {podeEditar && (
            <Link to="/produtos/novo" className="inline-flex min-h-11 items-center font-semibold text-primary underline">
              Adicionar produto
            </Link>
          )}
        </Card>
      )}

      {d && d.produtos > 0 && (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
            <Indicador rotulo="Valor total" valor={formatDinheiro(d.valorTotal)} detalhe={`${produtosTexto(d.produtos)} · ${unidadesTexto(d.unidades)}`} destaque className="sm:col-span-3" />
            {d.maiorGasto ? (
              <Link to={`/produtos/${d.maiorGasto.id}`} className="block min-w-0 rounded-card hover:bg-primary-claro/50">
                <Indicador
                  rotulo="Maior gasto"
                  agrupar={false}
                  valor={formatDinheiro(d.maiorGasto.valor)}
                  detalhe={
                    <>
                      <span className="block truncate" title={d.maiorGasto.nome}>
                        {d.maiorGasto.nome}
                      </span>
                      <span className="block">{composicao(d.maiorGasto)}</span>
                      <span className="block">Comprado em {formatDataCompra(d.maiorGasto.dataCompra)}</span>
                    </>
                  }
                />
              </Link>
            ) : (
              <Indicador rotulo="Maior gasto" valor="—" />
            )}
            <Indicador rotulo="Valor médio" valor={formatDinheiro(d.valorMedio)} detalhe="por produto cadastrado" />
            <Indicador
              rotulo="Tag mais comprada"
              valor={d.tagMaisComprada ? d.tagMaisComprada.nome : 'Sem tags ainda'}
              detalhe={d.tagMaisComprada && `${unidadesTexto(d.tagMaisComprada.unidades)} em ${produtosTexto(d.tagMaisComprada.produtos)}`}
            />
          </div>

          <section aria-labelledby="titulo-por-tag" className="flex flex-col gap-3">
            <h2 id="titulo-por-tag" className="text-xl font-bold">
              Valor por tag
            </h2>
            {d.valorPorTag.length === 0 && !d.semTag ? (
              <Alert>Nenhuma tag em uso ainda.</Alert>
            ) : (
              <Card className="p-4">
                <GraficoValorPorTag dados={d} />
              </Card>
            )}
            {haSobreposicao(d.valorPorTag, d.valorTotal) && <p className="text-xs text-suave">Produtos com mais de uma tag aparecem em cada uma.</p>}
            {d.totalTagsComProduto > d.valorPorTag.length && (
              <p className="text-xs text-suave">
                Mostrando as {d.valorPorTag.length} tags de maior valor, de {d.totalTagsComProduto} em uso.
              </p>
            )}
          </section>

          <section aria-labelledby="titulo-antigos" className="flex flex-col gap-3">
            <h2 id="titulo-antigos" className="text-xl font-bold">
              Produtos mais antigos
            </h2>
            <ListaProdutoValor itens={d.maisAntigos} />
          </section>
        </>
      )}
    </div>
  );
}
