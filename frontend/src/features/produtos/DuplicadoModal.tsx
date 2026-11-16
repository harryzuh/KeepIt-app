import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { formatBRL } from '@/lib/format';
import { mensagemDeErro } from '@/lib/mensagens';
import { FotoProduto } from './FotoProduto';
import { useProduto } from './hooks';
import type { DetalhesDuplicado, EscolhaDuplicado } from './tipos';
import { formatDataCompra } from './util';

interface Props {
  duplicado: DetalhesDuplicado;
  enviando: EscolhaDuplicado | null;
  erro: unknown;
  aoEscolher: (escolha: EscolhaDuplicado) => void;
  aoCancelar: () => void;
}

/** Tela 09 — Produto duplicado (RF33): somar à quantidade, cadastrar mesmo assim ou cancelar (só fecha, sem chamada). */
export function DuplicadoModal({ duplicado: d, enviando, erro, aoEscolher, aoCancelar }: Props) {
  const e = d.existente;
  // O 409 não traz URL de foto (contrato): a miniatura vem do detalhe do produto existente.
  const capa = useProduto(e.fotoCapaId === null ? 0 : e.id).data?.fotos.find((f) => f.id === e.fotoCapaId) ?? null;
  const soma = e.quantidade + d.quantidadeInformada;
  const ocupado = enviando !== null;
  return (
    <Modal aberto titulo="Este produto já existe" aoFechar={aoCancelar}>
      <div className="flex flex-col gap-4">
        <p className="text-suave">Já há um produto com o nome “{e.nome}” na sua Casa.</p>
        <div className="flex items-center gap-3 rounded-campo border border-borda p-3">
          <FotoProduto foto={capa} nome={e.nome} className="size-16 rounded-campo" />
          <div className="min-w-0 text-sm">
            <p className="truncate font-semibold">{e.nome}</p>
            <p className="text-suave">{formatBRL(Number(e.preco))}</p>
            <p className="text-suave">
              Quantidade atual: <strong className="text-texto">{e.quantidade}</strong>
            </p>
            <p className="text-suave">Comprado em {formatDataCompra(e.dataCompra)}</p>
          </div>
        </div>
        <Alert>
          Somar adiciona só a quantidade informada ({d.quantidadeInformada}) ao produto existente: {e.quantidade} + {d.quantidadeInformada} ={' '}
          {soma}. Os demais dados que você digitou são descartados.
        </Alert>
        {erro != null && <Alert tipo="erro">{mensagemDeErro(erro)}</Alert>}
        <Button disabled={ocupado} carregando={enviando === 'SOMAR'} onClick={() => aoEscolher('SOMAR')}>
          Somar à quantidade
        </Button>
        <Button variante="secundario" disabled={ocupado} carregando={enviando === 'CADASTRAR_MESMO_ASSIM'} onClick={() => aoEscolher('CADASTRAR_MESMO_ASSIM')}>
          Cadastrar mesmo assim
        </Button>
        <Button variante="texto" disabled={ocupado} onClick={aoCancelar}>
          Cancelar
        </Button>
      </div>
    </Modal>
  );
}
