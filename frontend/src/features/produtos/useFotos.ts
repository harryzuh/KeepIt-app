import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { enviarFoto, MAX_FOTOS, validarArquivo } from './fotos';
import type { Foto, FotoEnvio, TipoImagem } from './tipos';

export type ItemFoto =
  | { k: 'existente'; uid: string; foto: Foto }
  | {
      k: 'nova';
      uid: string;
      nome: string;
      tamanho: number;
      preview: string;
      file: File;
      tipo: TipoImagem;
      estado: 'enviando' | 'pronta' | 'erro';
      progresso: number;
      chave?: string;
      erro?: unknown;
    };

let contador = 0;
const novoUid = () => `f${++contador}`;

/**
 * Estado das fotos da tela 08: fotos já gravadas (edição) e novas enviadas direto ao S3.
 * A ordem da lista é a ordem final (a primeira é a capa).
 */
export function useFotos(iniciais: Foto[] = []) {
  const [itens, setItens] = useState<ItemFoto[]>(() => iniciais.map((foto) => ({ k: 'existente', uid: `e${foto.id}`, foto })));
  const [aviso, setAviso] = useState<unknown>(null);
  const idsIniciais = useRef(iniciais.map((f) => f.id));
  const previews = useRef(new Set<string>());
  // Fotos gravadas que o usuário tirou da lista: o upload-url desconta o tamanho delas da cota (troca com cota cheia)
  const removidasRef = useRef<number[]>([]);
  removidasRef.current = idsIniciais.current.filter((id) => !itens.some((i) => i.k === 'existente' && i.foto.id === id));

  useEffect(
    () => () => {
      previews.current.forEach((u) => URL.revokeObjectURL(u));
    },
    [],
  );

  const atualizar = useCallback((uid: string, parcial: Partial<Extract<ItemFoto, { k: 'nova' }>>) => {
    setItens((l) => l.map((i) => (i.k === 'nova' && i.uid === uid ? { ...i, ...parcial } : i)));
  }, []);

  const subir = useCallback(
    async (uid: string, file: File, tipo: TipoImagem) => {
      atualizar(uid, { estado: 'enviando', progresso: 0, erro: undefined });
      try {
        const chave = await enviarFoto(file, tipo, (progresso) => atualizar(uid, { progresso }), removidasRef.current);
        atualizar(uid, { estado: 'pronta', progresso: 100, chave });
      } catch (e) {
        atualizar(uid, { estado: 'erro', erro: e });
      }
    },
    [atualizar],
  );

  /** Valida no navegador (JPEG/PNG de verdade, até 5 MB, no máximo 3 fotos) e começa a enviar as aceitas. */
  const adicionar = useCallback(
    async (arquivos: File[]) => {
      setAviso(null);
      const vagas = MAX_FOTOS - itens.length;
      if (arquivos.length > vagas) setAviso(new ApiError(422, 'LIMITE_FOTOS', 'limite'));
      for (const file of arquivos.slice(0, Math.max(vagas, 0))) {
        const v = await validarArquivo(file);
        if (!v.ok) {
          setAviso(new ApiError(422, v.codigo, `${file.name}: inválido`));
          continue;
        }
        const preview = URL.createObjectURL(file);
        previews.current.add(preview);
        const uid = novoUid();
        setItens((l) => [...l, { k: 'nova', uid, nome: file.name, tamanho: file.size, preview, file, tipo: v.tipo, estado: 'enviando', progresso: 0 }]);
        void subir(uid, file, v.tipo);
      }
    },
    [itens.length, subir],
  );

  const remover = (uid: string) => {
    setAviso(null);
    setItens((l) => l.filter((i) => i.uid !== uid));
  };
  const reenviar = (uid: string) => {
    const i = itens.find((x) => x.uid === uid);
    if (i?.k === 'nova') void subir(uid, i.file, i.tipo);
  };
  const tornarCapa = (uid: string) => setItens((l) => [...l.filter((i) => i.uid === uid), ...l.filter((i) => i.uid !== uid)]);

  /** A API recusou a `chave` ao salvar (vencida, objeto ausente): marca as novas para reenvio. */
  const marcarNovasParaReenvio = (erro: unknown) =>
    setItens((l) => l.map((i) => (i.k === 'nova' ? { ...i, estado: 'erro' as const, chave: undefined, erro } : i)));

  const enviando = itens.some((i) => i.k === 'nova' && i.estado === 'enviando');
  const comErro = itens.some((i) => i.k === 'nova' && i.estado === 'erro');

  /** Lista final para `fotos` ao salvar. */
  const paraEnvio = (): FotoEnvio[] =>
    itens.flatMap((i): FotoEnvio[] => (i.k === 'existente' ? [{ id: i.foto.id }] : i.chave ? [{ chave: i.chave }] : []));

  /** Edição: só manda `fotos` se a lista mudou (omitir não mexe nas fotos). */
  const mudou = () => {
    const atual = itens.map((i) => (i.k === 'existente' ? i.foto.id : null));
    return atual.length !== idsIniciais.current.length || atual.some((v, n) => v !== idsIniciais.current[n]);
  };

  return { itens, aviso, enviando, comErro, adicionar, remover, reenviar, tornarCapa, marcarNovasParaReenvio, paraEnvio, mudou };
}
