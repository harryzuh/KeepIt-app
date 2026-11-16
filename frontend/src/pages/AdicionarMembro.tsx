import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate } from 'react-router';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { PaginaForm } from '@/components/PaginaForm';
import { useUsuarioAtual } from '@/features/auth/hooks';
import { useAdicionarMembro } from '@/features/casa/hooks';
import { PapelRadio } from '@/features/casa/PapelRadio';
import { adicionarMembroSchema, type AdicionarMembroForm } from '@/features/casa/schemas';
import { ApiError } from '@/lib/api';
import { aplicarErrosDeCampo, ehErroDeCampo, mensagemPorCodigo } from '@/lib/mensagens';

/** Tela 12 — Adicionar membro (UC033, RF26, RNF13): só ADMIN; adição direta por e-mail de conta existente. */
export default function AdicionarMembro() {
  const { data: u } = useUsuarioAtual();
  const adicionar = useAdicionarMembro();
  const navigate = useNavigate();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<AdicionarMembroForm>({ resolver: zodResolver(adicionarMembroSchema), defaultValues: { email: '', papel: 'LEITOR' } });
  if (!u) return null;
  if (u.papel !== 'ADMIN') return <Navigate to="/familia" replace />;

  const enviar = handleSubmit((d) =>
    adicionar.mutate(d, {
      onSuccess: ({ membro }) => navigate('/familia', { state: { aviso: `${membro.nome} foi adicionado à Casa.` } }),
      onError: (e) => aplicarErrosDeCampo(e, setError),
    }),
  );
  const erro = adicionar.error;
  const limite = erro instanceof ApiError && erro.codigo === 'LIMITE_MEMBROS';

  return (
    <PaginaForm titulo="Adicionar membro" voltarPara="/familia" logada>
      <form onSubmit={enviar} noValidate className="flex flex-1 flex-col gap-4">
        <Input
          label="E-mail do membro"
          type="email"
          autoComplete="off"
          dica="A pessoa precisa ter uma conta KeepIT. Ela recebe um aviso por e-mail."
          erro={errors.email?.message}
          {...register('email')}
        />
        <Controller control={control} name="papel" render={({ field }) => <PapelRadio valor={field.value} aoMudar={field.onChange} />} />
        <Alert>Apenas o ADMIN gerencia membros e a assinatura. Você pode mudar o papel depois.</Alert>
        {erro && !ehErroDeCampo(erro) && (
          <Alert tipo="erro">
            {mensagemPorCodigo(erro instanceof ApiError ? erro.codigo : 'ERRO_INTERNO')}
            {limite && (
              <>
                {' '}
                <Link to="/conta/assinatura" className="font-semibold underline">
                  Trocar de plano
                </Link>
              </>
            )}
          </Alert>
        )}
        <Button type="submit" className="mt-auto" carregando={adicionar.isPending}>
          Adicionar à Casa
        </Button>
      </form>
    </PaginaForm>
  );
}
