import { useCallback, useState } from 'react';
import { urlDoS3 } from '@/lib/s3';
import { cn } from '@/components/cn';
import type { FotoLeitura } from './tipos';

interface Props {
  foto: FotoLeitura | null | undefined;
  nome: string;
  className?: string;
  /** Chamado quando a imagem não carrega (ex.: URL assinada vencida). */
  aoFalhar?: () => void;
}

/** Foto do produto (URL assinada de leitura) ou um quadro neutro. `alt` descreve a foto (RNF19); sem foto o quadro é decorativo. */
export function FotoProduto({ foto, nome, className, aoFalhar }: Props) {
  const [falhou, setFalhou] = useState(false);
  const falhar = useCallback(() => {
    setFalhou(true);
    aoFalhar?.();
  }, [aoFalhar]);
  // O erro pode ter ocorrido antes de o React ligar o onError (máquina carregada, loading="lazy"):
  // ao montar, uma imagem já concluída e sem pixels é tratada como falha.
  const aoMontar = useCallback(
    (img: HTMLImageElement | null) => {
      if (img && img.complete && img.naturalWidth === 0 && img.getAttribute('src')) falhar();
    },
    [falhar],
  );
  if (!foto || falhou) {
    return (
      <span aria-hidden="true" className={cn('flex shrink-0 items-center justify-center bg-primary-claro text-2xl text-primary/60', className)}>
        ▢
      </span>
    );
  }
  return (
    <img
      src={urlDoS3(foto.url)}
      alt={`Foto de ${nome}`}
      loading="lazy"
      ref={aoMontar}
      onError={falhar}
      className={cn('shrink-0 object-cover', className)}
    />
  );
}
