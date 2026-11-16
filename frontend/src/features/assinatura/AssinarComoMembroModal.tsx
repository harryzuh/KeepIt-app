import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import type { PlanoDetalhe } from './tipos';
import { nomeDoPlano } from './util';

interface Props {
  aberto: boolean;
  plano: PlanoDetalhe | null;
  casaNome: string;
  aoContinuar: () => void;
  aoFechar: () => void;
}

/** Tela 24 — Assinar como membro (RF38, RNF12): aviso de saída da Casa antes do pagamento. */
export function AssinarComoMembroModal({ aberto, plano, casaNome, aoContinuar, aoFechar }: Props) {
  return (
    <Modal aberto={aberto} titulo="Você vai criar uma nova Casa" aoFechar={aoFechar}>
      <p className="mb-4 text-suave">
        Ao assinar o plano {plano ? nomeDoPlano(plano.nome) : ''}, você sai da <strong className="text-texto">{casaNome}</strong> e vira o ADMIN
        de uma Casa nova. Os produtos que você cadastrou continuam na {casaNome}.
      </p>
      <div className="flex flex-col gap-2">
        <Button onClick={aoContinuar}>Continuar para o pagamento</Button>
        <Button variante="texto" onClick={aoFechar}>
          Ficar na Casa atual
        </Button>
      </div>
    </Modal>
  );
}
