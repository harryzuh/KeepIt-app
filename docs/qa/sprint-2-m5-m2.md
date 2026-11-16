# QA — Sprint 2 (M5 Planos e Assinatura + M2 Casa e Membros)

Data: 2026-11-15. Ambiente: Docker, API em `localhost:3333`, front em `localhost:5173`. Nenhum código de produção foi alterado.

**Veredito da rodada 1: REPROVADO (ver "Reteste 1" ao final, que prevalece).** Nenhum defeito crítico, mas 2 testes E2E falham por defeitos confirmados (D1 média/alta para o texto da exclusão de conta, D2 média de estrutura de títulos). Ver seção 5.

## 1. `make check`
Lint, typecheck e testes passam: backend 260 de 260 (13 arquivos), frontend 62 de 62 (13 arquivos).

## 2. `make e2e`
81 testes (79 passam, 2 falham de propósito por defeitos reais). Os 26 specs do M1 e o smoke continuam verdes (sem regressão).

Specs novos em `e2e/tests/`:
| Arquivo | Cobertura |
|---|---|
| `m5-m2-api.spec.ts` (30) | Matriz de papéis sem token/LEITOR/EDITOR/ADMIN/ADMIN de outra Casa nas 12 rotas novas, 401 com formato `{ error, message }`, IDOR, códigos 402/404/409/422, PAN fora das respostas, duplo clique, limites do plano (Individual, Família no 6º, Business com 7 não cabe em Família), papel e Casa valendo para o mesmo token, transferência, `/internal/jobs`, exclusão de conta do ADMIN com herdeiro |
| `m5-planos-assinatura.spec.ts` (10) | Tela 13, contratar (tela 14), recusa (final 0000), Luhn, cancelar com confirmação e reativar, troca de plano, EDITOR/LEITOR sem tela 15, RF38 / tela 24, tela 21 |
| `m2-membros.spec.ts` (7) | Telas 11, 12 e 22, limite do plano, editar papel, remover com confirmação, nome da Casa, removido continua logado |
| `m5-m2-a11y-desktop.spec.ts` (4) e `m5-m2-responsivo.mobile.spec.ts` (4) | 1280x800 e 360x800: sem rolagem horizontal, rótulos, nomes de botões, foco por Tab, alvos de toque >= 44 px (mobile), modais, barra inferior não cobre ações; screenshots em `e2e/test-results/sprint2-telas/` |
| `infra-helpers.spec.ts` | `.fixme` de `montarCasa` removido; passa (nenhum teste pulado) |

## 3. Rotina (`/internal/jobs`) com datas manipuladas no banco
Executado por script (psql altera `data_renovacao` para o passado, pois o relógio não pode ser adiantado pela API):
- CANCELADA vencida: `{expiradas:1}`; ADMIN e os 2 membros viram `ADMIN` de Casas Individuais separadas, `assinatura = null`; registro EXPIRADA/CANCELAMENTO.
- ATIVA vencida com cartão aprovado: `{renovadas:1}`, mesmo registro, +1 mês, Casa e membros mantidos.
- ATIVA vencida com cartão final 0000 trocado antes: `{expiradas:1}`, EXPIRADA/RECUSA, membros desvinculados.
- Auditoria presente (ASSINATURA_EXPIRADA, ASSINATURA_RENOVADA, MEMBRO_REMOVIDO, CASA_CRIADA, e demais ações do ADR). Nenhum PAN/CVV nos logs. Invariantes no banco: 0 Casas com 2 ADMIN, 0 Casas sem ADMIN.
O spec E2E cobre só o que não exige mexer em datas (job com CANCELADA ainda vigente não expira).

## 4. Responsividade e acessibilidade
Passam: sem rolagem horizontal em 360 e 1280 px, todos os campos com rótulo, todos os botões/links com nome, foco visível por Tab, alvos >= 44 px, modais cabem em 360 px, foco entra no modal e Esc fecha. Falha: D2.

## 5. Defeitos
- **D1 (frontend, média/alta)** Aviso da tela 21 desatualizado. `frontend/src/features/auth/ExcluirContaModal.tsx` diz "a assinatura é cancelada e os membros perdem o acesso à Casa". O contrato (`m2-casa.md`, seção 7) exige citar plano e renovação e que o membro mais antigo assume a Casa e os demais ganham Casa própria. O comportamento real da API é a promoção do herdeiro (provado no E2E). O usuário é informado de algo falso antes de uma ação irreversível. Teste: `m5-planos-assinatura.spec.ts` "tela 21".
- **D2 (frontend, média)** Telas 12, 13, 14 e 15 não têm `<h1>`: `PaginaForm` renderiza o título como `<p>`. Leitores de tela não encontram o título da página. Teste: `m5-m2-a11y-desktop.spec.ts` "cada tela nova tem um h1".

## 6. Observações (sem defeito aberto)
- Riscos do AppSec (FP1 captura de contas por adição direta, FP3 gateway aceita PAN real com Luhn válido, e-mails visíveis a LEITOR) estão conforme o contrato; ficam para decisão do PO/Arquiteto.
- Limites de taxa (20/h, 10/15 min) não foram exercitados no E2E, pois o compose roda com `RATE_LIMIT_DESLIGADO=true`; estão cobertos nos testes do backend.
- Mensagem de `PLANO_NAO_COMPORTA` no front é genérica (sem N membros e X GB), como o front-end já informou.


## 7. Reteste 1 (2026-11-15)

**Veredito: APROVADO** (nenhum defeito critico ou alto aberto; restam itens medios/baixos listados abaixo).

### Execucao
- `make check`: lint e typecheck passam; backend 276 de 276 (13 arquivos); frontend 64 de 64 (14 arquivos).
- `make e2e`: 91 de 91 passam (chromium e mobile 360px), sem regressao do M1. Numa primeira execucao `m1-conta` "troca de e-mail" falhou uma vez e passou em seguida, isolado e na execucao completa (intermitente, provavelmente espera do Mailpit; observar).
- Specs ajustados ao contrato novo (eram meus e estavam defasados): `m5-m2-api.spec.ts` (`falhas` na resposta do job; PUT /pagamento/metodo sem nome/CVV e so cartoes de teste). Novo: `m5-m2-reteste1.spec.ts` (7 testes).

### Defeitos anteriores
| # | Situacao | Evidencia |
|---|---|---|
| 1 Aviso da tela 21 | Corrigido | spec "tela 21" passa |
| 2 h1 nas telas 12-15 | Corrigido | `m5-m2-a11y-desktop` "cada tela nova tem um h1" passa |
| 3 Gateway/PAN real | Parcial: backend corrigido (so 4242... e 4111 1100 0005 0000; nome/CVV ignorados, 422 para PAN real). Front ainda coleta nome/CVV, sem aviso de cartao de teste e sem tratar 503; `PAGAMENTO_SIMULADO` nao esta no `.env.example` | spec reteste |
| 4 Oraculo de e-mail | Corrigido para Casa cheia (409 LIMITE_MEMBROS uniforme, existente ou nao). Residual aceito: com vaga, 404 x 409 MEMBRO_NAO_TRANSFERIVEL | spec reteste |
| 5 Deadlock/job sem trava | Corrigido (409 CONFLITO_CONCORRENTE, job com `falhas`); alerta so em log | `falhas: 0` verificado |
| 6 Saida da Casa | Parcial: `POST /casa/sair` funciona (EDITOR/LEITOR 200, ADMIN 403); sem tela no front; sem aceite formal do PO | spec reteste |
| 7 Herdeiro com exclusao pendente | Corrigido (testes do backend) | - |
| 8 id gigante | Corrigido: 422 em DELETE e PATCH, 404 para int4 maximo | spec reteste |
| 9 E-mail para todos os papeis | Corrigido para e-mail (so ADMIN); `usuarioId` sequencial segue visivel; tela 11 de LEITOR renderiza sem erro | spec reteste |
| 10 Bidi | Corrigido (testes do backend) | - |
| 11 npm audit | Aberto, aceito (CLI do Prisma) | - |

### Defeitos abertos
Ver lista de defeitos na entrega (front: nome/CVV, aviso de cartao de teste, 503 e tela Sair da Casa; infra: `PAGAMENTO_SIMULADO` no `.env.example`; frontend: `<p>` vazio de e-mail para EDITOR/LEITOR; npm audit).

## 8. Fechamento (correção dos defeitos médios do reteste 1)

| Defeito | Correção | Evidência |
|---|---|---|
| Tela 14 com nome e CVV, sem banner de teste e sem tratar 503/409 (média) | `features/assinatura/CartaoForm.tsx`, `schemas.ts` e `tipos.ts`: só número e validade, banner com os cartões de teste e recusa no cliente de cartão real com Luhn válido. `lib/mensagens.ts` ganhou PAGAMENTO_INDISPONIVEL e CONFLITO_CONCORRENTE. `pages/Pagamento.tsx`: PLANO_NAO_COMPORTA mostra os números das violações | `Pagamento.test.tsx` (+3 testes); E2E `m5-planos-assinatura` sem o campo de nome |
| Sem tela "Sair da Casa" (média) | `features/casa/SairDaCasaModal.tsx`, `useSairDaCasa` (substitui o /me pelo perfil da resposta e descarta o cache da Casa antiga) e botão na tela 11 só para EDITOR e LEITOR | `Familia.test.tsx` (+4 testes); E2E `m2-membros`: LEITOR sai pela UI e vira ADMIN Individual |
| `PAGAMENTO_SIMULADO` não documentado e alerta de falhas só no log (média) | `.env.example`, `docker-compose.yml` e `SETUP.md`; `.github/workflows/jobs.yml` falha com `::error::` quando `falhas > 0` | — |
| `<p>` vazio de e-mail para EDITOR e LEITOR (baixa) | `MembroDaCasa.email` opcional e renderização condicional | `Familia.test.tsx` |

Resultado: `make check` com back 276/276 e front 71/71; `make e2e` 92/92.
Continuam abertos (baixos ou risco aceito): `usuarioId` sequencial, oráculo 404 x 409 com vaga, `npm audit` (Prisma 7) e o teste intermitente de troca de e-mail no Mailpit.
