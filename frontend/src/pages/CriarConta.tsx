import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { PaginaForm } from '@/components/PaginaForm';
import { Requisito } from '@/components/Requisitos';
import { useCadastro } from '@/features/auth/hooks';
import { cadastroSchema, type CadastroForm } from '@/features/auth/schemas';
import { aplicarErrosDeCampo, ehErroDeCampo, mensagemDeErro } from '@/lib/mensagens';

/** Tela 03 — Criar conta (UC008, RF02, RF32). A Casa Individual é criada pela API. */
export default function CriarConta() {
  const cadastro = useCadastro();
  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isValid },
  } = useForm<CadastroForm>({ resolver: zodResolver(cadastroSchema), mode: 'onChange' });
  const senha = watch('senha') ?? '';
  const confirmar = watch('confirmarSenha') ?? '';

  const enviar = handleSubmit((dados) =>
    cadastro.mutate(dados, { onError: (e) => aplicarErrosDeCampo(e, setError, 'email') }),
  );
  const erroGeral = cadastro.error && !ehErroDeCampo(cadastro.error) ? mensagemDeErro(cadastro.error) : null;

  return (
    <PaginaForm voltarPara="/">
      <h1 className="text-3xl font-bold">Criar conta</h1>
      <p className="mb-6 mt-1 text-suave">Sua Casa é criada com o plano Individual, gratuito.</p>
      <form onSubmit={enviar} noValidate className="flex flex-1 flex-col gap-4">
        {erroGeral && <Alert tipo="erro">{erroGeral}</Alert>}
        <Input label="Nome" autoComplete="name" erro={errors.nome?.message} {...register('nome')} />
        <Input label="E-mail" type="email" autoComplete="email" placeholder="voce@email.com" erro={errors.email?.message} {...register('email')} />
        <div>
          <Input
            label="Senha"
            type="password"
            autoComplete="new-password"
            erro={errors.senha?.message}
            {...register('senha', { deps: ['confirmarSenha'] })}
          />
          {!errors.senha && <Requisito ok={senha.length >= 8}>Mínimo de 8 caracteres</Requisito>}
        </div>
        <div>
          <Input
            label="Confirmar senha"
            type="password"
            autoComplete="new-password"
            erro={errors.confirmarSenha?.message}
            {...register('confirmarSenha')}
          />
          {confirmar.length > 0 && !errors.confirmarSenha && senha === confirmar && <Requisito ok>As senhas conferem</Requisito>}
        </div>
        <div className="mt-auto flex flex-col gap-3 pt-6">
          <Button type="submit" disabled={!isValid} carregando={cadastro.isPending}>
            Cadastrar
          </Button>
          <p className="text-center text-sm text-suave">
            Ao cadastrar você aceita os{' '}
            <Link to="/termos" className="underline">
              Termos de uso
            </Link>
            .
          </p>
        </div>
      </form>
    </PaginaForm>
  );
}
