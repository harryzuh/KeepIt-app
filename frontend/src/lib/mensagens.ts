import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from './api';

/** Texto exibido ao usuário por código de erro (o `message` da API nunca é mostrado). */
const MENSAGENS: Record<string, string> = {
  SEM_CONEXAO: 'Sem conexão com a internet. Verifique sua rede e tente novamente.',
  REQUISICAO_INVALIDA: 'Não foi possível processar o pedido. Tente novamente.',
  CODIGO_INVALIDO: 'Código inválido ou expirado',
  NAO_AUTENTICADO: 'Sua sessão expirou. Entre novamente.',
  SESSAO_EXPIRADA: 'Sua sessão expirou. Entre novamente.',
  CREDENCIAIS_INVALIDAS: 'E-mail ou senha inválidos',
  SENHA_INCORRETA: 'Senha atual incorreta',
  SEM_PERMISSAO: 'Você não tem permissão para esta ação',
  CONTA_NAO_ENCONTRADA: 'Não encontramos uma conta com este e-mail',
  NAO_ENCONTRADO: 'Não encontrado',
  EMAIL_EM_USO: 'Este e-mail já está cadastrado',
  DADOS_INVALIDOS: 'Confira os dados informados',
  SENHA_IGUAL_ATUAL: 'A nova senha deve ser diferente da atual',
  MUITAS_TENTATIVAS: 'Muitas tentativas. Tente novamente em alguns minutos',
  PAGAMENTO_RECUSADO: 'Pagamento recusado. Tente outro cartão.',
  PAGAMENTO_INDISPONIVEL: 'Pagamento indisponível no momento. Tente novamente mais tarde.',
  CONFLITO_CONCORRENTE: 'Outra alteração aconteceu ao mesmo tempo. Tente de novo.',
  ESTADO_INVALIDO: 'Esta ação não está disponível agora.',
  AVISO_NAO_CONFIRMADO: 'Confirme que você vai sair da Casa atual.',
  METODO_PAGAMENTO_AUSENTE: 'Adicione um cartão para continuar.',
  PLANO_NAO_COMPORTA: 'Os membros ou o armazenamento atuais da Casa não cabem neste plano.',
  USUARIO_NAO_ENCONTRADO: 'A pessoa precisa ter uma conta KeepIT',
  LIMITE_MEMBROS: 'Sua Casa atingiu o limite de membros do plano.',
  MEMBRO_JA_NA_CASA: 'Esta pessoa já faz parte da sua Casa',
  MEMBRO_NAO_TRANSFERIVEL: 'Esta pessoa não pode ser adicionada agora.',
  PRODUTO_DUPLICADO: 'Já existe um produto com este nome na Casa.',
  COTA_EXCEDIDA: 'Espaço do plano esgotado.',
  TAG_EXISTENTE: 'Essa tag já existe.',
  ARQUIVO_INVALIDO: 'Use imagem JPEG ou PNG de até 5 MB.',
  LIMITE_FOTOS: 'Um produto aceita até 3 fotos.',
  FOTOS_ENVIANDO: 'Aguarde o envio das fotos terminar.',
  FOTOS_COM_ERRO: 'Reenvie ou remova as fotos que falharam antes de salvar.',
  ENVIO_FOTO_FALHOU: 'Não foi possível enviar a foto. Tente novamente.',
  ESTATISTICAS_INDISPONIVEL: 'As estatísticas estão indisponíveis no momento. Tente de novo em instantes.',
  ERRO_INTERNO: 'Algo deu errado. Tente novamente.',
};

export const mensagemPorCodigo = (codigo: string) => MENSAGENS[codigo] ?? MENSAGENS.ERRO_INTERNO;

export function mensagemDeErro(erro: unknown): string {
  if (erro instanceof ApiError) return MENSAGENS[erro.codigo] ?? MENSAGENS.ERRO_INTERNO;
  return MENSAGENS.ERRO_INTERNO;
}

/**
 * Liga os `details` de um 422 (e o 409 EMAIL_EM_USO) aos campos do formulário.
 * Devolve true se algum erro foi ligado a um campo.
 */
export function aplicarErrosDeCampo<T extends FieldValues>(
  erro: unknown,
  setError: UseFormSetError<T>,
  campoEmail?: Path<T>,
): boolean {
  if (!(erro instanceof ApiError)) return false;
  if (erro.codigo === 'EMAIL_EM_USO' && campoEmail) {
    setError(campoEmail, { type: 'server', message: MENSAGENS.EMAIL_EM_USO });
    return true;
  }
  if (erro.codigo === 'DADOS_INVALIDOS' && erro.details.length > 0) {
    for (const d of erro.details) setError(d.campo as Path<T>, { type: 'server', message: d.mensagem });
    return true;
  }
  return false;
}

/** Erros que viram mensagem junto ao campo (não aparecem no alerta geral). */
export const ehErroDeCampo = (erro: unknown) =>
  erro instanceof ApiError && (erro.codigo === 'DADOS_INVALIDOS' || erro.codigo === 'EMAIL_EM_USO');
