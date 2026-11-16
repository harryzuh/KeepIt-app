# Contrato da API — M1 Autenticação e Conta

Referência única para Back-end e Front-end (o Front-end implementa **somente** a partir deste documento).
Complementa a Tabela 17 (`docs/05-diagramas/5.5-diagrama-operacao.md`). Decisões e justificativas: [ADR 0001](../adr/0001-base-m1.md).
Os schemas Zod de cada rota ficam em `backend/src/modules/auth/auth.schema.ts` e **devem** refletir exatamente os campos abaixo.

## 1. Convenções gerais

| Item | Regra |
|---|---|
| URL base | `VITE_API_URL` (dev: `http://localhost:3333`). Sem prefixo `/api`. |
| Formato | JSON (`Content-Type: application/json`) em requisições e respostas. Datas em ISO 8601 UTC (`"2026-11-15T17:00:00.000Z"`). Valores monetários como **string decimal** (`"19.90"`). |
| Autenticação | Cabeçalho `Authorization: Bearer <token>` nas rotas marcadas "Sim". |
| CORS | Origem liberada: `CORS_ORIGIN` (dev: `http://localhost:5173`). |
| Campos desconhecidos | Ignorados pela API (nunca use `id` de usuário/Casa vindo do corpo: o id vem sempre do token). |
| E-mail | A API faz `trim` + minúsculas antes de salvar e comparar (`Ana@X.com` = `ana@x.com`). |
| Idioma | Mensagens de `message` e `details[].mensagem` em pt-BR, mas o front **escolhe o texto exibido pelo `error`** (código fixo), nunca mostra `message` cru. |

### 1.1 Token de sessão (como o front guarda)

- Login e cadastro devolvem `token` (JWT HS256, validade **8 horas**, claim `sub` = id do usuário). Não há refresh token no MVP: ao expirar, o usuário volta à tela 02.
- O front guarda o token em **`localStorage`**, chave `keepit.token` (a sessão sobrevive ao recarregar a página, critério 1 da história 1.1). Nada de token em cookie, URL ou `sessionStorage`.
- Cliente HTTP único (`src/lib/`): injeta `Authorization: Bearer <token>` quando houver token; **lê o token do `localStorage` a cada requisição** (assim logout/login em outra aba vale na hora).
- Ao receber **401 com `error` = `NAO_AUTENTICADO` ou `SESSAO_EXPIRADA`**: apagar `keepit.token`, limpar o cache do TanStack Query e ir para a tela 02. **Cuidado:** `CREDENCIAIS_INVALIDAS` e `SENHA_INCORRETA` também são 401, mas **não** encerram a sessão (são erros de formulário).
- Logout (`POST /auth/logout`): só apague o token local **depois** do 204 (história 1.4, critério 5).
- O JWT não carrega nome, e-mail nem papel: use sempre `GET /me`.
- Troca de senha (`PATCH /me/senha`) devolve um **novo token**: substitua o guardado.

### 1.2 Formato padrão de erro

Todo erro (4xx/5xx) tem o corpo:

```json
{
  "error": "EMAIL_EM_USO",
  "message": "E-mail já cadastrado",
  "details": [{ "campo": "email", "mensagem": "E-mail inválido" }]
}
```

- `error` (string, sempre presente): **código fixo** da tabela abaixo.
- `message` (string, sempre presente): texto técnico em pt-BR, só para depuração/log.
- `details` (opcional): nos erros 422 é `[{ campo, mensagem }]`, com `campo` em notação de ponto (`email`, `novaSenha`, `confirmarSenha`); o front liga cada item ao campo do formulário. Nos demais erros normalmente ausente.

### 1.3 Códigos de erro

| HTTP | `error` | Quando | Mensagem sugerida ao usuário (front) |
|---|---|---|---|
| 400 | `REQUISICAO_INVALIDA` | JSON malformado ou grande demais | "Não foi possível processar o pedido. Tente novamente." |
| 400 | `CODIGO_INVALIDO` | Código de verificação errado, expirado, já usado ou inexistente | "Código inválido ou expirado" (+ botão Reenviar código) |
| 401 | `NAO_AUTENTICADO` | Sem token, token malformado ou assinatura inválida | encerra sessão → tela 02 |
| 401 | `SESSAO_EXPIRADA` | Token vencido, encerrado (logout/troca de senha) ou conta com exclusão solicitada | encerra sessão → tela 02 ("Sua sessão expirou. Entre novamente.") |
| 401 | `CREDENCIAIS_INVALIDAS` | Login com e-mail inexistente, senha errada ou conta com exclusão solicitada (mesma resposta) | "E-mail ou senha inválidos" |
| 401 | `SENHA_INCORRETA` | Senha atual errada em `PATCH /me/senha` e `DELETE /me` | "Senha atual incorreta" (junto ao campo) |
| 403 | `SEM_PERMISSAO` | Papel sem permissão para a ação (RNF31) | "Você não tem permissão para esta ação" |
| 404 | `CONTA_NAO_ENCONTRADA` | `POST /auth/recuperar-senha` com e-mail sem conta | "Não encontramos uma conta com este e-mail" |
| 404 | `NAO_ENCONTRADO` | Rota ou recurso inexistente (ou de outra Casa) | "Não encontrado" |
| 409 | `EMAIL_EM_USO` | E-mail já pertence a outra conta (inclui contas com exclusão solicitada) | "Este e-mail já está cadastrado" (junto ao campo) |
| 422 | `DADOS_INVALIDOS` | Falha de validação Zod; vem com `details` | mensagem por campo (`details[].mensagem`) |
| 422 | `SENHA_IGUAL_ATUAL` | Nova senha igual à atual em `PATCH /me/senha` | "A nova senha deve ser diferente da atual" |
| 429 | `MUITAS_TENTATIVAS` | Rate limit (RNF14). Cabeçalho `Retry-After` em segundos | "Muitas tentativas. Tente novamente em alguns minutos" |
| 402, 404, 409, 422 | `PAGAMENTO_RECUSADO`, `USUARIO_NAO_ENCONTRADO`, `ESTADO_INVALIDO`, `LIMITE_MEMBROS`, `COTA_EXCEDIDA`, `MEMBRO_JA_NA_CASA`, `MEMBRO_NAO_TRANSFERIVEL`, `PLANO_NAO_COMPORTA`, `AVISO_NAO_CONFIRMADO`, `METODO_PAGAMENTO_AUSENTE`, `PAGAMENTO_INDISPONIVEL` (503), `CONFLITO_CONCORRENTE` (409, impasse no banco: repetir o pedido) | Códigos do M5 e do M2 | Tabelas em [`m5-assinatura.md`](m5-assinatura.md) (seção 6) e [`m2-casa.md`](m2-casa.md) (seção 5) |
| 500 | `ERRO_INTERNO` | Falha inesperada | "Algo deu errado. Tente novamente." |
| qualquer | — | Sem resposta (rede) | Banner "Sem conexão com a internet" (RNF24) |

### 1.4 Rate limiting (RNF14)

Contagem por IP (e por e-mail quando indicado). Ao exceder: `429 MUITAS_TENTATIVAS` + `Retry-After`. Limite global de 120 requisições/minuto/IP em toda a API.

| Rota | Limite |
|---|---|
| `POST /auth/cadastro` | 10 por hora por IP |
| `POST /auth/login` | 10 **falhas** por 15 min por IP + e-mail |
| `POST /auth/recuperar-senha`, `POST /me/email` | 5 por 15 min por IP + e-mail |
| `POST /auth/redefinir-senha` | 10 **falhas** por 15 min por IP + e-mail |
| `POST /me/email/confirmar`, `PATCH /me/senha`, `DELETE /me` | 10 **falhas** por 15 min por IP |

## 2. Tipos compartilhados

```ts
type Papel = 'ADMIN' | 'EDITOR' | 'LEITOR';
type NomePlano = 'INDIVIDUAL' | 'FAMILIA' | 'BUSINESS';

/** Devolvido por login, cadastro, GET /me, PATCH /me e POST /me/email/confirmar. Nunca contém senha, hash ou código. */
interface Perfil {
  id: number;
  nome: string;
  email: string;                 // completo; o front mascara na tela 16 (RNF25)
  criadoEm: string;
  casa: { id: number; nome: string; totalMembros: number };
  papel: Papel;                  // papel do usuário nessa Casa
  plano: {                       // plano vigente da Casa
    nome: NomePlano;
    preco: string;               // "0.00" | "19.90" | "49.90"
    limiteMembros: number;
    limiteArmazenamentoGb: number;
  };
  /** Assinatura vigente da Casa; null no plano Individual (ADR 0002, D10). Só ATIVA e CANCELADA aparecem. */
  assinatura: { status: 'ATIVA' | 'CANCELADA'; dataRenovacao: string } | null;
  /** Aditivo (Sprint 3, RF39): uso de armazenamento da Casa, para todos os papéis (tela 08). `usadoBytes` soma o tamanho das fotos gravadas (já recodificadas pela API); `limiteBytes` = `plano.limiteArmazenamentoGb` × 1024³. Detalhes em m3-produtos.md, seção 1. */
  uso: { armazenamento: { usadoBytes: number; limiteBytes: number } };
}

interface ErroApi { error: string; message: string; details?: { campo: string; mensagem: string }[] }
```

Regra do `plano`: plano da assinatura da Casa com status `ATIVA`, ou `CANCELADA` com `dataRenovacao` ainda no futuro; sem assinatura vigente (ou CANCELADA já vencida), é o plano `INDIVIDUAL` (por isso o cadastro não cria `Assinatura`). Como `plano`, `assinatura`, `casa` e `papel` mudam com a assinatura e com as operações de Casa: `m5-assinatura.md` (seção 5) e `m2-casa.md` (seção 6).
O aviso do UC013 (tela 21) aparece quando `papel === 'ADMIN' && (assinatura !== null || casa.totalMembros > 1)`.

## 3. Rotas

Legenda de auth: **Não** = visitante; **Sim** = exige `Authorization: Bearer`. Em toda rota "Sim" valem também `401 NAO_AUTENTICADO` e `401 SESSAO_EXPIRADA`; em toda rota vale o limite global (`429`) e `500 ERRO_INTERNO`. Papéis: **todas as rotas de `/me` e `/auth/logout` valem para ADMIN, EDITOR e LEITOR**.

| # | Método e caminho | Auth | Resumo | História |
|---|---|---|---|---|
| 1 | `POST /auth/cadastro` | Não | Cria usuário + Casa + vínculo ADMIN | 1.2 |
| 2 | `POST /auth/login` | Não | Entra com e-mail e senha | 1.1 |
| 3 | `POST /auth/recuperar-senha` | Não | Envia código de 6 dígitos por e-mail | 1.3 |
| 4 | `POST /auth/redefinir-senha` | Não | Troca a senha com o código | 1.3 |
| 5 | `POST /auth/logout` | Sim | Encerra a sessão | 1.4 |
| 6 | `GET /me` | Sim | Perfil do usuário logado | 1.0, 8.1 |
| 7 | `PATCH /me` | Sim | Edita o nome | 8.1 |
| 8 | `POST /me/email` | Sim | Pede troca de e-mail (código vai ao novo e-mail) | 8.2 |
| 9 | `POST /me/email/confirmar` | Sim | Confirma a troca com o código | 8.2 |
| 10 | `PATCH /me/senha` | Sim | Altera a senha (informando a atual) | 1.5 |
| 11 | `DELETE /me` | Sim | Solicita exclusão da conta | 8.3 |
| 12 | `POST /internal/jobs` | Chave interna | Rotinas agendadas (não usada pelo front) | 8.3.2 |

### 3.1 `POST /auth/cadastro` (UC008, RF02, RF32)

Corpo:

| Campo | Tipo | Regras |
|---|---|---|
| `nome` | string | obrigatório, `trim`, 1 a 80 caracteres |
| `email` | string | obrigatório, formato válido, até 120, normalizado |
| `senha` | string | 8 a 72 caracteres (RNF15) |
| `confirmarSenha` | string | igual a `senha` (erro em `confirmarSenha`: "As senhas não conferem") |

Respostas:

- **201** `{ "token": string, "usuario": Perfil }`. A Casa criada se chama `"Casa de <primeiro nome>"`, `papel = "ADMIN"`, `plano.nome = "INDIVIDUAL"`, `casa.totalMembros = 1`. Usuário, Casa e vínculo são gravados em **uma transação**.
- **409** `EMAIL_EM_USO`; **422** `DADOS_INVALIDOS`; **429** `MUITAS_TENTATIVAS`.

### 3.2 `POST /auth/login` (UC004, UC005, RF01)

Corpo: `{ "email": string (formato válido), "senha": string (1 a 72, sem exigir mínimo) }`.

- **200** `{ "token": string, "usuario": Perfil }`.
- **401** `CREDENCIAIS_INVALIDAS` — **mesma resposta** para e-mail inexistente, senha errada e conta com exclusão solicitada.
- **422** `DADOS_INVALIDOS`; **429** `MUITAS_TENTATIVAS`.

### 3.3 `POST /auth/recuperar-senha` (UC006, RF17)

Corpo: `{ "email": string }`.

- **200** `{ "expiraEm": string }` — código de 6 dígitos gerado e enviado por e-mail (Mailpit em dev, `http://localhost:8025`). Vale 15 minutos, uso único. Códigos anteriores ainda não usados do usuário deixam de valer. Também serve para **Reenviar código**.
- **404** `CONTA_NAO_ENCONTRADA` (também para conta com exclusão solicitada). Risco de enumeração de contas aceito pelo UC006 e mitigado por rate limit (sinalizado ao AppSec).
- **422**; **429**.

### 3.4 `POST /auth/redefinir-senha` (UC007, UC009, RF17)

Corpo: `{ "email": string, "codigo": string (exatamente 6 dígitos), "novaSenha": string (8 a 72), "confirmarSenha": string (igual) }`.

- **204** sem corpo. Senha trocada (novo hash), código marcado como usado e **todas as sessões do usuário encerradas**. **Não faz login**: o front vai à tela 02 com "Senha alterada. Entre com a nova senha".
- **400** `CODIGO_INVALIDO` — código errado, expirado, já usado, ou e-mail sem conta (mesma resposta, sem enumeração). A senha não muda.
- **422**; **429**.
- Não existe endpoint de pré-validação do código: a tela 04 (etapa 2) guarda e-mail e código **em memória** e a tela 18 envia tudo aqui. Com `CODIGO_INVALIDO`, o front volta à etapa do código e oferece Reenviar.

### 3.5 `POST /auth/logout` (UC012, RF21)

Sem corpo.

- **204**. Encerra a sessão: o token usado (e qualquer outro emitido antes deste instante, inclusive em outros dispositivos) deixa de valer. Registra `SESSAO_ENCERRADA` no log.
- **401** `NAO_AUTENTICADO` / `SESSAO_EXPIRADA`.

### 3.6 `GET /me`

- **200** `Perfil` (alimenta telas 05, 16 e 20).
- **401**.

### 3.7 `PATCH /me` (UC015 nome, RF18)

Corpo: `{ "nome": string }` — `trim`, 1 a 80 caracteres. (O e-mail **não** é alterado aqui: ver 3.8 e 3.9.)

- **200** `Perfil` atualizado.
- **422**; **401**.

### 3.8 `POST /me/email` (UC015, RF19) — passo 1 da troca de e-mail

Corpo: `{ "email": string, "senhaAtual": string }` (novo e-mail: formato válido, até 120, normalizado). A `senhaAtual` é obrigatória: um token roubado sozinho não basta para trocar o e-mail (AppSec ACH-01).

Ordem de verificação: validação (422) → senha atual (401) → e-mail diferente do atual (422) → e-mail livre (409).

- **200** `{ "expiraEm": string }` — código de 6 dígitos enviado **ao novo e-mail**, válido por 15 min e com até 5 tentativas. O e-mail **antigo** recebe um aviso de que a troca foi pedida. O e-mail atual continua valendo. Pedidos anteriores pendentes deixam de valer. Serve também para Reenviar (o front reenvia a mesma `senhaAtual`, guardada só em memória).
- **401** `SENHA_INCORRETA` — **não** encerra a sessão no front; o erro aparece no campo Senha atual.
- **409** `EMAIL_EM_USO` — já usado por outra conta; nenhum código é enviado.
- **422** `DADOS_INVALIDOS` — formato inválido ou igual ao e-mail atual (`details[0].campo = "email"`).
- **429**; **401**.

### 3.9 `POST /me/email/confirmar` (UC015, RF19) — passo 2

Corpo: `{ "codigo": string (6 dígitos) }`.

- **200** `Perfil & { "token": string }` — perfil com o novo e-mail e um **token novo**. Todas as outras sessões (inclusive a do token antigo) são encerradas; o front substitui o token guardado. O e-mail antigo recebe o aviso de troca concluída. O próximo login exige o novo e-mail.
- **400** `CODIGO_INVALIDO` — código errado/expirado/usado, sem pedido pendente ou com as 5 tentativas esgotadas (é preciso pedir outro); o e-mail não muda.
- **409** `EMAIL_EM_USO` — outra conta confirmou o mesmo e-mail antes (unicidade garantida pelo banco).
- **422**; **429**; **401**.

### 3.10 `PATCH /me/senha` (UC010, UC011, RF31)

Corpo: `{ "senhaAtual": string, "novaSenha": string (8 a 72), "confirmarSenha": string (igual) }`.

Ordem de verificação: validação (422) → senha atual (401) → nova diferente da atual (422).

- **200** `{ "token": string }` — **novo token**; a sessão atual continua e as demais (outros dispositivos) são encerradas. O front substitui o token guardado, mostra sucesso e volta à tela 16.
- **401** `SENHA_INCORRETA` (**não** encerra a sessão no front).
- **422** `DADOS_INVALIDOS` ou `SENHA_IGUAL_ATUAL`; **429**.

### 3.11 `DELETE /me` (UC013, UC014, RF20)

Corpo: `{ "senha": string }` (DELETE com corpo JSON; envie `Content-Type: application/json`).

- **204**. Conta passa a EXCLUSÃO SOLICITADA (`exclusaoSolicitadaEm = agora`), todas as sessões são encerradas, evento registrado no log de auditoria; os dados pessoais são apagados em até 24 h pela rotina (história 8.3.2): ela roda de hora em hora e apaga as contas com pedido feito há mais de 23 h. O front apaga o token, limpa o cache e vai à tela 01 com a mensagem de pedido registrado.
- **401** `SENHA_INCORRETA` (**não** encerra a sessão no front; a conta permanece ativa).
- **422**; **429**.
- Efeitos sobre assinatura e demais membros (Sprint 2, história 6.6): a assinatura do titular vira EXPIRADA na hora; ADMIN com outros membros passa a Casa ao membro mais antigo (preferindo EDITOR) e os demais recebem Casa própria; EDITOR e LEITOR saem da Casa no pedido. Requisição e resposta não mudam. Tabela de efeitos em [`m2-casa.md`](m2-casa.md), seção 7, e ADR 0002 (D3 e D8).

### 3.12 `POST /internal/jobs`

Cabeçalho `x-jobs-token: <JOBS_TOKEN>`. **200** `{ "expiradas": number, "renovadas": number, "apagadas": number, "falhas": number, "fotosOrfasApagadas": number, "fotosOrfasPendentes": number }` (`fotosOrfasApagadas` e `fotosOrfasPendentes` desde a Sprint 3, ver [`m3-produtos.md`](m3-produtos.md): `fotosOrfasApagadas` = objetos órfãos do S3 apagados nesta execução; `fotosOrfasPendentes` = órfãos vencidos que a conciliação ainda não conseguiu apagar, esperado 0, retomados na execução seguinte; a partir da Sprint 2, história 7.5; detalhes em [`m5-assinatura.md`](m5-assinatura.md), 3.8); **401** `NAO_AUTENTICADO` sem chave ou com chave errada (token de usuário não vale aqui; comparação em tempo constante). O alias antigo `POST /jobs/run` foi removido; o workflow `.github/workflows/jobs.yml` já usa `/internal/jobs`. Não é chamada pelo front.

## 4. Matriz de permissões do M1

| Rota | Visitante | LEITOR | EDITOR | ADMIN |
|---|---|---|---|---|
| `/auth/cadastro`, `/auth/login`, `/auth/recuperar-senha`, `/auth/redefinir-senha` | permitido | permitido* | permitido* | permitido* |
| `/auth/logout`, `GET/PATCH/DELETE /me`, `/me/email`, `/me/email/confirmar`, `/me/senha` | 401 | permitido | permitido | permitido |
| `/internal/jobs` | 401 (só chave interna) | 401 | 401 | 401 |

\* O guarda de rota do **front** redireciona usuário já logado para a tela 05; a API não bloqueia.

## 5. Fluxos de tela → chamadas

| Fluxo | Chamadas |
|---|---|
| 03 Criar conta → 05 | `POST /auth/cadastro` → guarda `token` → vai a 05 |
| 02 Entrar → 05 | `POST /auth/login` → guarda `token` → 05 |
| Abertura do app com token | `GET /me`; 401 → tela 02 |
| 04 etapa 1 → etapa 2 | `POST /auth/recuperar-senha` |
| 04 etapa 2 → 18 → 02 | (nada na API) → `POST /auth/redefinir-senha` (204) → 02 |
| 16 Conta → Encerrar sessão | `POST /auth/logout` (204) → apaga token → 01 |
| 20 Dados cadastrais (nome) | `PATCH /me` |
| 20 Dados cadastrais (e-mail) | `POST /me/email` → `POST /me/email/confirmar` |
| 19 Alterar senha → 16 | `PATCH /me/senha` → substitui `token` |
| 21 Excluir conta → 01 | `DELETE /me` (204) → apaga token → 01 |
