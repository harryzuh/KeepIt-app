import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useLocation } from 'react-router';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { PaginaForm } from '@/components/PaginaForm';
import { useLogin } from '@/features/auth/hooks';
import { loginSchema, type LoginForm } from '@/features/auth/schemas';
import { aplicarErrosDeCampo, ehErroDeCampo, mensagemDeErro } from '@/lib/mensagens';

/** Tela 02 — Entrar (UC004/UC005). O redirecionamento para a tela 05 é da RotaPublica. */
export default function Entrar() {
  const aviso = (useLocation().state as { aviso?: string } | null)?.aviso;
  const login = useLogin();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isValid },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema), mode: 'onChange' });

  const enviar = handleSubmit((dados) =>
    login.mutate(dados, { onError: (e) => aplicarErrosDeCampo(e, setError) }),
  );
  const erroGeral = login.error && !ehErroDeCampo(login.error) ? mensagemDeErro(login.error) : null;

  return (
    <PaginaForm voltarPara="/">
      <h1 className="text-3xl font-bold">Bem-vindo de volta</h1>
      <p className="mb-6 mt-1 text-suave">Entre para acessar a sua Casa.</p>
      {aviso && <Alert tipo="sucesso" className="mb-4">{aviso}</Alert>}
      <form onSubmit={enviar} noValidate className="flex flex-1 flex-col gap-4">
        {erroGeral && <Alert tipo="erro">{erroGeral}</Alert>}
        <Input label="E-mail" type="email" autoComplete="email" placeholder="voce@email.com" erro={errors.email?.message} {...register('email')} />
        <Input label="Senha" type="password" autoComplete="current-password" erro={errors.senha?.message} {...register('senha')} />
        <Link to="/recuperar-senha" className="self-end text-sm font-semibold text-primary">
          Esqueci minha senha
        </Link>
        <div className="mt-auto flex flex-col gap-3 pt-6">
          <Button type="submit" disabled={!isValid} carregando={login.isPending}>
            Entrar
          </Button>
          <p className="text-center text-sm text-suave">
            Não tem conta?{' '}
            <Link to="/criar-conta" className="font-semibold text-primary">
              Criar conta
            </Link>
          </p>
        </div>
      </form>
    </PaginaForm>
  );
}
