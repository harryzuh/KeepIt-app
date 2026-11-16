import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useUsuarioAtual } from '@/features/auth/hooks';
import { ApiError } from '@/lib/api';
import { aplicarErrosDeCampo, ehErroDeCampo } from '@/lib/mensagens';
import { DuplicadoModal } from './DuplicadoModal';
import { AvisoProdutosFicam } from './AvisoProdutosFicam';
import { ErroComLink } from './ErroComLink';
import { FotosEditor } from './FotosEditor';
import { useFotos } from './useFotos';
import { useCriarProduto, useEditarProduto } from './hooks';
import { produtoFormSchema, type ProdutoForm } from './schemas';
import { TagSeletor } from './TagSeletor';
import type { DetalhesDuplicado, EscolhaDuplicado, NovoProduto, ProdutoDetalhe, RespostaCriar } from './tipos';
import { hojeIso, precoParaApi, precoParaCampo } from './util';

function corpoDoForm(v: ProdutoForm): NovoProduto {
  return {
    nome: v.nome.trim(),
    ...(v.descricao.trim() ? { descricao: v.descricao.trim() } : {}),
    preco: precoParaApi(v.preco) ?? v.preco,
    quantidade: Number(v.quantidade),
    dataCompra: v.dataCompra,
    tagIds: v.tagIds,
  };
}

/**
 * Tela 08 — Adicionar/Editar produto (UC020 a UC022, UC025; RF03 a RF08) com fotos por URL assinada (RF05, RF39).
 * O cadastro trata o 409 PRODUTO_DUPLICADO abrindo a tela 09 e reenviando o mesmo corpo com a escolha.
 */
export function ProdutoFormulario({ produto }: { produto?: ProdutoDetalhe }) {
  const navigate = useNavigate();
  const { data: usuario } = useUsuarioAtual();
  const criar = useCriarProduto();
  const fotos = useFotos(produto?.fotos);
  const editar = useEditarProduto();
  const [duplicado, setDuplicado] = useState<{ detalhes: DetalhesDuplicado; corpo: NovoProduto } | null>(null);
  const [escolhendo, setEscolhendo] = useState<EscolhaDuplicado | null>(null);
  const [erroModal, setErroModal] = useState<unknown>(null);
  const [erroGeral, setErroGeral] = useState<unknown>(null);

  const { register, handleSubmit, control, setError, formState, watch } = useForm<ProdutoForm>({
    resolver: zodResolver(produtoFormSchema),
    mode: 'onTouched',
    defaultValues: {
      nome: produto?.nome ?? '',
      descricao: produto?.descricao ?? '',
      preco: produto ? precoParaCampo(produto.preco) : '',
      quantidade: produto ? String(produto.quantidade) : '1',
      dataCompra: produto?.dataCompra ?? hojeIso(),
      tagIds: produto?.tags.map((t) => t.id) ?? [],
    },
  });
  const { errors } = formState;
  const ocupado = criar.isPending || editar.isPending;
  const nomeAtual = watch('nome');

  const concluir = (r: RespostaCriar) => {
    const aviso =
      r.resultado === 'QUANTIDADE_SOMADA'
        ? `Quantidade somada: agora são ${r.produto.quantidade} unidades.`
        : 'Produto cadastrado.';
    navigate(`/produtos/${r.produto.id}`, { replace: true, state: { aviso } });
  };

  function enviarCadastro(corpo: NovoProduto, escolha?: EscolhaDuplicado, existenteId?: number) {
    const envio: NovoProduto = escolha ? { ...corpo, duplicado: escolha, ...(escolha === 'SOMAR' ? { duplicadoId: existenteId } : {}) } : corpo;
    criar.mutate(envio, {
      onSuccess: (r) => {
        // SOMAR com o original excluído no meio do caminho: a API cadastra como novo
        if (escolha === 'SOMAR' && r.resultado === 'CRIADO') {
          navigate(`/produtos/${r.produto.id}`, {
            replace: true,
            state: { aviso: 'O produto original não existe mais; cadastramos como novo.' },
          });
        } else concluir(r);
      },
      onError: (e) => {
        setEscolhendo(null);
        if (e instanceof ApiError && e.codigo === 'ARQUIVO_INVALIDO') {
          // Chave vencida (2 h) ou objeto inválido: as fotos novas precisam ser reenviadas
          fotos.marcarNovasParaReenvio(e);
          setDuplicado(null);
          setErroGeral(e);
        } else if (e instanceof ApiError && e.codigo === 'PRODUTO_DUPLICADO' && e.extra) {
          // Também cobre o caso do duplicado ter mudado entre a abertura do modal e a escolha: mostra o atual
          setErroModal(null);
          setDuplicado({ detalhes: e.extra as DetalhesDuplicado, corpo });
        } else if (duplicado) setErroModal(e);
        else if (!aplicarErrosDeCampo(e, setError)) setErroGeral(e);
      },
    });
  }

  function aoEnviar(v: ProdutoForm) {
    setErroGeral(null);
    if (fotos.enviando) return setErroGeral(new ApiError(0, 'FOTOS_ENVIANDO', 'Aguarde'));
    if (fotos.comErro) return setErroGeral(new ApiError(0, 'FOTOS_COM_ERRO', 'Remova'));
    const envio = fotos.paraEnvio();
    if (!produto) return enviarCadastro({ ...corpoDoForm(v), ...(envio.length ? { fotos: envio } : {}) });
    const c = corpoDoForm(v);
    editar.mutate(
      { id: produto.id, ...c, descricao: c.descricao ?? null, ...(fotos.mudou() ? { fotos: envio } : {}) },
      {
        onSuccess: (p) => navigate(`/produtos/${p.id}`, { replace: true, state: { aviso: 'Alterações salvas.' } }),
        onError: (e) => {
          if (e instanceof ApiError && e.codigo === 'ARQUIVO_INVALIDO') fotos.marcarNovasParaReenvio(e);
          if (!aplicarErrosDeCampo(e, setError)) setErroGeral(e);
        },
      },
    );
  }

  const erroSoNoAlerta = erroGeral != null && !ehErroDeCampo(erroGeral);
  return (
    <>
      <form onSubmit={handleSubmit(aoEnviar)} noValidate className="flex flex-col gap-4">
        {usuario?.papel === 'EDITOR' && !produto && <AvisoProdutosFicam />}
        {erroSoNoAlerta && (
          <Alert tipo="erro">
            <ErroComLink erro={erroGeral} />
          </Alert>
        )}
        <Input label="Nome do produto" maxLength={120} autoComplete="off" erro={errors.nome?.message} {...register('nome')} />
        <div>
          <label htmlFor="descricao" className="mb-1.5 block text-sm font-medium">
            Descrição (opcional)
          </label>
          <textarea
            id="descricao"
            rows={3}
            maxLength={1000}
            aria-invalid={errors.descricao ? true : undefined}
            aria-describedby={errors.descricao ? 'descricao-erro' : undefined}
            className="w-full rounded-campo border border-borda bg-white px-3.5 py-3 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            {...register('descricao')}
          />
          {errors.descricao && (
            <p id="descricao-erro" role="alert" className="mt-1.5 text-sm text-erro">
              {errors.descricao.message}
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Preço (R$)" inputMode="decimal" placeholder="0,00" erro={errors.preco?.message} {...register('preco')} />
          <Input label="Quantidade" inputMode="numeric" erro={errors.quantidade?.message} {...register('quantidade')} />
        </div>
        <Input label="Data da compra" type="date" max={hojeIso()} erro={errors.dataCompra?.message} {...register('dataCompra')} />
        <FotosEditor fotos={fotos} nome={nomeAtual} />
        <Controller
          control={control}
          name="tagIds"
          render={({ field }) => <TagSeletor valor={field.value} aoMudar={field.onChange} erro={errors.tagIds?.message} />}
        />
        <Button type="submit" disabled={fotos.enviando} carregando={ocupado && !duplicado}>
          {produto ? 'Salvar alterações' : 'Salvar produto'}
        </Button>
        {fotos.enviando && <p className="text-center text-xs text-suave">Aguarde o envio das fotos para salvar.</p>}
        <Link
          to={produto ? `/produtos/${produto.id}` : '/produtos'}
          className="flex min-h-12 w-full items-center justify-center rounded-campo font-semibold text-suave hover:text-texto"
        >
          Cancelar
        </Link>
      </form>

      {duplicado && (
        <DuplicadoModal
          duplicado={duplicado.detalhes}
          enviando={escolhendo}
          erro={erroModal}
          aoCancelar={() => {
            setDuplicado(null);
            setErroModal(null);
          }}
          aoEscolher={(escolha) => {
            setEscolhendo(escolha);
            setErroModal(null);
            enviarCadastro(duplicado.corpo, escolha, duplicado.detalhes.existente.id);
          }}
        />
      )}
    </>
  );
}
