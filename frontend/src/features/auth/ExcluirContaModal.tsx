import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { nomeDoPlano } from '@/features/assinatura/util';
import { ApiError } from '@/lib/api';
import { formatData } from '@/lib/format';
import { aplicarErrosDeCampo, ehErroDeCampo, mensagemDeErro } from '@/lib/mensagens';
import { useExcluirConta } from './hooks';
import { excluirContaSchema } from './schemas';
import type { Perfil } from './tipos';

/** Aviso do UC013: só ADMIN de Casa com assinatura vigente ou com outros membros (docs/api/m1-auth.md, seção 2). */
export const exigeAvisoDeAdmin = (p: Perfil) =>
  p.papel === 'ADMIN' && (p.assinatura !== null || p.casa.totalMembros > 1);

/** Tela 21 — Excluir conta (UC013/UC014, RNF12): confirmação obrigatória com senha. */
export function ExcluirContaModal({ perfil, aberto, aoFechar }: { perfil: Perfil; aberto: boolean; aoFechar: () => void }) {
  const excluir = useExcluirConta();
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isValid },
  } = useForm<{ senha: string }>({ resolver: zodResolver(excluirContaSchema), mode: 'onChange' });

  const fechar = () => {
    reset();
    excluir.reset();
    aoFechar();
  };
  const enviar = handleSubmit(({ senha }) =>
    excluir.mutate(senha, {
      onError: (e) => {
        if (e instanceof ApiError && e.codigo === 'SENHA_INCORRETA') setError('senha', { message: 'Senha incorreta' });
        else aplicarErrosDeCampo(e, setError);
      },
    }),
  );
  const erroGeral = excluir.error && excluir.error instanceof ApiError && excluir.error.codigo !== 'SENHA_INCORRETA' && !ehErroDeCampo(excluir.error);

  return (
    <Modal aberto={aberto} titulo="Excluir sua conta?" aoFechar={fechar}>
      <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
        <p className="text-suave">
          {exigeAvisoDeAdmin(perfil) && (
            <>
              Como você é ADMIN{perfil.assinatura && (
                <>
                  , a assinatura do plano {nomeDoPlano(perfil.plano.nome)} (renovação em {formatData(perfil.assinatura.dataRenovacao)}) expira agora
                </>
              )}
              {perfil.casa.totalMembros > 1
                ? '. O membro mais antigo assume como ADMIN e a Casa e os produtos são mantidos; os demais membros recebem uma Casa própria.'
                : '.'}{' '}
            </>
          )}
          Seus dados pessoais são apagados em até 24 h. Essa ação não pode ser desfeita.
        </p>
        {erroGeral && <Alert tipo="erro">{mensagemDeErro(excluir.error)}</Alert>}
        <Input label="Digite sua senha para confirmar" type="password" autoComplete="current-password" erro={errors.senha?.message} {...register('senha')} />
        <Button type="submit" variante="perigo" disabled={!isValid} carregando={excluir.isPending}>
          Excluir minha conta
        </Button>
        <Button variante="texto" onClick={fechar}>
          Cancelar
        </Button>
      </form>
    </Modal>
  );
}
