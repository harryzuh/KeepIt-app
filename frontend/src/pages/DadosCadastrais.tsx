import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { ApiError } from '@/lib/api';
import { useForm } from 'react-hook-form';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { CodigoInput } from '@/components/CodigoInput';
import { Input } from '@/components/Input';
import { PaginaForm } from '@/components/PaginaForm';
import { useAtualizarNome, useConfirmarEmail, useSolicitarEmail, useUsuarioAtual } from '@/features/auth/hooks';
import { dadosCadastraisSchema, type DadosCadastraisForm } from '@/features/auth/schemas';
import { primeiraLetra } from '@/lib/format';
import { aplicarErrosDeCampo, ehErroDeCampo, mensagemDeErro } from '@/lib/mensagens';

/**
 * Tela 20 — Dados cadastrais (UC015, RF18/RF19).
 * Nome: PATCH /me. E-mail: código enviado ao novo endereço (POST /me/email e /me/email/confirmar).
 * A foto de perfil está fora desta sprint (docs/backlog.md).
 */
export default function DadosCadastrais() {
  const { data: u } = useUsuarioAtual();
  const atualizarNome = useAtualizarNome();
  const solicitar = useSolicitarEmail();
  const confirmar = useConfirmarEmail();
  const [novoEmail, setNovoEmail] = useState<string | null>(null); // definido = aguardando código
  const [senhaConfirmada, setSenhaConfirmada] = useState(''); // reusada no "Reenviar código"
  const [codigo, setCodigo] = useState('');
  const [sucesso, setSucesso] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    reset,
    watch,
    formState: { errors, isValid, isDirty },
  } = useForm<DadosCadastraisForm>({
    resolver: zodResolver(dadosCadastraisSchema),
    mode: 'onChange',
    values: u ? { nome: u.nome, email: u.email, senhaAtual: '' } : undefined,
  });
  const emailDigitado = watch('email') ?? '';
  if (!u) return null;
  const emailMudou = emailDigitado.trim().toLowerCase() !== u.email.toLowerCase();

  const salvar = handleSubmit(async (dados) => {
    setSucesso(null);
    const emailNovo = dados.email.trim().toLowerCase();
    try {
      if (dados.nome !== u.nome) await atualizarNome.mutateAsync(dados.nome);
      if (emailNovo !== u.email.toLowerCase()) {
        const senhaAtual = dados.senhaAtual ?? '';
        if (!senhaAtual) {
          setError('senhaAtual', { message: 'Informe sua senha atual para trocar o e-mail' });
          return;
        }
        await solicitar.mutateAsync({ email: emailNovo, senhaAtual });
        setSenhaConfirmada(senhaAtual);
        setNovoEmail(emailNovo);
        setCodigo('');
      } else setSucesso('Dados atualizados.');
    } catch (e) {
      if (e instanceof ApiError && e.codigo === 'SENHA_INCORRETA') setError('senhaAtual', { message: mensagemDeErro(e) });
      else aplicarErrosDeCampo(e, setError, 'email');
    }
  });

  const confirmarCodigo = () =>
    confirmar.mutate(codigo, {
      onSuccess: () => {
        setNovoEmail(null);
        setSenhaConfirmada('');
        setSucesso('E-mail alterado. No próximo login use o novo e-mail.');
        reset();
      },
    });

  const erro = [atualizarNome.error, solicitar.error].find(
    (e) => e && !ehErroDeCampo(e) && !(e instanceof ApiError && e.codigo === 'SENHA_INCORRETA'),
  );
  const erroCodigo = confirmar.error;

  return (
    <PaginaForm titulo="Dados cadastrais" voltarPara="/conta" logada>
      <div className="mb-6 flex items-center gap-4 rounded-card border border-borda bg-white p-4">
        <span aria-hidden="true" className="flex size-14 items-center justify-center rounded-full bg-primary text-xl font-bold text-white">
          {primeiraLetra(u.nome)}
        </span>
        <p className="font-semibold">{u.nome}</p>
      </div>

      {novoEmail ? (
        <div className="flex flex-1 flex-col gap-4">
          <h2 className="text-2xl font-bold">Confirme o novo e-mail</h2>
          <p className="text-suave">
            Enviamos um código de 6 dígitos para <strong className="text-texto">{novoEmail}</strong>. Ele vale por 15 minutos. Seu e-mail atual continua valendo até a confirmação.
          </p>
          {erroCodigo && <Alert tipo="erro">{mensagemDeErro(erroCodigo)}</Alert>}
          <CodigoInput valor={codigo} aoMudar={setCodigo} erro={!!erroCodigo} />
          <button
            type="button"
            className="self-start font-semibold text-primary underline"
            onClick={() => {
              confirmar.reset();
              setCodigo('');
              solicitar.mutate({ email: novoEmail, senhaAtual: senhaConfirmada });
            }}
          >
            Reenviar código
          </button>
          <div className="mt-auto flex flex-col gap-3 pt-6">
            <Button disabled={codigo.length !== 6} carregando={confirmar.isPending} onClick={confirmarCodigo}>
              Confirmar e-mail
            </Button>
            <Button
              variante="texto"
              onClick={() => {
                setNovoEmail(null);
                setSenhaConfirmada('');
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={salvar} noValidate className="flex flex-1 flex-col gap-4">
          {sucesso && <Alert tipo="sucesso">{sucesso}</Alert>}
          {erro && <Alert tipo="erro">{mensagemDeErro(erro)}</Alert>}
          <Input label="Nome" autoComplete="name" erro={errors.nome?.message} {...register('nome')} />
          <Input label="E-mail" type="email" autoComplete="email" erro={errors.email?.message} {...register('email')} />
          {emailMudou && (
            <Input
              label="Senha atual"
              type="password"
              autoComplete="current-password"
              erro={errors.senhaAtual?.message}
              {...register('senhaAtual')}
            />
          )}
          <Alert>Se você mudar o e-mail, pediremos sua senha atual e enviaremos um código para o novo endereço antes de salvar.</Alert>
          <div className="mt-auto pt-6">
            <Button type="submit" disabled={!isValid || !isDirty} carregando={atualizarNome.isPending || solicitar.isPending}>
              Salvar alterações
            </Button>
          </div>
        </form>
      )}
    </PaginaForm>
  );
}
