import { useState } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { cn } from '@/components/cn';
import { Input } from '@/components/Input';
import { ApiError } from '@/lib/api';
import { mensagemDeErro } from '@/lib/mensagens';
import { useCriarTag, useTags } from './hooks';
import { novaTagSchema } from './schemas';
import type { Tag } from './tipos';

const MAX_TAGS = 10;

interface Props {
  valor: number[];
  aoMudar: (ids: number[]) => void;
  erro?: string;
}

/** Seletor de tags da Casa com campo "Nova tag" (UC023, RF35). Tag repetida (409) seleciona a existente. */
export function TagSeletor({ valor, aoMudar, erro }: Props) {
  const { data, isPending, isError, refetch } = useTags();
  const criar = useCriarTag();
  const [nome, setNome] = useState('');
  const [erroNome, setErroNome] = useState<string>();

  const alternar = (id: number) => aoMudar(valor.includes(id) ? valor.filter((v) => v !== id) : [...valor, id]);
  const selecionar = (t: Tag) => {
    if (!valor.includes(t.id) && valor.length < MAX_TAGS) aoMudar([...valor, t.id]);
  };

  function adicionar() {
    const r = novaTagSchema.safeParse({ nome });
    if (!r.success) return setErroNome(r.error.issues[0].message);
    if (valor.length >= MAX_TAGS) return setErroNome('Máximo de 10 tags por produto');
    setErroNome(undefined);
    criar.mutate(r.data.nome, {
      onSuccess: (t) => {
        selecionar(t);
        setNome('');
      },
      onError: (e) => {
        if (e instanceof ApiError && e.codigo === 'TAG_EXISTENTE') {
          const ex = (e.extra as { existente?: Tag } | undefined)?.existente;
          if (ex) selecionar(ex);
          setErroNome(`Essa tag já existe${ex ? `: "${ex.nome}" foi selecionada` : ''}`);
        } else if (e instanceof ApiError && e.codigo === 'DADOS_INVALIDOS' && e.details[0]) setErroNome(e.details[0].mensagem);
        else setErroNome(mensagemDeErro(e));
      },
    });
  }

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1.5 text-sm font-medium">Tags</legend>
      {isPending && <p className="text-sm text-suave">Carregando tags...</p>}
      {isError && (
        <Alert tipo="erro">
          Não foi possível carregar as tags.{' '}
          <button type="button" className="font-semibold underline" onClick={() => refetch()}>
            Tentar novamente
          </button>
        </Alert>
      )}
      {data && data.itens.length === 0 && <p className="text-sm text-suave">Sua Casa ainda não tem tags. Crie a primeira abaixo.</p>}
      {data && data.itens.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {data.itens.map((t) => {
            const marcada = valor.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={marcada}
                disabled={!marcada && valor.length >= MAX_TAGS}
                onClick={() => alternar(t.id)}
                className={cn(
                  'min-h-11 rounded-full border px-3.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50',
                  marcada ? 'border-primary bg-primary text-white' : 'border-borda bg-white text-texto hover:bg-primary-claro',
                )}
              >
                {t.nome}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex items-start gap-2">
        <Input
          label="Nova tag"
          className="min-w-0 flex-1"
          value={nome}
          maxLength={40}
          erro={erroNome}
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              adicionar();
            }
          }}
        />
        <Button variante="secundario" className="mt-[1.65rem] w-auto! shrink-0" carregando={criar.isPending} onClick={adicionar}>
          Criar tag
        </Button>
      </div>
      {erro && (
        <p role="alert" className="text-sm text-erro">
          {erro}
        </p>
      )}
    </fieldset>
  );
}
