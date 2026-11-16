import { registrarFalhaDeRede } from './conexao';
import { sessao } from './sessao';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3333';

export interface DetalheCampo {
  campo: string;
  mensagem: string;
}

/** Erro padronizado da API (`{ error, message, details? }`) ou falha de rede (status 0). */
export class ApiError extends Error {
  constructor(
    public status: number,
    public codigo: string,
    mensagem: string,
    public details: DetalheCampo[] = [],
    public retryAfter?: number,
    /** `details` que não é lista de campos (ex.: 409 PRODUTO_DUPLICADO, TAG_EXISTENTE, COTA_EXCEDIDA). */
    public extra?: unknown,
  ) {
    super(mensagem);
    this.name = 'ApiError';
  }
}

const CODIGOS_QUE_ENCERRAM_SESSAO = ['NAO_AUTENTICADO', 'SESSAO_EXPIRADA'];

interface Opcoes {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
}

/** Único ponto de acesso HTTP do front. Componentes usam os hooks de cada feature. */
export async function api<T>(caminho: string, { method = 'GET', body }: Opcoes = {}): Promise<T> {
  const token = sessao.obterToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${caminho}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    registrarFalhaDeRede(true);
    throw new ApiError(0, 'SEM_CONEXAO', 'Sem conexão com a internet');
  }
  registrarFalhaDeRede(false);

  if (!res.ok) {
    const corpo = (await res.json().catch(() => null)) as {
      error?: string;
      message?: string;
      details?: DetalheCampo[] | Record<string, unknown>;
    } | null;
    const codigo = corpo?.error ?? 'ERRO_INTERNO';
    const retry = Number(res.headers.get('Retry-After'));
    // 401 de sessão encerra; CREDENCIAIS_INVALIDAS / SENHA_INCORRETA são erros de formulário.
    if (res.status === 401 && token && CODIGOS_QUE_ENCERRAM_SESSAO.includes(codigo)) {
      sessao.encerrar({ destino: '/entrar', aviso: 'Sua sessão expirou. Entre novamente.' });
    }
    // `details` segue cru (o M5 lê objetos nele); `extra` expõe com tipo o que não é lista de campos.
    const extra = corpo?.details && !Array.isArray(corpo.details) ? corpo.details : undefined;
    throw new ApiError(res.status, codigo, corpo?.message ?? res.statusText, (corpo?.details ?? []) as DetalheCampo[], retry || undefined, extra);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}
