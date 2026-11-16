import { useRef } from 'react';
import { Alert } from '@/components/Alert';
import { formatBytes } from '@/lib/format';
import { ErroComLink } from './ErroComLink';
import { MAX_FOTOS } from './fotos';
import { FotoProduto } from './FotoProduto';
import type { useFotos } from './useFotos';
import { UsoArmazenamento } from './UsoArmazenamento';

type Estado = ReturnType<typeof useFotos>;

/** Fotos da tela 08 (UC021, RF05): até 3, JPEG/PNG de até 5 MB, enviadas direto ao S3 com progresso. */
export function FotosEditor({ fotos, nome }: { fotos: Estado; nome: string }) {
  const entrada = useRef<HTMLInputElement>(null);
  const { itens } = fotos;
  const cheio = itens.length >= MAX_FOTOS;
  const rotulo = nome.trim() || 'produto';
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1.5 text-sm font-medium">
        Fotos (opcional, até {MAX_FOTOS}) <span className="font-normal text-suave">JPEG ou PNG, até 5 MB cada</span>
      </legend>
      {fotos.aviso != null && (
        <Alert tipo="erro">
          <ErroComLink erro={fotos.aviso} />
        </Alert>
      )}
      {itens.length > 0 && (
        <ul className="grid grid-cols-3 gap-2">
          {itens.map((i, n) => (
            <li key={i.uid} className="flex flex-col gap-1">
              {i.k === 'existente' ? (
                <FotoProduto key={i.foto.url} foto={i.foto} nome={`${rotulo} (foto ${n + 1})`} className="aspect-square w-full rounded-campo" />
              ) : (
                <img src={i.preview} alt={`Prévia da foto ${n + 1} de ${rotulo}`} className="aspect-square w-full rounded-campo object-cover" />
              )}
              {n === 0 && <span className="text-xs font-semibold text-primary">Capa</span>}
              {i.k === 'nova' && i.estado === 'enviando' && (
                <div
                  role="progressbar"
                  aria-label={`Enviando foto ${n + 1}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={i.progresso}
                  className="h-1.5 w-full overflow-hidden rounded-full bg-borda"
                >
                  <div className="h-full bg-primary transition-all" style={{ width: `${i.progresso}%` }} />
                </div>
              )}
              {i.k === 'nova' && i.estado === 'pronta' && <span className="text-xs text-suave">Enviada · {formatBytes(i.tamanho)}</span>}
              {i.k === 'nova' && i.estado === 'erro' && (
                <span role="alert" className="text-xs text-erro">
                  <ErroComLink erro={i.erro} />{' '}
                  <button type="button" className="font-semibold underline" onClick={() => fotos.reenviar(i.uid)}>
                    Tentar de novo
                  </button>
                </span>
              )}
              <div className="flex flex-wrap gap-x-3 text-xs">
                {n > 0 && (
                  <button type="button" className="inline-flex min-h-11 items-center font-semibold text-primary underline" onClick={() => fotos.tornarCapa(i.uid)} aria-label={`Tornar capa da foto ${n + 1}`}>
                    Tornar capa
                  </button>
                )}
                <button type="button" className="inline-flex min-h-11 items-center font-semibold text-erro underline" onClick={() => fotos.remover(i.uid)} aria-label={`Remover foto ${n + 1}`}>
                  Remover
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={entrada}
        type="file"
        accept="image/jpeg,image/png"
        multiple
        hidden
        aria-label="Escolher fotos"
        data-testid="entrada-fotos"
        onChange={(e) => {
          void fotos.adicionar(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      <button
        type="button"
        disabled={cheio}
        onClick={() => entrada.current?.click()}
        className="flex min-h-12 w-full items-center justify-center rounded-campo border border-dashed border-primary/50 bg-white px-4 font-semibold text-primary hover:bg-primary-claro disabled:cursor-not-allowed disabled:opacity-50"
      >
        {cheio ? 'Limite de 3 fotos atingido' : itens.length ? 'Adicionar outra foto' : 'Adicionar fotos'}
      </button>
      <p className="text-xs text-suave">A localização e outros dados ocultos da foto são removidos ao salvar.</p>
      <UsoArmazenamento />
    </fieldset>
  );
}
