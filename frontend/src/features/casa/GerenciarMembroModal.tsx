import { useState } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { mensagemDeErro } from '@/lib/mensagens';
import { useAlterarPapel, useRemoverMembro } from './hooks';
import { PapelRadio } from './PapelRadio';
import type { MembroDaCasa, PapelAtribuivel } from './tipos';

interface Props {
  membro: MembroDaCasa;
  aoFechar: () => void;
}

/** Tela 22 — Gerenciar membro (UC034, UC035, UC036; RF27, RF28). Remover pede uma segunda confirmação (RNF12). */
export function GerenciarMembroModal({ membro, aoFechar }: Props) {
  const alterar = useAlterarPapel();
  const remover = useRemoverMembro();
  const [papel, setPapel] = useState<PapelAtribuivel>(membro.papel === 'EDITOR' ? 'EDITOR' : 'LEITOR');
  const [confirmando, setConfirmando] = useState(false);
  const erro = alterar.error ?? remover.error;
  const ocupado = alterar.isPending || remover.isPending;

  if (confirmando) {
    return (
      <Modal aberto titulo={`Remover ${membro.nome} da Casa?`} aoFechar={aoFechar}>
        <div className="flex flex-col gap-4">
          <p className="text-suave">
            {membro.nome} perde o acesso à Casa e passa a ter uma Casa própria no plano Individual. Os produtos que ele cadastrou continuam
            na Casa.
          </p>
          {remover.error && <Alert tipo="erro">{mensagemDeErro(remover.error)}</Alert>}
          <Button variante="perigo" carregando={remover.isPending} onClick={() => remover.mutate(membro.usuarioId, { onSuccess: aoFechar })}>
            Confirmar remoção
          </Button>
          <Button variante="texto" disabled={ocupado} onClick={() => setConfirmando(false)}>
            Cancelar
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal aberto titulo={membro.nome} aoFechar={aoFechar}>
      <div className="flex flex-col gap-4">
        <p className="-mt-1 text-sm text-suave">{membro.email}</p>
        <PapelRadio valor={papel} aoMudar={setPapel} />
        {erro && <Alert tipo="erro">{mensagemDeErro(erro)}</Alert>}
        <Button
          carregando={alterar.isPending}
          disabled={papel === membro.papel}
          onClick={() => alterar.mutate({ usuarioId: membro.usuarioId, papel }, { onSuccess: aoFechar })}
        >
          Salvar papel
        </Button>
        <Button variante="contorno-perigo" disabled={ocupado} onClick={() => setConfirmando(true)}>
          Remover da Casa
        </Button>
        <p className="text-center text-sm text-suave">Os produtos que {membro.nome} cadastrou continuam na Casa.</p>
      </div>
    </Modal>
  );
}
