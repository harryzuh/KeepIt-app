import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { aplicarErrosDeCampo, ehErroDeCampo, mensagemDeErro } from '@/lib/mensagens';
import { useSalvarMetodo } from './hooks';
import { CARTOES_DE_TESTE, cartaoSchema, type CartaoForm } from './schemas';

/** Tela 14 — cadastro do cartão simulado (RF15). Só número e validade; o servidor guarda marca e 4 últimos dígitos. */
export function CartaoFormulario({ aoSalvar }: { aoSalvar: () => void }) {
  const salvar = useSalvarMetodo();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<CartaoForm>({ resolver: zodResolver(cartaoSchema), defaultValues: { numero: '', validade: '' } });

  const enviar = handleSubmit((d) =>
    salvar.mutate(
      { numero: d.numero, validade: d.validade },
      { onSuccess: aoSalvar, onError: (e) => aplicarErrosDeCampo(e, setError) },
    ),
  );

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-3 rounded-card border border-borda bg-white p-4" aria-label="Novo cartão">
      <Alert>
        Pagamento simulado: não use um cartão real. Use o cartão de teste <strong>{CARTOES_DE_TESTE.aprovado}</strong> com
        qualquer validade futura (para simular uma recusa, use {CARTOES_DE_TESTE.recusado}).
      </Alert>
      {salvar.error && !ehErroDeCampo(salvar.error) && <Alert tipo="erro">{mensagemDeErro(salvar.error)}</Alert>}
      <Input label="Número do cartão" inputMode="numeric" autoComplete="cc-number" placeholder="0000 0000 0000 0000" erro={errors.numero?.message} {...register('numero')} />
      <Input label="Validade" inputMode="numeric" autoComplete="cc-exp" placeholder="MM/AA" maxLength={5} erro={errors.validade?.message} {...register('validade')} />
      <Button type="submit" variante="secundario" carregando={salvar.isPending}>
        Salvar cartão
      </Button>
    </form>
  );
}
