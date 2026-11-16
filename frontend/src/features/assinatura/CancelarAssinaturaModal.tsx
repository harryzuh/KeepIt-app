import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { ApiError } from '@/lib/api';
import { formatData } from '@/lib/format';
import { aplicarErrosDeCampo, mensagemDeErro } from '@/lib/mensagens';
import { useCancelarAssinatura } from './hooks';
import { cancelamentoSchema, type CancelamentoForm } from './schemas';
import type { AssinaturaAtual } from './tipos';
import { nomeDoPlano } from './util';

interface Props {
  assinatura: AssinaturaAtual;
  aberto: boolean;
  aoFechar: () => void;
}

/** Tela 15 — modal de confirmação do cancelamento (UC031, RF16, RNF12). */
export function CancelarAssinaturaModal({ assinatura, aberto, aoFechar }: Props) {
  const cancelar = useCancelarAssinatura();
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm<CancelamentoForm>({ resolver: zodResolver(cancelamentoSchema), defaultValues: { motivo: '' } });

  const fechar = () => {
    reset();
    cancelar.reset();
    aoFechar();
  };
  const enviar = handleSubmit(({ motivo }) =>
    cancelar.mutate(motivo || undefined, {
      onSuccess: fechar,
      onError: (e) => aplicarErrosDeCampo(e, setError),
    }),
  );
  const erroGeral = cancelar.error && !(cancelar.error instanceof ApiError && cancelar.error.codigo === 'DADOS_INVALIDOS');

  return (
    <Modal aberto={aberto} titulo="Cancelar a assinatura?" aoFechar={fechar}>
      <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
        <p className="text-suave">
          Você continua com os benefícios do plano {nomeDoPlano(assinatura.plano.nome)} até{' '}
          <strong className="text-texto">{formatData(assinatura.dataRenovacao)}</strong>. Depois disso a Casa volta ao plano Individual e os
          membros extras perdem o acesso. Seus produtos são mantidos.
        </p>
        {erroGeral && <Alert tipo="erro">{mensagemDeErro(cancelar.error)}</Alert>}
        <Input label="Motivo (opcional)" placeholder="Conte por que está saindo" maxLength={300} erro={errors.motivo?.message} {...register('motivo')} />
        <Button type="submit" variante="perigo" carregando={cancelar.isPending}>
          Confirmar cancelamento
        </Button>
        <Button variante="texto" onClick={fechar}>
          Manter assinatura
        </Button>
      </form>
    </Modal>
  );
}
