import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { aplicarErrosDeCampo, ehErroDeCampo, mensagemDeErro } from '@/lib/mensagens';
import { useRenomearCasa } from './hooks';
import { nomeCasaSchema, type NomeCasaForm } from './schemas';

/** Edição do nome da Casa pelo ADMIN (RF32): botão + modal. */
export function EditarNomeCasa({ nomeAtual }: { nomeAtual: string }) {
  const [aberto, setAberto] = useState(false);
  const renomear = useRenomearCasa();
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm<NomeCasaForm>({ resolver: zodResolver(nomeCasaSchema), defaultValues: { nome: nomeAtual } });

  const abrir = () => {
    reset({ nome: nomeAtual });
    renomear.reset();
    setAberto(true);
  };
  const enviar = handleSubmit(({ nome }) =>
    renomear.mutate(nome, { onSuccess: () => setAberto(false), onError: (e) => aplicarErrosDeCampo(e, setError) }),
  );

  return (
    <>
      <button type="button" onClick={abrir} className="min-h-11 text-sm font-semibold text-primary underline">
        Editar nome da Casa
      </button>
      <Modal aberto={aberto} titulo="Nome da Casa" aoFechar={() => setAberto(false)}>
        <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
          {renomear.error && !ehErroDeCampo(renomear.error) && <Alert tipo="erro">{mensagemDeErro(renomear.error)}</Alert>}
          <Input label="Nome" maxLength={80} erro={errors.nome?.message} {...register('nome')} />
          <Button type="submit" carregando={renomear.isPending}>
            Salvar nome
          </Button>
          <Button variante="texto" onClick={() => setAberto(false)}>
            Cancelar
          </Button>
        </form>
      </Modal>
    </>
  );
}
