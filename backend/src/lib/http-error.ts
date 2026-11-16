/**
 * Códigos de erro fixos da API (contratos em docs/api/m1-auth.md, m5-assinatura.md e m2-casa.md).
 * O front-end escolhe a mensagem exibida pelo código, nunca pelo texto técnico.
 */
export const CODIGOS_ERRO = {
  REQUISICAO_INVALIDA: 'REQUISICAO_INVALIDA',
  DADOS_INVALIDOS: 'DADOS_INVALIDOS',
  NAO_AUTENTICADO: 'NAO_AUTENTICADO',
  SESSAO_EXPIRADA: 'SESSAO_EXPIRADA',
  CREDENCIAIS_INVALIDAS: 'CREDENCIAIS_INVALIDAS',
  SENHA_INCORRETA: 'SENHA_INCORRETA',
  SENHA_IGUAL_ATUAL: 'SENHA_IGUAL_ATUAL',
  CODIGO_INVALIDO: 'CODIGO_INVALIDO',
  SEM_PERMISSAO: 'SEM_PERMISSAO',
  CONTA_NAO_ENCONTRADA: 'CONTA_NAO_ENCONTRADA',
  NAO_ENCONTRADO: 'NAO_ENCONTRADO',
  EMAIL_EM_USO: 'EMAIL_EM_USO',
  MUITAS_TENTATIVAS: 'MUITAS_TENTATIVAS',
  // M5 / M2 (ADR 0002, contratos m5-assinatura.md e m2-casa.md)
  PAGAMENTO_RECUSADO: 'PAGAMENTO_RECUSADO',
  METODO_PAGAMENTO_AUSENTE: 'METODO_PAGAMENTO_AUSENTE',
  PLANO_NAO_COMPORTA: 'PLANO_NAO_COMPORTA',
  AVISO_NAO_CONFIRMADO: 'AVISO_NAO_CONFIRMADO',
  ESTADO_INVALIDO: 'ESTADO_INVALIDO',
  LIMITE_MEMBROS: 'LIMITE_MEMBROS',
  COTA_EXCEDIDA: 'COTA_EXCEDIDA',
  MEMBRO_JA_NA_CASA: 'MEMBRO_JA_NA_CASA',
  MEMBRO_NAO_TRANSFERIVEL: 'MEMBRO_NAO_TRANSFERIVEL',
  USUARIO_NAO_ENCONTRADO: 'USUARIO_NAO_ENCONTRADO',
  PAGAMENTO_INDISPONIVEL: 'PAGAMENTO_INDISPONIVEL',
  CONFLITO_CONCORRENTE: 'CONFLITO_CONCORRENTE',
  // M3 (ADR 0003, contrato m3-produtos.md)
  PRODUTO_DUPLICADO: 'PRODUTO_DUPLICADO',
  TAG_EXISTENTE: 'TAG_EXISTENTE',
  ARQUIVO_INVALIDO: 'ARQUIVO_INVALIDO',
  LIMITE_FOTOS: 'LIMITE_FOTOS',
  // M4 (ADR 0004)
  ESTATISTICAS_INDISPONIVEL: 'ESTATISTICAS_INDISPONIVEL',
  ERRO_INTERNO: 'ERRO_INTERNO',
} as const;

export type CodigoErro = (typeof CODIGOS_ERRO)[keyof typeof CODIGOS_ERRO];

/** Detalhe de campo inválido devolvido em `details` nos erros 422. */
export interface DetalheCampo {
  campo: string;
  mensagem: string;
}

/**
 * Erro de negócio/HTTP. O errorHandler o converte em
 * `{ error: <codigo>, message: <mensagem em pt-BR>, details? }`.
 * Os services lançam HttpError sem conhecer Express (apenas status e código).
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly codigo: CodigoErro,
    mensagem?: string,
    public readonly details?: unknown,
  ) {
    super(mensagem ?? codigo);
    this.name = 'HttpError';
  }
}
