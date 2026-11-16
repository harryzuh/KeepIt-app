# Relatório da Sprint 1 — Fundação + M1 (Autenticação e Conta)

Data do aceite: 15/11/2026 · Responsável: PO · Fontes: reteste do QA (`docs/qa/sprint-1-m1.md`), revisão do AppSec (`docs/seguranca/m1-modelo-ameacas.md`), relatos das equipes.

## Veredito
**Sprint aceita parcialmente.** 11 das 12 histórias estão aceitas (4 sem ressalva, 7 com ressalvas). A história **8.2 (alteração de e-mail) está rejeitada** e o E2E está vermelho por causa dela. A sprint só fecha quando 8.2 for corrigida e `make check` e `make e2e` passarem. O aceite vale para desenvolvimento e homologação, não para produção.

## 1. Entregue
- Back-end completo do contrato `docs/api/m1-auth.md`: cadastro com Casa Individual e ADMIN em transação única (RF32), login, recuperação e redefinição de senha por código, logout com corte de sessões, `GET/PATCH /me`, troca de e-mail por código, alteração de senha, exclusão de conta e rotina `/internal/jobs` de apagamento em 24 h.
- Correções do back após a revisão de segurança: `senhaAtual` na troca de e-mail, token novo na confirmação, limite de 5 tentativas por código, segredos com 32+ caracteres, comparação segura em `/internal/jobs`, alias `/jobs/run` removido.
- Front-end: telas 01, 02, 03, 04, 18, 19, 16, 20, 21 e 05 mínima, termos de uso, guardas de rota, banner de falta de conexão, tokens visuais do protótipo.
- Infra: Docker, migration `base_m1`, seed (3 planos e usuário demo), testes com schema `test`, serviço e target `make e2e` (Playwright), CI com Postgres, `jobs.yml` migrado.
- Testes: back 123 e front 22 passando (`make check`); E2E 23 passam, 1 falha, 2 não rodam.
- Documentação: contrato da API, ADR 0001 (A1 a A5), modelo de ameaças, relatório do QA.

## 2. Resultado por história
| História | Resultado |
|---|---|
| 1.0 Fundação | Aceita com ressalvas |
| 1.0.1 Boas-vindas | Aceita |
| 1.1 Login | Aceita |
| 1.2 Cadastro com Casa | Aceita |
| 1.3 Recuperação de senha | Aceita com ressalvas |
| 1.4 Encerrar sessão | Aceita |
| 1.5 Alteração de senha | Aceita com ressalvas |
| 8.1 Perfil e dados | Aceita com ressalvas |
| 8.2 Alteração de e-mail | **Rejeitada** |
| 8.3 Exclusão de conta | Aceita com ressalvas |
| 8.3.2 Rotina de exclusão | Aceita com ressalvas |
| 9.2.1 Termos de uso | Aceita com ressalvas |

## 3. Defeitos abertos (bloqueiam o fechamento da sprint)
1. **Front, alta:** a tela 20 não envia `senhaAtual` em `POST /me/email` nem grava o token devolvido por `/me/email/confirmar`. Quem corrige: Front-end. Efeito: história 8.2 quebrada, `m1-conta.spec.ts:64` falha e os 2 testes seguintes não rodam.
2. **Infra, média (D2):** `CORS_ORIGIN` sem `http://frontend:5173`, sem `RATE_LIMIT_DESLIGADO=true` no ambiente e2e/dev, `VITE_API_URL` a ajustar. Hoje há um contorno no fixture `e2e/tests/helpers.ts`, que deve sair depois.
3. **Infra, média:** `ci.yml` usa `JWT_SECRET` e `JOBS_TOKEN` com menos de 32 caracteres, não define `CODIGO_SECRET`, e falta `npm audit` (back e front) no pipeline.
4. **Documentação, baixa:** `docs/05-diagramas/schema.prisma` sem a coluna `tentativas`; `docs/api/m1-auth.md` (seção 3.8) e a ADR sem `senhaAtual`, token na confirmação, 5 tentativas, `CODIGO_SECRET` e `RATE_LIMIT_DESLIGADO`.

## 4. Pendências que não bloqueiam a sprint (viram itens da próxima)
- Testes automatizados de front para a tela 20, modal da tela 21, logout e tela 01.
- Verificação visual em 360/768/1440 px e acessibilidade contra o protótipo (ninguém abriu o app no navegador).
- Revisão do texto dos Termos pelo AppSec/LGPD e canal real do titular (RF29 está no backlog).
- Foto de perfil (UC015) e contato com a equipe (RF29, UC032): backlog.
- Code-splitting por rota (chunk acima de 500 kB).
- Reduzir `PRAZO_EXCLUSAO_HORAS` para 23 (decisão 12 do STATUS).
- Backend: ACH-09 (senha em bytes, `Cache-Control: no-store`, `credentials` do CORS, seed sem abortar em produção, invalidar códigos pendentes na troca de senha, logs do Prisma sem dados do usuário, teste de JWT `alg: none`).

## 5. Riscos
| Risco | Severidade | Tratamento |
|---|---|---|
| Sem CSP e token de 8 h em `localStorage` (ACH-04) | Alta para produção | CSP sem `unsafe-inline`/`unsafe-eval`, `connect-src` só para a API, fonte local. Obrigatório antes de produção. |
| `nodemailer` 7.0.13 e `deepmerge-ts` com avisos altos (ACH-06) | Média | Atualizar nodemailer e Prisma; `npm audit --omit=dev` no CI. |
| Nome livre no texto do e-mail de troca (ACH-07) | Média | Rejeitar `<` `>` e quebras de linha no nome; não usar o nome nesse e-mail. Confirmar no código se já foi tratado. |
| Exclusão definitiva pode falhar para titular de assinatura e deixar Casa sem ADMIN (ACH-08) | Média, latente até o M5 | Tratar no M5 (cancelar assinatura) e no M2 (transferir ADMIN); alertar pedidos pendentes há mais de 20 h. |
| Apagamento em 24 h depende do cron do GitHub Actions (F12) | Média | Alerta de falha e reduzir o prazo para 23 h. |
| Rate limit em memória (F9) | Média | Aceito no MVP com uma instância; revisar ao escalar. |
| Enumeração de contas (ACH-10) | Baixa | **Aceite formal do PO** no MVP (decisão 11 do STATUS), a rever antes de produção pública. |
| LGPD: sem registro de versão e data dos termos e sem canal do titular (F8) | Média | Entrar com o M5 ou uma sprint própria do M1. |
| Preços e limite do plano Individual são premissa | Baixa | Confirmados para o MVP (decisão 10); editáveis em `planos.ts`. |

## 6. Backlog proposto para a Sprint 2 (M2 Casa e Membros + M5 Planos e Assinatura)
Ordem de construção: M1, depois M2 e M5, em seguida M3 e M4 (`docs/02-arquitetura/2.1-arquitetura-funcional.md`). O M2 consulta o M5 para o limite de membros, então a história de planos vem primeiro.

**Itens 0, obrigatórios antes de começar (fechar a Sprint 1)**
- S1-F1 Front: corrigir 8.2 (`senhaAtual`, token novo) e deixar `make e2e` verde.
- S1-D1 DevOps: D2 do ambiente, CI com segredos de 32+ caracteres, `CODIGO_SECRET` e `npm audit`.
- S1-B1 Back/Arquiteto: atualizar contrato, ADR e `schema.prisma` dos docs.

**M5 — Planos e Assinatura (primeiro bloco, base de limites)**
| Ordem | História | Linear | RF / UC |
|---|---|---|---|
| 1 | Cota de plano da Casa: serviço único que devolve plano vigente e limites (membros, GB) | 7.0 | base de RF26 e RF39 |
| 2 | Visualizar planos e detalhes do plano (tela 13) | 7.1, 7.1.1 | RF12, RF14, UC019, UC029, UC030 |
| 3 | Método de pagamento simulado (tela 14) | 7.3 | RF15 |
| 4 | Assinar ou alterar plano pelo ADMIN, gerando nova assinatura (pagamento simulado) | 7.2 | RF13, UC028 |
| 5 | Cancelar assinatura com confirmação e auditoria (tela 15) | 7.4 | RF16, UC031 |
| 6 | Expirar assinatura na rotina `/internal/jobs`: volta ao Individual, desvincula membros extras, mantém produtos | 7.5 | RF37, UC031 |
| 7 | Assinar plano como membro: aviso de saída da Casa e criação de Casa nova (tela 24) | 7.6 | RF38, UC028 |

**M2 — Casa e Membros**
| Ordem | História | Linear | RF / UC |
|---|---|---|---|
| 8 | Visualizar membros da Casa (tela 11) e tela Família | 6.1 | RF25, UC018, UC037 |
| 9 | Adicionar membro pelo ADMIN com papel e validação do limite do plano; membro transferido da Casa anterior (tela 12) | 6.2 | RF26, UC033, UC034 |
| 10 | Editar permissões de membro (tela 22) | 6.4 | RF28, UC034, UC036 |
| 11 | Remover membro com confirmação; produtos ficam sem autor, membro recebe Casa Individual (tela 22) | 6.3 | RF27, UC035 |
| 12 | Editar nome da Casa pelo ADMIN | 6.0 | RF32 (continuação) |
| 13 | Ganchos da exclusão de conta: cancelar assinatura do ADMIN excluído, dar Casa própria aos demais membros, transferir ADMIN (fecha ACH-08 e a regra do UC013) | 8.3, 8.3.2 | UC013, UC014 |

**Qualidade e segurança (transversal)**
- CSP e cabeçalhos de segurança no front (ACH-04), `Cache-Control: no-store`, atualização de nodemailer e Prisma.
- Revisão do AppSec nas regras de papel (RNF31): recurso de outra Casa responde 404; testes de autorização por papel em cada rota nova.
- Testes de front pendentes da Sprint 1 e verificação visual em 360/768/1440 px.
- Registro de versão e data dos termos no aceite e canal do titular (LGPD).

**Critério de saída da Sprint 2:** M2 e M5 aceitos pelo PO, `make check` e `make e2e` verdes, sem defeito de severidade alta aberto.

## 7. Próximos passos imediatos
1. Front-end corrige 8.2. 2. DevOps fecha D2 e o CI. 3. Back-end reduz o prazo de exclusão para 23 h e atualiza a documentação. 4. QA reexecuta `make check` e `make e2e`. 5. PO reaceita 8.2 e fecha a Sprint 1. 6. AppSec reabre os itens `[B]` já corrigidos no código (senhaAtual, tentativas, JWT e timingSafeEqual) e atualiza o modelo de ameaças.
