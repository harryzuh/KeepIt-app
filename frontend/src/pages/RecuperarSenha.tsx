import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { CodigoInput } from '@/components/CodigoInput';
import { cn } from '@/components/cn';
import { Input } from '@/components/Input';
import { PaginaForm } from '@/components/PaginaForm';
import { Requisito } from '@/components/Requisitos';
import { useRecuperarSenha, useRedefinirSenha } from '@/features/auth/hooks';
import {
  novaSenhaSchema,
  recuperarSenhaSchema,
  type NovaSenhaForm,
} from '@/features/auth/schemas';
import { ApiError } from '@/lib/api';
import { aplicarErrosDeCampo, ehErroDeCampo, mensagemDeErro, mensagemPorCodigo } from '@/lib/mensagens';

const ESPERA_REENVIO_S = 60;
const ETAPAS = ['E-mail', 'Código', 'Nova senha'];

function Etapas({ atual }: { atual: 1 | 2 | 3 }) {
  return (
    <ol className="mb-6 flex gap-2" aria-label="Etapas da recuperação">
      {ETAPAS.map((nome, i) => (
        <li key={nome} className="flex-1" aria-current={atual === i + 1 ? 'step' : undefined}>
          <div className={cn('mb-1 h-0.5 rounded', i < atual ? 'bg-primary' : 'bg-borda')} />
          <span className={cn('text-xs', i < atual ? 'font-semibold text-primary' : 'text-suave')}>
            {i + 1} {nome}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Telas 04 (etapas 1 e 2) e 18 (etapa 3) — UC006, UC007, UC009.
 * E-mail e código ficam só em memória: a API não tem pré-validação (ADR A4).
 */
export default function RecuperarSenha() {
  const navigate = useNavigate();
  const [etapa, setEtapa] = useState<1 | 2 | 3>(1);
  const [email, setEmail] = useState('');
  const [codigo, setCodigo] = useState('');
  const [codigoRejeitado, setCodigoRejeitado] = useState(false);
  const [espera, setEspera] = useState(0);
  const recuperar = useRecuperarSenha();
  const redefinir = useRedefinirSenha();

  useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setEspera((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  const voltar = () => {
    if (etapa === 1) navigate('/entrar');
    else setEtapa((e) => (e - 1) as 1 | 2);
  };

  // ---- Etapa 1: e-mail
  const formEmail = useForm<{ email: string }>({ resolver: zodResolver(recuperarSenhaSchema), mode: 'onChange' });
  const enviarEmail = formEmail.handleSubmit(({ email: e }) =>
    recuperar.mutate(e, {
      onSuccess: () => {
        setEmail(e);
        setCodigo('');
        setCodigoRejeitado(false);
        setEspera(ESPERA_REENVIO_S);
        setEtapa(2);
      },
      onError: (err) => aplicarErrosDeCampo(err, formEmail.setError),
    }),
  );

  const reenviar = () =>
    recuperar.mutate(email, {
      onSuccess: () => {
        setCodigo('');
        setCodigoRejeitado(false);
        setEspera(ESPERA_REENVIO_S);
      },
    });

  // ---- Etapa 3: nova senha
  const formSenha = useForm<NovaSenhaForm>({ resolver: zodResolver(novaSenhaSchema), mode: 'onChange' });
  const novaSenha = formSenha.watch('novaSenha') ?? '';
  const confirmar = formSenha.watch('confirmarSenha') ?? '';
  const salvar = formSenha.handleSubmit((dados) =>
    redefinir.mutate(
      { email, codigo, ...dados },
      {
        onSuccess: () =>
          navigate('/entrar', { replace: true, state: { aviso: 'Senha alterada. Entre com a nova senha.' } }),
        onError: (err) => {
          if (err instanceof ApiError && err.codigo === 'CODIGO_INVALIDO') {
            setCodigo('');
            setCodigoRejeitado(true);
            setEtapa(2);
          } else aplicarErrosDeCampo(err, formSenha.setError);
        },
      },
    ),
  );

  const m = String(Math.floor(espera / 60));
  const s = String(espera % 60).padStart(2, '0');

  return (
    <PaginaForm titulo="Recuperar senha" aoVoltar={voltar}>
      <Etapas atual={etapa} />

      {etapa === 1 && (
        <form onSubmit={enviarEmail} noValidate className="flex flex-1 flex-col gap-4">
          <h2 className="text-3xl font-bold">Esqueceu a senha?</h2>
          <p className="text-suave">Informe o e-mail da sua conta e enviaremos um código de 6 dígitos.</p>
          {recuperar.error && !ehErroDeCampo(recuperar.error) && <Alert tipo="erro">{mensagemDeErro(recuperar.error)}</Alert>}
          <Input label="E-mail" type="email" autoComplete="email" erro={formEmail.formState.errors.email?.message} {...formEmail.register('email')} />
          <div className="mt-auto pt-6">
            <Button type="submit" disabled={!formEmail.formState.isValid} carregando={recuperar.isPending}>
              Enviar código
            </Button>
          </div>
        </form>
      )}

      {etapa === 2 && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setCodigoRejeitado(false);
            setEtapa(3);
          }}
          className="flex flex-1 flex-col gap-4"
        >
          <h2 className="text-3xl font-bold">Digite o código</h2>
          <p className="text-suave">
            Enviamos um código de 6 dígitos para <strong className="text-texto">{email}</strong>. Ele vale por 15 minutos.
          </p>
          {codigoRejeitado && <Alert tipo="erro">{mensagemPorCodigo('CODIGO_INVALIDO')}. Digite outro ou reenvie o código.</Alert>}
          {recuperar.error && <Alert tipo="erro">{mensagemDeErro(recuperar.error)}</Alert>}
          <CodigoInput valor={codigo} aoMudar={setCodigo} erro={codigoRejeitado} />
          {espera > 0 ? (
            <p className="font-medium text-primary" aria-live="off">
              Reenviar código em {m}:{s}
            </p>
          ) : (
            <button type="button" onClick={reenviar} className="self-start font-semibold text-primary underline">
              Reenviar código
            </button>
          )}
          <div className="mt-auto pt-6">
            <Button type="submit" disabled={codigo.length !== 6}>
              Confirmar código
            </Button>
          </div>
        </form>
      )}

      {etapa === 3 && (
        <form onSubmit={salvar} noValidate className="flex flex-1 flex-col gap-4">
          <h2 className="text-3xl font-bold">Crie uma nova senha</h2>
          <p className="text-suave">Ela substitui a senha antiga em todos os seus dispositivos.</p>
          {redefinir.error && !ehErroDeCampo(redefinir.error) && <Alert tipo="erro">{mensagemDeErro(redefinir.error)}</Alert>}
          <div>
            <Input
              label="Nova senha"
              type="password"
              autoComplete="new-password"
              erro={formSenha.formState.errors.novaSenha?.message}
              {...formSenha.register('novaSenha', { deps: ['confirmarSenha'] })}
            />
            {!formSenha.formState.errors.novaSenha && <Requisito ok={novaSenha.length >= 8}>Mínimo de 8 caracteres</Requisito>}
          </div>
          <div>
            <Input
              label="Confirmar nova senha"
              type="password"
              autoComplete="new-password"
              erro={formSenha.formState.errors.confirmarSenha?.message}
              {...formSenha.register('confirmarSenha')}
            />
            {confirmar.length > 0 && !formSenha.formState.errors.confirmarSenha && novaSenha === confirmar && (
              <Requisito ok>As senhas conferem</Requisito>
            )}
          </div>
          <div className="mt-auto pt-6">
            <Button type="submit" disabled={!formSenha.formState.isValid} carregando={redefinir.isPending}>
              Salvar nova senha
            </Button>
          </div>
        </form>
      )}
    </PaginaForm>
  );
}
