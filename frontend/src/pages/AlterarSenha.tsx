import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { PaginaForm } from '@/components/PaginaForm';
import { Requisito } from '@/components/Requisitos';
import { useAlterarSenha } from '@/features/auth/hooks';
import { alterarSenhaSchema, type AlterarSenhaForm } from '@/features/auth/schemas';
import { ApiError } from '@/lib/api';
import { aplicarErrosDeCampo, ehErroDeCampo, mensagemDeErro } from '@/lib/mensagens';

/** Tela 19 — Alterar senha (UC010/UC011). Troca o token guardado e volta à tela 16. */
export default function AlterarSenha() {
  const navigate = useNavigate();
  const alterar = useAlterarSenha();
  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isValid },
  } = useForm<AlterarSenhaForm>({ resolver: zodResolver(alterarSenhaSchema), mode: 'onChange' });
  const nova = watch('novaSenha') ?? '';
  const confirmar = watch('confirmarSenha') ?? '';

  const enviar = handleSubmit((dados) =>
    alterar.mutate(dados, {
      onSuccess: () => navigate('/conta', { state: { aviso: 'Senha alterada com sucesso.' } }),
      onError: (e) => {
        if (e instanceof ApiError && e.codigo === 'SENHA_INCORRETA') setError('senhaAtual', { message: mensagemDeErro(e) });
        else if (e instanceof ApiError && e.codigo === 'SENHA_IGUAL_ATUAL') setError('novaSenha', { message: mensagemDeErro(e) });
        else aplicarErrosDeCampo(e, setError);
      },
    }),
  );
  const erroGeral =
    alterar.error instanceof ApiError &&
    !['SENHA_INCORRETA', 'SENHA_IGUAL_ATUAL'].includes(alterar.error.codigo) &&
    !ehErroDeCampo(alterar.error);

  return (
    <PaginaForm titulo="Alterar senha" voltarPara="/conta" logada>
      <p className="mb-6 text-suave">Para sua segurança, confirme a senha atual antes de definir a nova.</p>
      <form onSubmit={enviar} noValidate className="flex flex-1 flex-col gap-4">
        {erroGeral && <Alert tipo="erro">{mensagemDeErro(alterar.error)}</Alert>}
        <Input label="Senha atual" type="password" autoComplete="current-password" erro={errors.senhaAtual?.message} {...register('senhaAtual')} />
        <div>
          <Input
            label="Nova senha"
            type="password"
            autoComplete="new-password"
            erro={errors.novaSenha?.message}
            {...register('novaSenha', { deps: ['confirmarSenha'] })}
          />
          {!errors.novaSenha && <Requisito ok={nova.length >= 8}>Mínimo de 8 caracteres</Requisito>}
        </div>
        <div>
          <Input label="Confirmar nova senha" type="password" autoComplete="new-password" erro={errors.confirmarSenha?.message} {...register('confirmarSenha')} />
          {confirmar.length > 0 && !errors.confirmarSenha && nova === confirmar && <Requisito ok>As senhas conferem</Requisito>}
        </div>
        <div className="mt-auto pt-6">
          <Button type="submit" disabled={!isValid} carregando={alterar.isPending}>
            Alterar senha
          </Button>
        </div>
      </form>
    </PaginaForm>
  );
}
