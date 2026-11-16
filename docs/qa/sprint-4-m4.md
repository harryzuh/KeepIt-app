# Relatório de QA — Sprint 4 (M4 Estatísticas e Início)

Data: 2026-11-15 · Escopo: UC017 e UC027, RF23 e RF24, RNF06, RNF07, RNF10, RNF19, RNF27 e RNF31 · Contrato: `docs/api/m4-estatisticas.md` · ADR 0004.
Pagamento continua simulado (decisão 48).

**Resultado: REPROVADO** (1 defeito alto e 1 médio de front-end com teste falhando; demais itens aprovados).

## 1. Regressão (make check e make e2e)

| Item | Resultado |
|---|---|
| `make check` | lint e typecheck limpos; backend 508/508; frontend 171/171 |
| `make e2e` (final) | 263 passando, 3 falhando (todos novos do M4, defeitos abaixo); M1, M2, M3 e M5 sem regressão real |
| Specs antigos quebrados pela Sprint 4 (ajustados pelo QA) | `m1-cadastro-login.spec.ts` (o texto "Plano Individual" agora aparece 2 vezes no Início: card da Casa e linha do resumo; usado `.first()`); `m3-produtos-ui.spec.ts` "tela 05: produtos recentes" (a 1280 px o Início é a tela 17, com tabela; o teste passou a rodar a 390 px) |
| `m3-responsivo.mobile.spec.ts:102` (instável relatada pelo DevOps) | passou em 2 execuções completas; não reproduzida |

## 2. Specs criados (e2e/tests)

- `m4-api.spec.ts` (13 testes): matriz sem token/token inválido/ADMIN/EDITOR/LEITOR (conteúdo idêntico, `no-store`), métodos não GET, números do conjunto padrão conferidos em centavos fora do backend, consistência resumo x tela 10 x soma de `GET /produtos`, Casa vazia, preço 0,00, tags sem produto, valores máximos (9999999999.99 x 1.000.000) e arredondamento, empates, isolamento entre Casas com nomes iguais, `casaId` e query maliciosa ignorados (inclusive SQL injection e 5000 caracteres), membro removido, 50 requisições simultâneas.
- `m4-ui.spec.ts` (desktop): indicadores da tela 17, LEITOR e EDITOR, Casa vazia, plano Individual, tela 10 completa (barras com `aria-label`, "Sem tag" por último, mais antigos em ordem), valores gigantes por extenso, 52 tags (aviso de 50), criar/editar/excluir produto atualizando indicadores sem recarregar, troca de conta entre Casas sem vazar números (cache), axe, foco visível, barra de armazenamento.
- `m4-responsivo.mobile.spec.ts` (360 px): ADMIN, LEITOR, Casa vazia, valores gigantes, nome longo, sem conexão com "Tentar de novo", rolagem horizontal, alvos de toque, axe.
- `m4-desempenho.spec.ts`: mede a API e as telas com o volume de `make seed-volume` (pula sem o volume).

## 3. API contra o contrato (curl e specs)

- Sem token: 401 `NAO_AUTENTICADO` com `Cache-Control: no-store`. Token inválido: 401. POST/PUT/PATCH/DELETE e `/estatisticas/1`: 404.
- Papéis: ADMIN, EDITOR e LEITOR recebem 200 com o mesmo corpo; usuário de outra Casa recebe só os próprios números; nunca 403/404 de papel.
- Query ignorada (`casaId=999`, `a[]=1`, injeção): 200 com os números da própria Casa.
- Valores conferidos: Casa demo (21 produtos, total 19582.70); carga de 10.000 produtos: total, contagem e soma de unidades iguais ao SQL direto (`1034554994459.48`, 10.000, 10.105.793) e 160 tags com produto.
- Dinheiro sempre `^\d+\.\d{2}$`, sem perda de precisão acima de 2^53.

## 4. Desempenho (RNF06), 10.000 produtos e 200 tags (`make seed-volume`)

| Medida | Resultado | Meta |
|---|---|---|
| `GET /estatisticas/resumo` | mediana 6 ms, máx 7 ms | < 500 ms |
| `GET /estatisticas` | mediana 22 a 38 ms, máx 41 ms | < 500 ms |
| 50 requisições simultâneas (completa) | todas 200, máx 211 ms | sem erro |
| 100 requisições simultâneas (resumo) | todas 200, máx 213 ms | sem erro |
| Início no desktop (indicadores visíveis) | 203 ms | < 2 s |
| Tela Estatísticas | 185 ms | < 2 s |

Aprovado.

## 5. Acessibilidade

- Barras do gráfico: `role="img"` com `aria-label` (nome, valor, percentual, produtos) e o mesmo valor e percentual escritos ao lado; "Sem tag" usa cinza diferente e texto. Aprovado.
- Barra de armazenamento: `role="progressbar"` com `aria-valuemin/max/now/text`; aviso escrito acima de 90%. Aprovado.
- Foco visível nos links dos mais antigos; navegação por teclado alcança a lista. Aprovado.
- axe (WCAG 2.1 A/AA) em Início e Estatísticas, desktop e 360 px: sem violações sérias, exceto D2 e D4 abaixo.

## 6. Defeitos

| # | Área | Severidade | Título |
|---|---|---|---|
| D1 | frontend | alta | Tela 10 gera rolagem horizontal em 360 px com nome de produto comprido |
| D2 | frontend | média | Link "Maior gasto" viola WCAG 2.5.3 (rótulo no nome) |
| D3 | backend | média | Transação do M4 sem `statement_timeout` (AppSec F-02) |
| D4 | frontend | baixa | Selo LEITOR com contraste insuficiente (herdado do M2) |
| D5 | frontend | baixa | "Plano Individual" repetido no Início |
| D6 | backend | baixa | Resposta `no-store` envia ETag e aceita 304 |

### D1 (alta, frontend)
Passos: Casa com um produto de nome de 60 caracteres (ex.: "Notebook Dell Inspiron 14 polegadas 16GB RAM SSD 512GB prata"), entrar a 360 px e abrir `/estatisticas`.
Esperado: sem rolagem horizontal (RNF10); nome truncado com `title`.
Obtido: `scrollWidth` 418 (e 703 com valores gigantes) contra 360. Causa: em `pages/Estatisticas.tsx` o `<Link>` do Maior gasto (filho do grid `sm:grid-cols-3`) não tem `min-w-0`, e a trilha `1fr` cresce até o conteúdo, de modo que o `truncate` não limita. Sugestão: `min-w-0` no Link e no grid (`grid-cols-[minmax(0,1fr)]`).
Testes: `m4-responsivo.mobile.spec.ts` (valores gigantes e nome de 60 caracteres).

### D2 (média, frontend)
Passos: abrir `/estatisticas` com produtos e rodar axe.
Esperado: nome acessível do link contém o texto visível.
Obtido: `label-content-name-mismatch` (serious): o link tem `aria-label="Maior gasto: Notebook 14 polegadas, abrir detalhe"` e o texto visível começa por "Maior gasto R$ 4.599,00 ...". Além disso há um `role="group"` com outro `aria-label` aninhado dentro do link. Teste: `m4-ui.spec.ts` "WCAG 2.5.3".

### D3 (média, backend)
`estatisticas.service.ts` define `maxWait` e `timeout` na transação, mas não `SET LOCAL statement_timeout` (confirmado por busca no código). Uma consulta lenta pode prender conexão do pool. Medição atual não mostra problema (50 e 100 simultâneas ok), por isso média. Também sem teto de produtos por Casa (AppSec F-01), decisão do PO.

### D4 (baixa, frontend, herdado)
`<span class="bg-borda text-suave">LEITOR</span>` (PapelSelo) reprova `color-contrast` no Início. Excluído do axe do spec móvel para não mascarar outros achados.

### D5 (baixa, frontend)
O Início mostra "Plano X" no card da Casa e de novo na linha do resumo; quebrou o spec de M1 (ajustado com `.first()`). Considerar remover um.

### D6 (baixa, backend)
`Cache-Control: no-store` convive com `ETag` fraco; `If-None-Match` devolve 304. Sem impacto funcional.

## 7. Verificações dos riscos do AppSec

- F-11 (cache entre contas): não reproduzido. Sair e entrar com conta de outra Casa não exibe números anteriores (teste de troca de conta passa).
- F-05: 401 já traz `no-store`.
- F-03 (JOIN de tags) e isolamento: teste com tags de mesmo nome em duas Casas passa.
- F-04: `renovacao` só traz status e data, sem dados de pagamento (teste confirma).

## 8. Como repetir

`make check`; `make e2e`; `make seed-volume` e depois `docker compose --profile e2e run --rm e2e npx playwright test m4-desempenho`.
Capturas em `e2e/test-results/sprint4-telas/`.

## 9. Reteste 1

Resultado: `make check` passou (backend 512/512, frontend 178/178, lint e typecheck limpos) e `make e2e` passou (271/271). Nenhum defeito crítico ou alto aberto. Aprovado.

Ajuste dos specs (QA): com a correção do D2, o cartão "Maior gasto" deixou de ser `role="group"` e virou link sem `aria-label`. Os helpers `indicador` de `m4-ui.spec.ts` e `m4-responsivo.mobile.spec.ts` e a busca do link foram atualizados (`/^Maior gasto.*Notebook/`).

| Defeito anterior | Resultado do reteste |
|---|---|
| D1 (alta) rolagem horizontal a 360 px | Corrigido. Os dois specs móveis (valores gigantes e nome de 60 caracteres) passam. |
| D2 (média) WCAG 2.5.3 no "Maior gasto" | Corrigido. O axe `label-content-name-mismatch` passa. |
| D3 e D8 (média) sem `statement_timeout` | Corrigido. `set_config('statement_timeout','3000',true)` na transação, `maxWait` 1 s, 503 `ESTATISTICAS_INDISPONIVEL`. Testes do back com `pg_sleep` passam. Com 10.000 produtos e 200 tags: resumo 6 ms, completa 43 ms, 50 e 100 requisições simultâneas ok, Início 210 ms e Estatísticas 191 ms. |
| D7 (média) cache entre contas | Corrigido. `qc.clear()` no login, no cadastro e no evento `storage` de troca de token; `useSairDaCasa` limpa produtos e tags. O spec de troca de conta e os testes RTL passam. |
| D9 (média) `npm audit` | Mitigado pela infra (exceção do advisory com validade até 2027-03-31, `--no-install` no deploy). A vulnerabilidade permanece até migrar para Prisma 7. Não reprova. |
| D4 (baixa) contraste do selo LEITOR | Aberto. |
| D5 (baixa) "Plano Individual" repetido | Aberto. |
| D6 (baixa) ETag e 304 com `no-store` | Aberto. Reproduzido: `If-None-Match` com o ETag devolve 304. |
| D10 (baixa) sem teto por Casa | Aberto, decisão do PO. |
| D11 (baixa) sem CHECK e sem Zod na resposta | Aberto. |
| D12 (baixa) 429 sem `no-store` e script de carga | Aberto. |
