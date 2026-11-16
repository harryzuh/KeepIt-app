# Modelo de ameaças — M4 Estatísticas e Início (`GET /estatisticas/resumo`, `GET /estatisticas`)

- **Autor:** Engenheiro de Segurança e Privacidade (AppSec / LGPD)
- **Data:** 2026-11-15
- **Escopo:** as duas rotas do M4, as consultas agregadas (`$queryRaw`), a cota vinda de `plano.service.obterCotaDaCasa`, o cache do TanStack Query nas telas 05, 10 e 17, o `seed-volume` e a medição de desempenho.
- **Base lida:** `docs/api/m4-estatisticas.md`, `docs/adr/0004-m4.md`, `AGENTS.md` (papel 7), `backend/src/app.ts`, `middlewares/autenticar.ts`, `limitar.ts`, `sem-cache.ts`, `backend/prisma/schema.prisma` (`Produto`), `frontend/src/lib/query-client`, `features/auth/hooks.ts`, `features/casa/hooks.ts`, modelos de ameaça M1, M3 e M5/M2. **Não li código do M4:** só existe o stub de `estatisticas.routes.ts`. Esta etapa não altera código.
- **Regra do papel:** **[BLOQUEANTE]** = inaceitável até para o MVP. Os demais podem virar backlog com aceite formal do PO.

---

## 1. Ativos

| # | Ativo | Por que importa |
|---|---|---|
| A1 | Patrimônio da Casa (`valorTotal`, maior gasto, valor por tag) | Dado financeiro e de segurança física (quanto vale a casa, o que há dentro) |
| A2 | Nomes de produto e de tag em `maiorGasto`, `maisAntigos`, `tagMaisComprada`, `valorPorTag` | Texto livre do usuário; pode conter dado pessoal |
| A3 | Plano, membros em uso, armazenamento e `renovacao` do resumo | Dado de cobrança, hoje restrito ao ADMIN em `GET /assinaturas/atual` |
| A4 | Isolamento entre Casas (K1, RNF27) | Falha = vazamento entre clientes |
| A5 | Conexões do pool Postgres (Neon) e CPU do banco | Recurso compartilhado entre todas as Casas |
| A6 | Cache do navegador e do TanStack Query | Guarda os números depois do logout ou da troca de Casa |
| A7 | Integridade do número exibido | Valor errado numa tela de patrimônio engana o usuário (seguro, venda, inventário) |

## 2. Atores

| Ator | Capacidade assumida |
|---|---|
| LEITOR / EDITOR / ADMIN de outra Casa | Token válido; tenta ver números alheios por parâmetro, tag, id ou condição de corrida |
| Membro com papel baixo (LEITOR) | Quer ver o que o papel não deveria (cobrança) |
| Ex-membro, ou usuário que saiu da Casa | Continua no mesmo navegador/aba com cache da Casa antiga |
| Segundo usuário no mesmo navegador (computador compartilhado) | Entra depois do primeiro |
| EDITOR malicioso | Infla produtos e tags de uma Casa para tornar as consultas caras |
| Atacante autenticado com várias contas / vários IPs | Dispara muitas leituras para esgotar o pool |
| Operador / insider | Lê logs, banco, seed |

## 3. Fluxo e entradas

```
Navegador ──GET /estatisticas[/resumo] (Bearer)──▶ autenticar (casaId vem do BANCO, via token)
        ──▶ autorizar(QUALQUER_PAPEL) ──▶ tx REPEATABLE READ ──▶ N × $queryRaw(Prisma.sql, casaId)
        ◀── JSON (strings decimais) + Cache-Control: no-store
TanStack Query: ['estatisticas', 'resumo' | 'completa'], staleTime 30 s, refetch ao focar
```

Entradas não confiáveis: **somente** o cabeçalho `Authorization`, a query string (ignorada) e o método HTTP. Não há corpo, caminho parametrizado nem filtro. Os **dados** agregados vêm de campos controlados por EDITOR/ADMIN (`nome`, `preco`, `quantidade`, `dataCompra`, tags).

---

## 4. Ameaças e mitigação esperada

Estado: **OK** = o desenho já cobre; **FALHA** = lacuna, ver seção 6; **VERIFICAR** = depende da implementação.

### 4.1 Vazamento de dados de outra Casa por agregação

| ID | Ameaça | Mitigação esperada | Estado |
|---|---|---|---|
| E-01 | Consulta sem `WHERE casa_id = $1` (ex.: `maiorGasto` ou `maisAntigos` esquecem o filtro) devolve o produto de **outra Casa** | Todas as 6+ consultas filtram por `produto.casa_id`; teste de isolamento com duas Casas cujos dados se **sobrepõem** (nome, tag, data, preço iguais) e cada rota/campo comparado | OK no desenho (K1); **VERIFICAR** por consulta |
| E-02 | `JOIN produto_tag` agrega tag de outra Casa: `produto_tag` **não tem `casa_id`**; se o M3 permitir (ou um bug permitir) ligar produto da Casa A a `tag` da Casa B, `valorPorTag` mostra nome e id da tag alheia | Condição `tag.casa_id = produto.casa_id` no JOIN (defesa em profundidade) e teste que insere o vínculo cruzado direto no banco e espera a linha ausente. Ver F-03 | **FALHA** (F-03) |
| E-03 | `obterCotaDaCasa` ou o contador de tags (`tags`) chamados com outro `casaId` (ex.: lido do corpo ou de `req.query`) | `casaId` só de `usuarioDaRequisicao(req).casaId`; sem leitura de `req.query`/`req.params` no controller | VERIFICAR |
| E-04 | `$queryRaw` com interpolação de texto (`${nome}` em template comum) ou `$queryRawUnsafe` | Só `Prisma.sql` com `casaId` inteiro; lint/grep proíbe `$queryRawUnsafe` e `Prisma.raw` no módulo | OK no desenho; **VERIFICAR** (grep no CI) |
| E-05 | Agregação com resultado vazio devolve o total global (`SUM` sem `WHERE` por engano em CTE) | Teste: Casa B vazia enquanto Casa A tem milhares de produtos retorna zeros | VERIFICAR |
| E-06 | Condição de corrida na troca de Casa: o usuário sai/é removido e a requisição em voo calcula com a Casa antiga | `autenticar` lê `casaId` do banco a cada requisição, então a Casa é a de **agora**; a transação do M4 não relê | OK |
| E-07 | Ex-membro ou usuário excluído com JWT ainda válido | `autenticar` confere exclusão e `sessoesValidasDesde` a cada chamada | OK (herdado) |

### 4.2 Parâmetros que mudam o escopo

| ID | Ameaça | Mitigação esperada | Estado |
|---|---|---|---|
| P-01 | `?casaId=2`, `?tagId=`, `?limite=`, `?ordem=`, `?inicio=` na query tentam mudar escopo, período ou tamanho | O controller não lê `req.query`; teste que envia todos esses nomes e compara a resposta byte a byte com a sem query | OK no desenho; VERIFICAR |
| P-02 | Header `X-Casa-Id` ou similar | Nenhum header além de `Authorization` é lido | VERIFICAR |
| P-03 | `POST/PUT/DELETE /estatisticas` ou `GET /estatisticas/qualquer-coisa` | Só `GET` nas duas rotas; demais métodos e caminhos caem em `404 rotaNaoEncontrada` (sem `405` que revele rota) | VERIFICAR |
| P-04 | Rota futura (`/estatisticas/:casaId`, filtro de período do backlog) reintroduz o parâmetro | Regra de revisão: toda rota nova do M4 repete o teste de isolamento (RNF27); filtros de período entram por ADR e schema Zod `strict` | Processo |
| P-05 | `HEAD` e `OPTIONS` devolvem cabeçalhos sem `no-store` | `semCache` montado antes do router (ver F-05) | **FALHA** (F-05) |

### 4.3 Negação de serviço por consulta cara

| ID | Ameaça | Mitigação esperada | Estado |
|---|---|---|---|
| D-01 | **Não há teto de produtos, de tags nem de vínculos por Casa.** As medições (15 ms) valem para 10.000 produtos. Um EDITOR (ou um ADMIN com plano Business) cadastra 1 milhão de produtos/tags e cada leitura passa a varrer tudo; o custo é pago por **todas as Casas** (pool compartilhado) | Teto por Casa (ex.: 20.000 produtos, 500 tags, 10 tags por produto) validado no M3, ou medição da QA com 10×–100× o volume e decisão registrada. Ver F-01 | **FALHA** (F-01) |
| D-02 | Transação `REPEATABLE READ` interativa segura uma conexão; **sem `statement_timeout`** uma consulta lenta prende a conexão por até o `timeout` da transação (5 s) e o pool (Neon gratuito) acaba com poucas requisições | `SET LOCAL statement_timeout` (ex.: 3 s) dentro da transação, `maxWait` curto (ex.: 1 s) com 503 claro, pool dimensionado e métrica de espera. O ADR cita só `timeout`/`maxWait` (R-M4-4) | **FALHA parcial** (F-02) |
| D-03 | Amplificação: Início + tela 10 + `refetchOnWindowFocus` + várias abas × membros. O limite global é **120/min por IP** (não por usuário) e conta tudo; atrás de NAT corporativo o limite atrapalha usuários legítimos, e com vários IPs o atacante passa | Aceitar o limite global no MVP (D6 do ADR é razoável), **desde que** D-01 e D-02 estejam fechados; avaliar `limitar({ porUsuario: true })` já existente (leve, sem custo novo) para M4 | Risco aceito (F-07) |
| D-04 | `valorPorTag` e `tagMaisComprada` são **duas agregações iguais** (mesmo JOIN/GROUP BY) | Calcular uma vez e derivar a tag mais comprada do conjunto completo em SQL (CTE) ou limitar; reduz custo à metade na parte mais cara | Otimização (F-08) |
| D-05 | Resposta ilimitada | `LIMIT 50` e `LIMIT 5` já limitam; `nome` do produto ≤ 120 caracteres | OK |
| D-06 | `seed-volume` e a medição da QA sobrecarregam o banco compartilhado (Neon de dev) | Rodar só no Postgres local do compose; recusar se `DATABASE_URL` não for `localhost`/`postgres` do compose | **FALHA parcial** (F-09) |
| D-07 | 500 devolve texto de erro do Prisma/Postgres (nome de tabela, trecho do SQL) | `errorHandler` responde mensagem genérica e registra o detalhe só no log (`erro-log`); teste forçando erro de banco | VERIFICAR |

### 4.4 Exposição de dados pessoais em indicadores

| ID | Ameaça | Mitigação esperada | Estado |
|---|---|---|---|
| L-01 | `nome` de produto/tag é texto livre e aparece em `maiorGasto`, `maisAntigos` e nas tags; pode conter dado pessoal ("Anel da Maria, CPF…") | Aceitável dentro da própria Casa (já visível ao membro em M3). **Nunca** gravar esses nomes em log, em auditoria nem em mensagem de erro; M4 não gera auditoria (K3), ok | OK; VERIFICAR logs |
| L-02 | `descricao`, `adicionadoPorId`, nomes/e-mails de membros ou fotos entram por engano no `SELECT` do M4 | Contrato já devolve só `id, nome, preco, quantidade, valor, dataCompra`; schema Zod de **resposta** com `.strict()` e mapeamento explícito campo a campo (nada de `SELECT *`/spread) | OK no desenho; VERIFICAR |
| L-03 | **`renovacao` (status e data) vai a LEITOR e EDITOR.** Hoje a renovação só sai em `GET /assinaturas/atual` (ADMIN); o ADR afirma que é "o mesmo dado de `Perfil.assinatura`", mas isso é uma suposição não conferida aqui. Se `Perfil.assinatura` já a entrega a todos, o vazamento é nulo; se não, o M4 amplia o acesso a dado de cobrança do titular | Conferir `Perfil.assinatura` no contrato m1-auth (o Arquiteto/PO decidem). Alternativa de mínimo privilégio: o resumo trazer `renovacao` **só para ADMIN** (`null` para os demais) ou só o `status` | **FALHA a confirmar** (F-04) |
| L-04 | `membros.emUso/limite` e `armazenamento` revelam tamanho da equipe e uso a quem não gerencia | Só números agregados, sem identidade; baixo risco. Aceitar | OK |
| L-05 | Valor do patrimônio visto por LEITOR (convidado, ex.: parente, funcionário) | Decisão de produto: UC017/UC027 dão a todo membro. Registrar como **risco aceito** no PO e deixar claro na tela de convite/papéis ("Leitor vê valores") | Risco aceito (F-06) |
| L-06 | Logs de acesso/APM com a resposta ou com a URL contendo valores | Sem valor monetário em URL (não há parâmetros); não logar corpo de resposta | OK |
| L-07 | Números adulterados por dado de entrada fora do esperado: o contrato afirma `^\d+\.\d{2}$` e "valores nunca negativos", mas o banco **não tem `CHECK`** em `preco ≥ 0` e `quantidade ≥ 1` (a garantia está só no Zod do M3). Um valor negativo ou `NULL` por script/seed quebra regex do front e a regra de maior gasto | `CHECK (preco >= 0 AND quantidade >= 1)` por migration do Arquiteto (barato) **ou** o schema de resposta Zod valida a string e vira 500 controlado. Ver F-10 | **FALHA** (F-10) |

### 4.5 Cache no cliente após sair da Casa ou trocar de conta

| ID | Ameaça | Mitigação esperada | Estado |
|---|---|---|---|
| C-01 | **Chave do cache sem identidade:** `['estatisticas','resumo']` não inclui usuário nem Casa. Se o `queryClient` não for esvaziado em **toda** troca de sessão, o usuário B vê por instantes (e por até 5 min no cache, mais o `staleTime` de 30 s) os números do usuário A | Esvaziar todo o cache (`queryClient.clear()`) em logout, expiração (401), exclusão de conta, **login e cadastro** e troca de e-mail/senha com novo token; e/ou incluir `usuarioId` e `casaId` na chave. Hoje `useIniciarSessao` apenas faz `setQueryData` e **não limpa** antes de entrar um novo usuário. Ver F-11 | **FALHA a verificar** (F-11) |
| C-02 | **Sair da Casa / ser removido:** `useSairDaCasa` remove só `CHAVE_MEMBROS` e `CHAVE_ASSINATURA`; o ADR (D7) manda **invalidar** `['estatisticas']`. `invalidate` mantém o dado antigo na tela até a nova resposta chegar; o usuário (agora numa Casa nova, Individual vazia) **vê os números da Casa que deixou** | Para troca de Casa use `removeQueries({ queryKey: ['estatisticas'] })` (e `['produtos']`, `['tags']`), não `invalidateQueries`. Contrato e ADR dizem "invalide" para tudo, o que é insuficiente aqui. Ver F-11 | **FALHA** (F-11) |
| C-03 | O membro **removido por outro** (ADMIN remove o EDITOR) continua com a aba aberta e o cache da Casa até a próxima chamada; a próxima chamada já usa a nova Casa/401 do servidor | Servidor está correto (E-06). No front, ao receber 401/403 limpar o cache todo; ao mostrar o novo resultado, não misturar com o antigo | VERIFICAR |
| C-04 | Duas abas: logout na aba 1, a aba 2 mantém dados na memória e o token no `localStorage` | Ouvir o evento `storage` da chave do token e esvaziar o cache da outra aba | VERIFICAR (hoje: ver `sessao`) |
| C-05 | Computador compartilhado: dados no HTTP cache/bfcache do navegador | `Cache-Control: no-store` (já previsto) nas duas rotas, montado **antes** do router para valer em erro e `HEAD` (F-05); sem persistência do TanStack Query em `localStorage` (não adicionar `persistQueryClient`) | OK/VERIFICAR |
| C-06 | Token no `localStorage` (`keepit.token`) lido por XSS junto com os números | Mitigações já tratadas em M1 (CSP, sem HTML injetado); M4 só renderiza **texto** (nomes de produto/tag) com escape padrão do React; proibido `dangerouslySetInnerHTML` nas telas 05/10/17 | VERIFICAR |
| C-07 | Dado adulterado em trânsito | HTTPS em produção (D/DevOps) | OK |

---

## 5. Integridade do valor exibido (relevante a segurança)

| ID | Ameaça | Mitigação esperada | Estado |
|---|---|---|---|
| I-01 | O ADR (D3) deixa o front formatar com `Intl.NumberFormat.format("string")`. Navegadores sem o suporte a string numérica (versões antigas do Safari/Firefox) convertem a string em `Number` **em silêncio** e arredondam acima de 2^53: o patrimônio fica errado sem nenhum aviso | Formatar **sem `Number`** para a parte inteira (agrupar por regex sobre a string) e **teste obrigatório** com `"99999999999999999999.99"`. Tratar `Intl` com string como otimização opcional | **FALHA de design** (F-12) |
| I-02 | `unidades` via `SUM(quantidade)::float8`: seguro hoje (≤ 10^6 por linha × linhas), mas `COUNT`/`SUM` em `::int` estoura em 2^31 | `COUNT(*)::int` ok até 2,1 bi; `unidades` como `float8` ou `bigint` com cast para string se o teto de produtos subir | OK; observação |
| I-03 | `dataCompra` do tipo `Date` serializado com `toISOString()` muda o dia por fuso | Devolver `to_char(data_compra, 'YYYY-MM-DD')` ou formatar sem fuso (já existe `lib/datas.ts`) | VERIFICAR |
| I-04 | Percentual de armazenamento com `limiteBytes = 0` | Front mostra "—" quando o divisor é zero (já previsto para o total; **não** previsto para `limiteBytes`) | **Lacuna menor** (F-13) |

---

## 6. Falhas de design no contrato e no ADR 0004

Ordenadas por gravidade. **[BLOQUEANTE]** deve ser decidido pelo Arquiteto antes de o Back-end e o Front-end implementarem as histórias 2.1.1, 2.2.1 e 2.2.2.

| # | Gravidade | Falha | Onde | Recomendação |
|---|---|---|---|---|
| F-11 | **[BLOQUEANTE]** | O cache do cliente não é isolado por conta/Casa e o ADR manda só **invalidar** ao sair/ser removido da Casa. Invalidar não apaga: os números da Casa antiga continuam na tela (e o `useIniciarSessao` não limpa o cache antes de um novo login). Vazamento entre contas/Casas no mesmo navegador. | ADR 0004 D7; contrato seção 1 ("Cache"); `features/auth/hooks.ts`, `features/casa/hooks.ts` | Trocar para **remoção** (`removeQueries`/`queryClient.clear()`) em sair/remover da Casa, login, cadastro, logout, 401. Incluir `casaId`/`usuarioId` na chave (`['estatisticas', casaId, 'resumo']`). Acrescentar teste (RTL): login do usuário B após A não mostra números de A. |
| F-01 | **[BLOQUEANTE]** | Meta e medições valem para 10.000 produtos, mas **nada limita** produtos, tags ou vínculos por Casa. O risco R-M4-3 só olha usuários simultâneos, não o tamanho que um EDITOR consegue criar. | ADR D4, R-M4-2/3, contrato seção 6 | Definir teto (RN no M3 e no contrato) ou aceitar formalmente com medição a 100.000 produtos. |
| F-02 | **[BLOQUEANTE]** | A transação `REPEATABLE READ` só prevê `timeout` e `maxWait`; **falta `statement_timeout`** (`SET LOCAL`) e o que a API responde quando o pool está cheio (503 genérico, não 500 com detalhe). Uma consulta lenta ocupa a conexão e derruba todas as Casas. | ADR D5, R-M4-4 | Acrescentar no ADR: `SET LOCAL statement_timeout`, `maxWait` ≤ 1 s, resposta 503 `{ error }` e teste de carga da QA (50 requisições simultâneas). |
| F-03 | Alta | A agregação por tag junta `produto_tag` sem exigir `tag.casa_id = produto.casa_id`. A segurança depende de o M3 nunca criar vínculo cruzado. | ADR D2 (`valorPorTag`, `tagMaisComprada`) | Exigir a condição no JOIN (defesa em profundidade) e um teste com vínculo cruzado inserido direto no banco. |
| F-04 | Alta | `renovacao` vai a todos os papéis com a justificativa "é o mesmo dado de `Perfil.assinatura`", não verificada. Se for falsa, o M4 amplia o acesso a dado de cobrança. | ADR D1 (Q9); contrato 3.1 | O Arquiteto confirma `Perfil.assinatura` em `m1-auth.md`. Se o LEITOR/EDITOR não recebe hoje, devolver `renovacao: null` a eles (ou só `status`). |
| F-05 | Média | `semCache` é aplicado **por rota** (decisão do ADR: "como nas demais rotas"), mas `app.ts` só o monta globalmente para `/auth` e `/me`. Esquecer o middleware numa das duas rotas (ou no 401/500 de `HEAD`/erros) deixa a resposta cacheável. | ADR D6; `app.ts` | Montar `app.use('/estatisticas', semCache)` em `app.ts`, como em `/auth` e `/me`. Teste que confere o cabeçalho em 200, 401 e 429. |
| F-12 | Média | A formatação monetária "com `Intl` sobre string" é insegura em navegadores sem suporte, e o erro é silencioso. | ADR D3 | Especificar formatador próprio por manipulação de string; `Intl` só como alternativa; teste com 20 dígitos obrigatório. |
| F-10 | Média | O contrato garante "nunca negativo" e `^\d+\.\d{2}$`, mas só o Zod do M3 garante entrada válida; o banco não tem `CHECK`. | Contrato seção 1; `schema.prisma` | Migration (Arquiteto) com `CHECK (preco >= 0 AND quantidade >= 1)`; validar a **resposta** com Zod e responder 500 genérico se o formato falhar. |
| F-06 | Média | O contrato dá o patrimônio a todo LEITOR sem registrar isso como decisão de privacidade; o convite não avisa o convidado do que ele verá. | Contrato seção 5; UC017/UC027 | PO registra o risco aceito e a tela de papéis/convite deixa claro "Leitor vê valores e totais". |
| F-07 | Baixa | O limite global de 120/min é **por IP**; não protege contra vários IPs e pune NAT. D6 do ADR é aceitável no MVP somente se F-01 e F-02 estiverem fechados. | ADR D6 | Registrar a premissa. Backlog: `limitar({ porUsuario: true })` nas duas rotas. |
| F-08 | Baixa | `valorPorTag` e `tagMaisComprada` repetem o mesmo `JOIN/GROUP BY`; é o maior custo da tela 10. | ADR D2 | Derivar a tag mais comprada do mesmo conjunto (CTE) ou do conjunto completo antes do `LIMIT 50`. |
| F-09 | Baixa | `make seed-volume` é "só local", mas a proteção prevista é só `NODE_ENV != production`; um `.env` apontando ao Neon de dev aceitaria o volume. A conta `volume@keepit.local` tem senha conhecida. | ADR D8 | Recusar se o host de `DATABASE_URL` não for o do compose; senha da conta lida de variável, não fixa em código. |
| F-13 | Baixa | Percentual de armazenamento sem proteção para `limiteBytes = 0`. | Contrato seção 1 | Acrescentar à regra: divisor zero mostra "—". |
| F-14 | Baixa | A matriz do contrato diz "usuário de outra Casa → 200" e "não há 403". Mas `autenticar` responde **403 `SEM_PERMISSAO`** para usuário sem Casa (estado possível após exclusão/remoção). O contrato, os testes e o front (tratamento de erro) ignoram esse caso. | Contrato seções 3 e 5; `autenticar.ts` | Documentar o 403 `SEM_PERMISSAO` nas duas rotas e testá-lo. |

---

## 7. CHECKLIST verificável

Cada item é verificável por teste automatizado, grep ou revisão objetiva. Marque na revisão de código/QA.

### 7.1 Back-end (Controller e Model)

- [x] **B1** `grep -rn "queryRawUnsafe\|Prisma.raw\|executeRawUnsafe" backend/src/modules/estatisticas` não retorna nada; todo SQL usa `Prisma.sql`.
- [x] **B2** Nenhum arquivo do módulo lê `req.query`, `req.params`, `req.body` ou `req.headers` além de `authorization` (grep).
- [x] **B3** O único parâmetro de cada consulta é `casaId` de `usuarioDaRequisicao(req)`; cada SQL contém `casa_id = ${casaId}` (teste unitário do service com espião no `$queryRaw` ou revisão linha a linha).
- [x] **B4** O JOIN com `tag` exige `tag.casa_id = produto.casa_id` (F-03); teste com vínculo cruzado inserido direto no banco: a tag alheia **não** aparece.
- [x] **B5** `autorizar(...QUALQUER_PAPEL)` e `autenticar` nas duas rotas; `GET` sem token = 401; token de usuário sem Casa = 403 (F-14).
- [ ] **B6** `semCache` montado em `app.ts` para `/estatisticas`; cabeçalho `Cache-Control: no-store` presente em 200, 401, 403 e 429.
- [ ] **B7** Transação com `isolationLevel: 'RepeatableRead'`, `timeout`, `maxWait` e `SET LOCAL statement_timeout` definidos (F-02); teste forçando `pg_sleep` maior que o limite devolve erro controlado (sem texto de SQL) e libera a conexão.
- [ ] **B8** Schema Zod de **resposta** `.strict()`, com regex `^\d+\.\d{2}$` para dinheiro; mapeamento campo a campo (sem spread de linha do banco).
- [x] **B9** Nenhum campo de `descricao`, `adicionadoPor`, fotos, e-mail ou nome de membro na resposta (teste compara `Object.keys` recursivamente com a lista do contrato).
- [x] **B10** `renovacao` conforme decisão de F-04 (teste por papel: ADMIN, EDITOR, LEITOR).
- [x] **B11** Valores no teto (`9999999999.99 × 1000000`, 10.000 linhas) devolvem a soma **exata** como string; nenhum `Number(`/`parseFloat`/`Decimal` no caminho do dinheiro (grep).
- [x] **B12** `dataCompra` no formato `YYYY-MM-DD` sem deslocamento de fuso (teste com data de borda e `TZ` diferente).
- [x] **B13** Erro de banco forçado devolve 500 genérico (`{ error, message }` sem SQL, sem nome de tabela, sem valor de parâmetro) e nada de produto/tag nos logs.
- [x] **B14** `POST/PUT/PATCH/DELETE /estatisticas` e `GET /estatisticas/x` respondem 404 do `rotaNaoEncontrada`.
- [x] **B15** Nenhuma escrita: o módulo não importa `auditoria` nem usa `create/update/delete` do Prisma (grep).

### 7.2 Testes de isolamento e papéis (QA)

- [ ] **Q1** Duas Casas com produtos e tags de **mesmo nome, data e preço**; cada rota e **cada campo** (`maiorGasto`, `tagMaisComprada`, `valorPorTag`, `semTag`, `maisAntigos`, `tags`, `membros`, `armazenamento`) devolve só a própria Casa; mudar a Casa B não altera a resposta da A.
- [ ] **Q2** Casa B vazia, Casa A grande: B recebe zeros, `null` e listas vazias (sem erro, sem NaN, sem total global).
- [x] **Q3** Mesma requisição com `?casaId=<outra>&tagId=&limite=1000&periodo=...`: resposta **idêntica** à sem query.
- [ ] **Q4** Matriz: sem token 401; token vencido 401 `SESSAO_EXPIRADA`; token pós-logout 401; ADMIN, EDITOR e LEITOR 200 nas duas rotas.
- [ ] **Q5** Usuário removido da Casa A e movido para a B: a próxima chamada com o **mesmo token** devolve os números da B.
- [ ] **Q6** Usuário com exclusão solicitada e usuário sem Casa: 401 e 403 respectivamente.
- [ ] **Q7** Teste cruzado: `valorTotal` de `/resumo` = de `/estatisticas` = soma de `preco × quantidade` da lista do M3.

### 7.3 Desempenho e negação de serviço (QA e DevOps)

- [ ] **D1** Medição pela API com 10.000 produtos/200 tags: p95 < 500 ms por rota (RNF06); repetir com 10× o volume e registrar em `docs/qa/` (F-01).
- [x] **D2** 50 requisições simultâneas às duas rotas: nenhuma 500; excesso recebe 503/429 controlado e o pool volta ao normal (F-02).
- [ ] **D3** Teto de produtos/tags por Casa aplicado no M3 e documentado (F-01), ou aceite formal do PO com a medição.
- [ ] **D4** `make seed-volume` recusa `NODE_ENV=production` **e** host de banco que não seja o do compose; a conta de volume não tem senha fixa no código (F-09).
- [ ] **D5** `EXPLAIN` das consultas não usa `Seq Scan` em `produto` com a Casa grande (apenas o índice de `casa_id`).

### 7.4 Front-end e cache

- [ ] **F1** Teste RTL: A faz login e vê números; logout; B faz login: nenhum número de A aparece em nenhum momento (nem por 1 renderização).
- [ ] **F2** Teste: `useSairDaCasa` e remoção de membro **removem** (não só invalidam) `['estatisticas']`, `['produtos']`, `['tags']`; a tela não mostra o número antigo enquanto carrega (F-11).
- [ ] **F3** `queryClient.clear()` em logout, 401, exclusão de conta **e login/cadastro**; chave inclui `casaId` (ou há `clear` equivalente).
- [ ] **F4** Logout em uma aba esvazia o cache da outra (evento `storage`).
- [x] **F5** Não existe `persistQueryClient`, `localStorage` ou `sessionStorage` guardando respostas de `/estatisticas` (grep).
- [x] **F6** Nomes de produto/tag renderizados como texto; `grep dangerouslySetInnerHTML frontend/src` sem ocorrência nas telas 05/10/17; teste com `<img src=x onerror=...>` como nome.
- [x] **F7** Formatador monetário sem `Number` na parte inteira; teste com `"99999999999999999999.99"` e `"0.00"` (F-12).
- [x] **F8** Percentuais com divisor zero (`valorTotal` = 0 e `limiteBytes` = 0) mostram "—", sem `NaN`/`Infinity` (F-13).
- [ ] **F9** Casa vazia mostra estado vazio; erro de rede mostra "Tentar de novo" sem exibir dado de outra consulta.

### 7.5 Processo

- [ ] **P1** O Arquiteto responde F-01, F-02, F-04 e F-11 no ADR 0004 (ou ADR de revisão) antes da implementação.
- [ ] **P2** PO registra o risco aceito F-06 (LEITOR vê valores) e F-07 (limite por IP).
- [ ] **P3** `npm audit` sem alta/crítica nas dependências novas (nenhuma é esperada para o M4).
- [ ] **P4** Contrato atualizado na mesma tarefa de qualquer mudança (403 `SEM_PERMISSAO`, `renovacao` por papel, invalidação vs remoção, teto).

---

## 8. Decisões que ficam com o PO

| Item | Decisão pedida |
|---|---|
| F-06 | Aceitar que o LEITOR vê o patrimônio e a cobrança resumida? Sim/não e texto de aviso no convite |
| F-01 | Teto de produtos e tags por Casa (valor) ou aceite do risco com a medição de 10× |
| F-07 | Manter limite global por IP no MVP |

## 9. Conclusão

O desenho do M4 é sólido nos pontos principais: a Casa vem só do token, não há entrada, o SQL é parametrizado, o dinheiro não passa por `Number` e a resposta é `no-store`. As três falhas **bloqueantes** são de borda e não de núcleo: **(F-11)** o cache do cliente vaza números entre contas/Casas porque a chave não tem identidade e o ADR manda invalidar em vez de remover; **(F-01)** não há teto de tamanho por Casa, então a meta de 15 ms não é garantida; **(F-02)** a transação `REPEATABLE READ` não tem `statement_timeout`, e uma consulta lenta pode esgotar o pool de todas as Casas. Em seguida vêm `renovacao` para todos os papéis (F-04, suposição não conferida) e o JOIN de tags sem `casa_id` (F-03).

---

## 10. Resultado da revisão de código (AppSec, Sprint 4, 2026-11-15)

Revisão de `backend/src/modules/estatisticas/*` (service, controller, routes, schema), `middlewares/autenticar.ts`, `sem-cache.ts`, `limitar.ts`, `app.ts`, e `frontend/src/features/estatisticas`, `lib/format.ts`, `lib/sessao.ts`, `features/auth|casa|assinatura|produtos/hooks.ts`. Provas executadas contra a API local (Casa demo com 21 produtos e Casa de carga com 10.000 produtos e 200 tags).

**Veredito: APROVADO (sem crítica nem alta explorável).** Há 3 médias e 3 baixas, listadas abaixo. Os três "bloqueantes" do modelo de ameaças ficaram assim: F-11 (cache) **parcialmente** fechado (sair da Casa remove `['estatisticas']`, mas ainda há vazamento entre contas em duas abas e produtos/tags não são removidos); F-01 e F-02 **não fechados no código**, mas sem impacto demonstrável no volume de 10.000 produtos (41 ms) e atrás de limites de escrita; viram média com aceite do PO.

### Provas

| Teste | Resultado |
|---|---|
| `grep queryRawUnsafe/Prisma.raw/executeRawUnsafe` no módulo | nenhum uso (B1) |
| `grep req.query/params/body/headers` no módulo | nenhum uso (B2) |
| Leitura linha a linha de 7 consultas | todas com `casa_id = ${casaId}` vindo de `usuarioDaRequisicao`; JOINs de tag com `p.casa_id = t.casa_id` (F-03 fechado) |
| Demo x carga: `valorPorTag` de uma Casa contém id de tag da outra? | não; totais independentes (19582.70 x 1034554994459.48) |
| `?casaId=<outra>&tagId=1&limite=1000&periodo=x` | resposta idêntica à sem query, byte a byte (Q3) |
| Sem token / token inválido / `HEAD` / `GET /estatisticas/x` / `POST /estatisticas` | 401 / 401 / 200 / 404 / 404, todos com `Cache-Control: no-store` |
| 50 requisições simultâneas a `/estatisticas` (Casa de 10.000 produtos) | 50 x 200 em 255 ms |
| Latência com 10.000 produtos e 200 tags | completa 41 ms, resumo 6 ms (uma amostra, a QA mede p95) |
| `renovacao` | mesmo dado que `Perfil.assinatura` (`m1-auth.md`, `GET /me`, todos os papéis); F-04 deixa de ser falha |
| `dangerouslySetInnerHTML`/`innerHTML`, `persistQueryClient`, `sessionStorage` no front | nenhum; `formatDinheiro` e `percentualDe` usam BigInt (F-12 fechado); `limiteBytes <= 0` tratado (F-13 fechado) |
| `npm audit --omit=dev` | frontend: 0; backend: 3 altas, todas `deepmerge-ts` via `prisma` (ver achado M3) |

### Achados

- **M1 (média, A04/A01, F-11 residual):** o cache do TanStack Query não é esvaziado em login/cadastro (`features/auth/hooks.ts:15-20`) nem quando outra aba encerra a sessão (`lib/sessao.ts:55-62`: o evento `storage` só reavisa, não limpa). Duas abas no mesmo navegador: A sai na aba 1; na aba 2 o cache de A fica em memória por até 5 min; B entra na aba 2 e vê por um instante os números e produtos de A (dados `stale` são mostrados enquanto refaz a consulta). `useSairDaCasa` (`features/casa/hooks.ts:44-55`) remove `estatisticas`, membros e assinatura, mas não `['produtos']`, `['tags']` nem `CHAVE_PERFIL` de forma a descartar detalhes e URLs de foto da Casa antiga. Correção: `queryClient.clear()` em `useIniciarSessao` antes do `setQueryData` e quando o evento `storage` indicar token removido ou trocado; `qc.clear()` (mantendo o perfil novo) em `useSairDaCasa`; incluir `casaId` nas chaves como defesa; teste RTL F1/F2.
- **M2 (média, A04, F-02):** transação `REPEATABLE READ` só com `maxWait` 5 s e `timeout` 10 s (`estatisticas.service.ts:17-21`), sem `SET LOCAL statement_timeout`. Uma consulta lenta ocupa a conexão por até 10 s e, com o pool pequeno do Neon, pode esgotar o pool de todas as Casas; o resultado é 500 genérico (sem vazamento de SQL). Correção: `await tx.$executeRaw`SET LOCAL statement_timeout = 3000`` no início das duas rotas, `maxWait` ≤ 1 s, mapear timeout/espera de pool para 503 e acrescentar teste com `pg_sleep` (B7).
- **M3 (média, A06, dependências):** `npm audit --omit=dev` no backend: 3 altas (`deepmerge-ts` < 8.0.0, GHSA-ggr8-5vv4-36mx, esgotamento de pilha) via `prisma`/`@prisma/config`. `prisma` é só `devDependencies`, a CLI lê a configuração do próprio projeto e não recebe entrada de usuário; sem caminho de exploração na API. Mesma situação da Sprint 3. Correção: planejar a atualização para a versão corrigida do Prisma (hoje apontada como a 7.x, mudança com quebra) em sprint própria e garantir que a imagem de produção instale com `--omit=dev`.
- **B1 (baixa, F-01):** continua sem teto de produtos, tags ou vínculos por Casa no M3 (nada mudou no schema). Com 10.000 produtos a consulta custa 41 ms; o crescimento é linear e o abuso é limitado por 60 `POST /produtos`/min por usuário. Correção: o PO assina o teto (ex.: 20.000 produtos e 500 tags) ou aceita o risco com medição a 10x pela QA (D1/D3).
- **B2 (baixa, F-10/B8):** sem `CHECK (preco >= 0 AND quantidade >= 1)` no banco (`d produto` confirma) e a resposta não é validada com o schema Zod em produção (`estatisticas.controller.ts:8-13`; o schema não usa `.strict()`). Valor negativo por script/seed passaria ao cliente. Correção: migration do Arquiteto com `CHECK` e `schema.parse` da resposta no controller com erro 500 genérico.
- **B3 (baixa, F-05/F-09):** (a) a resposta 429 do limitador global sai antes do router e portanto sem `no-store` (`app.ts:30` e `estatisticas.routes.ts:10`); sem dado, só higiene: montar `app.use('/estatisticas', semCache)` em `app.ts`. (b) `backend/scripts/carga.ts:22,116` fixa a senha `keepit-carga-123` e só recusa `NODE_ENV=production`: um `.env` apontando a um banco remoto aceitaria a carga. Correção: recusar quando o host de `DATABASE_URL` não for o do compose e ler a senha de variável.

### Observação sobre o 403

`autenticar` responde `403 SEM_PERMISSAO` ao usuário sem Casa (F-14); o contrato do M4 ainda diz "não há 403". Documentar (P4).
