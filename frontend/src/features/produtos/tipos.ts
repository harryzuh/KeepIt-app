// Tipos do contrato docs/api/m3-produtos.md (seção 2)
export type TipoImagem = 'JPEG' | 'PNG';

export interface Tag {
  id: number;
  nome: string;
}

export interface TagComContagem extends Tag {
  quantidadeProdutos: number;
}

export interface FotoLeitura {
  url: string;
  expiraEm: string;
}

export interface Foto extends FotoLeitura {
  id: number;
  ordem: number;
  tipo: TipoImagem;
  tamanhoBytes: number;
}

export interface ProdutoResumo {
  id: number;
  nome: string;
  preco: string;
  quantidade: number;
  dataCompra: string;
  dataCadastro: string;
  tags: Tag[];
  fotoCapa: FotoLeitura | null;
  adicionadoPor: { id: number; nome: string } | null;
}

export interface ProdutoDetalhe extends Omit<ProdutoResumo, 'fotoCapa'> {
  descricao: string | null;
  fotos: Foto[];
  atualizadoEm: string;
}

export interface Pagina<T> {
  itens: T[];
  pagina: number;
  limite: number;
  total: number;
  totalPaginas: number;
}

export type OrdemProdutos = 'recentes' | 'nome';

export interface ConsultaProdutos {
  busca?: string;
  tagId?: number;
  pagina?: number;
  limite?: number;
  ordem?: OrdemProdutos;
}

export type EscolhaDuplicado = 'SOMAR' | 'CADASTRAR_MESMO_ASSIM';

/** Item de `fotos` ao salvar: foto já gravada (`id`, só na edição) ou foto nova enviada ao S3 (`chave`). */
export type FotoEnvio = { id: number } | { chave: string };

/** Corpo de POST /upload-url e resposta (contrato 3.3). */
export interface PedidoUploadUrl {
  tipo: 'image/jpeg' | 'image/png';
  tamanhoBytes: number;
  /** Fotos já gravadas que serão removidas na troca (desconta a cota no aviso antecipado). */
  substituiFotoIds?: number[];
}
export interface RespostaUploadUrl {
  chave: string;
  url: string;
  metodo: 'PUT';
  cabecalhos: Record<string, string>;
  expiraEm: string;
  confirmarAte: string;
}

/** Corpo de POST /produtos. */
export interface NovoProduto {
  nome: string;
  descricao?: string;
  preco: string;
  quantidade: number;
  dataCompra: string;
  tagIds?: number[];
  fotos?: FotoEnvio[];
  duplicado?: EscolhaDuplicado;
  duplicadoId?: number;
}

/** Corpo de PATCH /produtos/:id (qualquer subconjunto). */
export type AlteracaoProduto = Partial<Omit<NovoProduto, 'descricao' | 'duplicado' | 'duplicadoId'>> & { descricao?: string | null };

export interface RespostaCriar {
  resultado: 'CRIADO' | 'QUANTIDADE_SOMADA';
  produto: ProdutoDetalhe;
}

/** `details` do 409 PRODUTO_DUPLICADO. */
export interface DetalhesDuplicado {
  existente: { id: number; nome: string; preco: string; quantidade: number; dataCompra: string; fotoCapaId: number | null };
  quantidadeInformada: number;
  opcoes: ('SOMAR' | 'CADASTRAR_MESMO_ASSIM' | 'CANCELAR')[];
}

export interface DetalhesCriado {
  nome: string;
  preco: string;
  quantidade: number;
  tags: string[];
  fotos: number;
}

export interface DetalhesAlterado {
  alteracoes: {
    nome?: { de: string; para: string };
    descricao?: { de: string | null; para: string | null };
    preco?: { de: string; para: string };
    quantidade?: { de: number; para: number };
    dataCompra?: { de: string; para: string };
    tags?: { adicionadas: string[]; removidas: string[] };
    fotos?: { adicionadas: number; removidas: number };
  };
}

export interface DetalhesSomada {
  anterior: number;
  somada: number;
  final: number;
}

export type EventoHistorico = { id: string; criadoEm: string; autor: { nome: string } | null } & (
  | { tipo: 'CRIADO'; detalhes: DetalhesCriado }
  | { tipo: 'ALTERADO'; detalhes: DetalhesAlterado }
  | { tipo: 'QUANTIDADE_SOMADA'; detalhes: DetalhesSomada }
);
