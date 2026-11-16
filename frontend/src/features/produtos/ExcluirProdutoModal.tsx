import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { mensagemDeErro } from '@/lib/mensagens';
import { useExcluirProduto } from './hooks';

interface Props {
  produto: { id: number; nome: string };
  aberto: boolean;
  aoFechar: () => void;
  aoExcluir: () => void;
}

/** Tela 23 — Excluir produto (UC026, RF09, RNF12): definitivo, sem lixeira e sem desfazer. */
export function ExcluirProdutoModal({ produto, aberto, aoFechar, aoExcluir }: Props) {
  const excluir = useExcluirProduto();
  const fechar = () => {
    excluir.reset();
    aoFechar();
  };
  return (
    <Modal aberto={aberto} titulo="Excluir produto?" aoFechar={fechar}>
      <div className="flex flex-col gap-4">
        <p className="text-suave">
          <strong className="text-texto">{produto.nome}</strong> será excluído da Casa junto com suas fotos. Essa ação não pode ser desfeita.
        </p>
        {excluir.error && <Alert tipo="erro">{mensagemDeErro(excluir.error)}</Alert>}
        <Button variante="perigo" carregando={excluir.isPending} onClick={() => excluir.mutate(produto.id, { onSuccess: aoExcluir })}>
          Excluir produto
        </Button>
        <Button variante="texto" disabled={excluir.isPending} onClick={fechar}>
          Cancelar
        </Button>
      </div>
    </Modal>
  );
}
