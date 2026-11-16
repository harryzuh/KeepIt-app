# QA — Sprint 1 (Fundação + M1 Autenticação e Conta)

Data: 2026-11-15. Ambiente: Docker (`make up`), API em `localhost:3333`, front em `localhost:5173`, Mailpit em `localhost:8025`.
Escopo: telas 01, 02, 03, 04, 16, 18, 19, 20, 21; UC001 a UC015; histórias 1.0 a 8.3.2. Nenhum código de produção foi alterado.

**Veredito: REPROVADO** (1 defeito de severidade alta confirmado, ver D1; os demais são média/baixa).

## 1. `make check`

| Etapa | Resultado |
|---|---|
| lint backend e frontend | passa |
| typecheck backend e frontend | passa |
| testes backend (Vitest) | 87 de 87 passam (5 arquivos) |
| testes frontend (Vitest) | 16 de 16 passam (5 arquivos) |

Sem falhas.

## 2. E2E Playwright (`make e2e`)

Arquivos criados em `e2e/tests/`: `helpers.ts`, `m1-cadastro-login.spec.ts`, `m1-recuperacao.spec.ts`, `m1-conta.spec.ts`, `m1-responsivo-a11y.spec.ts` (mais o `smoke.spec.ts` do DevOps).

Resultado final: **26 de 26 passam** (`make e2e`, 5 workers, ~9 s), depois de aplicado o contorno do D2 em `helpers.ts`. Sem o contorno, todos os testes que chamam a API pela UI falham (D2).

| Caso | Cobertura | Resultado |
|---|---|---|
| E-01 | Tela 01: links Entrar, Criar conta e Termos | OK |
| E-02 | Rotas protegidas sem sessão vão para `/entrar` (4 rotas) | OK |
| E-03 | Cadastro: senha < 8 e senhas diferentes mantêm o botão desabilitado | OK |
| E-04 | Cadastro cria Casa "Casa de Ana", ADMIN, plano Individual, 1 membro; sessão sobrevive ao reload; usuário logado não vê `/entrar` | OK |
| E-05 | E-mail já usado (inclusive em maiúsculas) mostra erro e fica em `/criar-conta` | OK |
| E-06 | Logout apaga o token, bloqueia `/conta` e o token antigo dá 401 | OK |
| E-07 | Login inválido e e-mail inexistente mostram a mesma mensagem genérica | OK |
| E-08 | Login válido leva à tela 05 e persiste no reload | OK |
| E-09 | Login com campos vazios: botão desabilitado | OK |
| E-10 | Recuperação: e-mail sem conta mostra o erro do UC006 | OK |
| E-11 | Recuperação: código errado volta à etapa do código; código certo (lido no Mailpit) troca a senha, não faz login, encerra sessões antigas e é de uso único | OK |
| E-12 | Senha antiga deixa de valer e a nova entra | OK |
| E-13 | Tela 16: e-mail mascarado (RNF25), nome e papel | OK |
| E-14 | Tela 20: edição do nome | OK |
| E-15 | Tela 19: senha atual errada (não derruba a sessão), nova igual à atual bloqueada, sucesso troca o token e a sessão continua | OK |
| E-16 | Tela 20: troca de e-mail com código enviado ao novo endereço; código errado rejeitado; login só com o novo e-mail | OK |
| E-17 | Tela 20: e-mail em uso mostra erro no campo | OK |
| E-18 | Tela 21: exige senha, senha errada mantém a conta, Escape fecha, senha certa leva à tela 01, bloqueio imediato, e-mail segue reservado (409) | OK |
| E-19 a E-22 | Responsividade 375x812 e 1280x800: sem rolagem horizontal em 9 telas, campos com rótulo, botões e links com nome, `lang=pt`, `<title>`, `h1`, tab bar com alvo de toque >= 44 px no celular | OK |
| E-23 | Foco por teclado em Entrar | OK |
| E-24 | Banner offline (RNF24) | OK |
| E-25 | Rota `*` mostra "Página não encontrada" | OK |

Observações de uso do E2E:
- O cadastro é limitado a 10 por hora por IP e **a contagem inclui requisições com erro**. Uma execução completa gasta 4 cadastros (1 por arquivo de conta, 2 no arquivo de cadastro). Mais de 2 execuções por hora, ou depurar com falhas, esgota o limite; `docker compose restart backend` zera o contador em memória. O responsivo usa o usuário do seed (`demo@keepit.local`) para não gastar cadastro.
- Os testes criam usuários `@e2e.keepit.test` no banco de desenvolvimento. Para limpar: marcar `exclusao_solicitada_em` antigo e chamar `/internal/jobs` (foi o que a QA fez ao final).
- Código de recuperação expirado não tem teste E2E (exigiria alterar o banco); está no caso A-27 abaixo.

## 3. API por curl (contrato `docs/api/m1-auth.md`)

| # | Caso | Esperado | Obtido |
|---|---|---|---|
| A-01 | Cadastro válido | 201, `Casa de Ana`, ADMIN, INDIVIDUAL, 1 membro | OK |
| A-02 | Cadastro com e-mail repetido (maiúsculas) | 409 `EMAIL_EM_USO` | OK |
| A-03 | Senha < 8 | 422, `details[0].campo=senha` | OK |
| A-04 | Senha > 72 | 422 | OK |
| A-05 | Confirmação diferente | 422 em `confirmarSenha` | OK |
| A-06 | E-mail inválido, nome vazio | 422 por campo | OK |
| A-07 | JSON malformado | 400 `REQUISICAO_INVALIDA` | OK |
| A-08 | `GET /me` sem token | 401 `NAO_AUTENTICADO` | OK |
| A-09 | Token lixo, assinatura errada, `alg:none` | 401 `NAO_AUTENTICADO` | OK |
| A-10 | Token expirado | 401 `SESSAO_EXPIRADA` | OK |
| A-11 | Login ok, senha errada, e-mail inexistente | 200 / 401 / 401 com mensagem idêntica | OK |
| A-12 | `PATCH /me` (nome), ignora `email` no corpo, nome vazio e com 81 caracteres | 200 / 200 sem trocar e-mail / 422 / 422 | OK |
| A-13 | `PATCH /me/senha`: atual errada, igual à atual, curta, sem token | 401 `SENHA_INCORRETA` / 422 `SENHA_IGUAL_ATUAL` / 422 / 401 | OK |
| A-14 | `POST /me/email`: igual ao atual, inválido, em uso | 422 / 422 / 409 | OK |
| A-15 | `POST /me/email/confirmar` sem pedido, formato inválido | 400 `CODIGO_INVALIDO` / 422 | OK |
| A-16 | `recuperar-senha` com e-mail inexistente | 404 `CONTA_NAO_ENCONTRADA` (decisão do PO) | OK |
| A-17 | `redefinir-senha` e-mail sem conta | 400 `CODIGO_INVALIDO` | OK |
| A-18 | `/internal/jobs` e `/jobs/run` sem chave ou com token de usuário | 401 | OK |
| A-19 | Rota inexistente | 404 `NAO_ENCONTRADO` | OK |
| A-20 | `DELETE /me` sem senha, senha errada | 422 / 401 `SENHA_INCORRETA` | OK |
| A-21 | Logout, depois `GET /me` com o mesmo token | 204 / 401 `SESSAO_EXPIRADA` | OK |
| A-22 | Rate limit login: 10 falhas, 11ª | 429 `MUITAS_TENTATIVAS` + `Retry-After: 900`; outro e-mail no mesmo IP segue 401 | OK |
| A-23 | Rate limit `recuperar-senha`: 5, 6ª | 429 na 6ª | OK |
| A-24 | Rate limit cadastro 10/h | 429 | OK (conta erros também, ver D7) |
| A-25 | `redefinir-senha` e `me/email/confirmar` 11ª falha | 429 | OK |
| A-26 | Reenvio do código de recuperação | código antigo passa a dar 400 | OK |
| A-27 | Código expirado (`expira_em` no passado, via psql) | 400 `CODIGO_INVALIDO` | OK |
| A-28 | Código reutilizado | 400 `CODIGO_INVALIDO` | OK |
| A-29 | Redefinição: token antigo, senha antiga | 401 / 401; senha nova entra | OK |
| A-30 | Troca de e-mail: código chega ao NOVO e-mail; antigo continua válido até confirmar; reuso do código dá 400; login só com o novo | conforme contrato | OK |
| A-31 | `PATCH /me/senha` ok devolve token novo; token anterior morre | 200 / 401 | OK |
| A-32 | `DELETE /me`: 204, token morre, login 401 genérico, recadastro 409, recuperar-senha 404 | conforme contrato | OK |
| A-33 | Rotina de exclusão: conta com pedido de 23 h não é apagada; com 25 h é; Casa vazia some; segunda chamada não apaga nada | `{apagadas:0}` / `{apagadas:1}` / `{apagadas:0}`; alias `/jobs/run` funciona | OK |
| A-34 | CORS: origem `evil.com` | só `http://localhost:5173` liberada | OK |
| A-35 | Logout seguido de novo login em menos de 1 s | novo token válido | **FALHA (D3)** |
| A-36 | `POST /me/email` com token roubado, sem senha | deveria exigir reautenticação (AppSec F3) | **sem exigência (D1)** |
| A-37 | Cabeçalhos de `/me` e `/auth/*` | `Cache-Control: no-store` (AppSec F15) | ausente (D6) |

## 4. Acessibilidade e responsividade

Verificado por leitura de código e pelos testes E2E (E-19 a E-24):
- Todos os campos têm `<label for>` com `aria-describedby` ligado ao erro e `role="alert"` nas mensagens; `aria-invalid` nos campos com erro.
- Botão voltar tem `aria-label`; código de 6 dígitos usa `role="group"` com rótulo por dígito, aceita colar e setas; `lang="pt-BR"`; banner offline com `role="alert"`; botões e links desabilitados de módulos futuros com `aria-disabled` e "Em breve".
- Sem rolagem horizontal em 375 px e 1280 px nas 9 telas; tab bar no celular com alvos de 48 px.
- Não foi medido contraste de cores nem leitor de tela real (fora do alcance desta execução).
- Pontos fracos: modal da tela 21 sem retenção de foco (D5) e rótulo estranho no botão de mostrar senha do modal (D5).

## 5. Defeitos

| ID | Área | Severidade | Resumo |
|---|---|---|---|
| D1 | backend | alta | `POST /me/email` não exige senha atual nem avisa o e-mail antigo (AppSec F3, confirmado) |
| D2 | infra | média | Front aponta a API para `localhost:3333` e CORS só aceita `localhost:5173`: o `make e2e` não consegue fazer fluxos pela UI |
| D3 | backend | média | Token emitido em login feito no mesmo segundo do logout (ou redefinição) nasce inválido para sempre |
| D4 | backend | média | Sem limite de tentativas por código; o limite de `confirmar` é só por IP (AppSec F2, confirmado) |
| D5 | frontend | baixa | Modal da tela 21 sem retenção de foco; rótulo "Mostrar digite sua senha para confirmar" |
| D6 | backend | baixa | Sem `Cache-Control: no-store` em `/auth/*` e `/me*` (AppSec F15) |
| D7 | backend | baixa | Limites de `confirmar`, `PATCH /me/senha` e `DELETE /me` compartilham um balde; cadastro conta requisições inválidas |

Detalhes e passos estão no retorno estruturado desta execução.

## 6. Reteste

Execução: `make check` (backend 123 testes, frontend 22 testes: todos passam) e `make e2e` (23 passam, 1 falha, 2 não rodaram). Verificações de API feitas com curl contra o backend em execução.

| ID | Resultado | Evidência |
|---|---|---|
| D1 | Corrigido na API | `POST /me/email` sem `senhaAtual` dá 422; com senha errada dá 401 `SENHA_INCORRETA` |
| D3 | Corrigido | login, logout e novo login em menos de 1 s: `GET /me` retorna 200 |
| D4 | Corrigido (testes do backend) | tentativas por código, independente de IP |
| D5 | Corrigido (testes do frontend) | retenção de foco, rótulo e texto do erro |
| D6 | Corrigido | `Cache-Control: no-store` em `/me` |
| D7 | Corrigido (testes do backend) | limitadores separados por rota |
| ACH-05 | Corrigido | `/jobs/run` agora 404 |
| D2 | **Aberto** | `docker-compose.yml` e `.env` sem `CORS_ORIGIN` com `frontend:5173`, sem `RATE_LIMIT_DESLIGADO` e `VITE_API_URL` ainda `localhost:3333` |
| Novo D8 | **Aberto, alta** | Front não envia `senhaAtual` em `POST /me/email` nem grava o `token` novo de `/me/email/confirmar`: a tela 20 não consegue trocar o e-mail; E2E `tela 20: troca de e-mail` falha e 2 testes seguintes não rodam |
| Novo D9 | **Aberto, média** | `.github/workflows/ci.yml` com `JWT_SECRET` de 22 caracteres e `JOBS_TOKEN` curto: o CI quebra com o `env.ts` novo; faltam `CODIGO_SECRET` e `npm run audit:prod` |
| Novo D10 | **Aberto, baixa** | `docs/05-diagramas/schema.prisma` sem a coluna `tentativas`; contrato `docs/api/m1-auth.md` seção 3.8 não atualizado |
| ACH-10 | Aberto (risco aceito) | enumeração de contas sem aceite formal do PO |

Resultado: **reprovado** por D8 (funcionalidade quebrada e E2E vermelho).

## 7. Fechamento da sprint (correção dos defeitos do reteste)

| Defeito do reteste | Correção | Evidência |
|---|---|---|
| Tela 20 sem `senhaAtual` e sem gravar o token novo (alta) | `frontend/src/features/auth/api.ts`, `hooks.ts`, `schemas.ts` e `pages/DadosCadastrais.tsx`: o campo Senha atual aparece quando o e-mail muda, SENHA_INCORRETA fica no campo sem derrubar a sessão, Reenviar usa a mesma senha e a confirmação grava o token novo | `pages/DadosCadastrais.test.tsx` (4 testes); E2E `m1-conta.spec.ts` com senha errada, troca e recarga |
| D2: CORS, rate limit e URL da API no dev/e2e (média) | `VITE_API_URL=/api` mais o proxy do Vite (`VITE_PROXY_TARGET=http://backend:3333`); `CORS_ORIGIN` com `http://frontend:5173`; `RATE_LIMIT_DESLIGADO=true` no compose de dev (nos testes do back quem decide é `TESTAR_RATE_LIMIT`); contorno de `e2e/tests/helpers.ts` removido | `curl localhost:5173/api/health` → ok; E2E 26/26 sem contorno |
| CI com segredos curtos e sem CODIGO_SECRET/audit (média) | `.github/workflows/ci.yml`: segredos de 32+ caracteres, CODIGO_SECRET, typecheck do front, `npm run audit:prod` (back) e `npm audit --omit=dev --audit-level=high` (front) | os mesmos comandos passam localmente (exit 0) |
| Documentação desatualizada (baixa) | Contrato 3.8, 3.9, 3.11 e 3.12, ADR 0001 (códigos, prazo, dev/E2E, rotinas) e `docs/05-diagramas/schema.prisma` sincronizado | — |
| Prazo de exclusão de ~25 h (decisão do PO) | `PRAZO_EXCLUSAO_HORAS = 23` | `auth.test.ts`: 22,5 h não apaga, 23,5 h apaga |

Resultado final: `make check` com back 124/124 e front 26/26; `make e2e` 26/26.
Abertos, sem bloquear: 3 avisos altos no `npm audit` do back (nodemailer/Prisma, ACH-06); verificação visual em 360/768/1440 px; token em localStorage (ACH-04).
