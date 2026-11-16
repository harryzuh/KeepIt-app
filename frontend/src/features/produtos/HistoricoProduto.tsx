import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { formatBRL } from '@/lib/format';
import { mensagemDeErro } from '@/lib/mensagens';
import { useHistorico } from './hooks';
import type { DetalhesAlterado, EventoHistorico } from './tipos';
import { formatDataCompra } from './util';

const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

function linhasAlteradas({ alteracoes: a }: DetalhesAlterado): string[] {
  const l: string[] = [];
  if (a.nome) l.push(`Nome: “${a.nome.de}” → “${a.nome.para}”`);
  if (a.descricao) l.push(a.descricao.para ? 'Descrição alterada' : 'Descrição removida');
  if (a.preco) l.push(`Preço: ${formatBRL(Number(a.preco.de))} → ${formatBRL(Number(a.preco.para))}`);
  if (a.quantidade) l.push(`Quantidade: ${a.quantidade.de} → ${a.quantidade.para}`);
  if (a.dataCompra) l.push(`Data da compra: ${formatDataCompra(a.dataCompra.de)} → ${formatDataCompra(a.dataCompra.para)}`);
  if (a.tags) {
    if (a.tags.adicionadas.length) l.push(`Tags adicionadas: ${a.tags.adicionadas.join(', ')}`);
    if (a.tags.removidas.length) l.push(`Tags removidas: ${a.tags.removidas.join(', ')}`);
  }
  if (a.fotos) {
    if (a.fotos.adicionadas) l.push(`${plural(a.fotos.adicionadas, 'foto adicionada', 'fotos adicionadas')}`);
    if (a.fotos.removidas) l.push(`${plural(a.fotos.removidas, 'foto removida', 'fotos removidas')}`);
  }
  return l;
}

function Descricao({ e }: { e: EventoHistorico }) {
  if (e.tipo === 'CRIADO') return <p className="font-medium">Produto cadastrado ({plural(e.detalhes.quantidade, 'unidade', 'unidades')})</p>;
  if (e.tipo === 'QUANTIDADE_SOMADA')
    return (
      <p className="font-medium">
        Quantidade somada: {e.detalhes.anterior} + {e.detalhes.somada} = {e.detalhes.final}
      </p>
    );
  return (
    <>
      <p className="font-medium">Produto alterado</p>
      <ul className="mt-0.5 list-inside list-disc text-sm text-suave">
        {linhasAlteradas(e.detalhes).map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </>
  );
}

/** Histórico de adições e alterações do produto (RF11, tela 07), do mais novo para o mais antigo. */
export function HistoricoProduto({ produtoId }: { produtoId: number }) {
  const h = useHistorico(produtoId);
  const eventos = h.data?.pages.flatMap((p) => p.itens) ?? [];
  return (
    <section aria-labelledby="titulo-historico" className="flex flex-col gap-2">
      <h2 id="titulo-historico" className="text-lg font-bold">
        Histórico
      </h2>
      {h.isPending && <p className="text-sm text-suave">Carregando histórico...</p>}
      {h.isError && (
        <Alert tipo="erro">
          {mensagemDeErro(h.error)}{' '}
          <button type="button" className="font-semibold underline" onClick={() => h.refetch()}>
            Tentar novamente
          </button>
        </Alert>
      )}
      {h.data && eventos.length === 0 && <p className="text-sm text-suave">Nenhum evento registrado.</p>}
      {eventos.length > 0 && (
        <Card>
          <ul className="divide-y divide-borda">
            {eventos.map((e) => (
              <li key={e.id} className="px-4 py-3">
                <Descricao e={e} />
                <p className="mt-0.5 text-xs text-suave">
                  {dataHora(e.criadoEm)} · {e.autor ? e.autor.nome : 'ex-membro'}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {h.hasNextPage && (
        <Button variante="secundario" carregando={h.isFetchingNextPage} onClick={() => h.fetchNextPage()}>
          Carregar mais
        </Button>
      )}
    </section>
  );
}
