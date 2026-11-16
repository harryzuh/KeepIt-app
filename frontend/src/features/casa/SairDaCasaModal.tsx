import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { mensagemDeErro } from '@/lib/mensagens';
import { useSairDaCasa } from './hooks';

/**
 * Saída voluntária da Casa (POST /casa/sair, docs/api/m2-casa.md 3.6). Só EDITOR e LEITOR:
 * a pessoa ganha uma Casa Individual própria; os produtos que cadastrou ficam na Casa atual (RNF12: confirmação).
 */
export function SairDaCasaModal({ nomeCasa, aberto, aoFechar, aoSair }: { nomeCasa: string; aberto: boolean; aoFechar: () => void; aoSair: () => void }) {
  const sair = useSairDaCasa();
  const fechar = () => {
    sair.reset();
    aoFechar();
  };
  return (
    <Modal aberto={aberto} titulo="Sair da Casa?" aoFechar={fechar}>
      <div className="flex flex-col gap-4">
        <p className="text-suave">
          Você vai sair de <strong className="text-texto">{nomeCasa}</strong> e passar a ter uma Casa própria no plano Individual, como ADMIN.
          Os produtos que você cadastrou continuam em {nomeCasa}, sem o seu nome como autor, e você não os leva com você. Para voltar, um ADMIN precisa adicionar você de novo.
        </p>
        {sair.error && <Alert tipo="erro">{mensagemDeErro(sair.error)}</Alert>}
        <Button variante="perigo" carregando={sair.isPending} onClick={() => sair.mutate(undefined, { onSuccess: aoSair })}>
          Sair da Casa
        </Button>
        <Button variante="texto" onClick={fechar}>
          Cancelar
        </Button>
      </div>
    </Modal>
  );
}
