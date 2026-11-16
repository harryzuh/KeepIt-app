# Quadro da sprint 1 — Fundação + M1 (Autenticação e Conta)

Legenda de status: A fazer · Em andamento · Em revisão · Em QA · Aceita · Aceita com ressalvas · Rejeitada.
Aceite do PO da sprint 1 em 15/11/2026: 4 aceitas, 7 aceitas com ressalvas, 1 rejeitada (8.2). Detalhes em [sprint-1-relatorio.md](sprint-1-relatorio.md).
**Fechamento (15/11/2026):** os defeitos bloqueantes foram corrigidos e a 8.2 foi reaceita. Resultado: 5 aceitas e 7 aceitas com ressalvas; `make check` (back 124, front 26) e `make e2e` (26/26) passando.
Escopo: telas 01, 02, 03, 04, 16, 18, 19, 20, 21 · UC001 a UC015 · Projeto Linear 1.x e 8.x · RF32 (Casa Individual no cadastro).
Fora desta sprint: M2 a M5 (além do mínimo necessário ao M1), RF29 (contato, UC032) e foto de perfil.

## Histórias

| Ordem | História | Linear | UCs | Responsável (camadas) | Status | Observações |
|---|---|---|---|---|---|---|
| 1 | [Fundação de autenticação, sessão e shell](m1/1.0-fundacao-autenticacao-e-shell.md) | 1.0 | UC004, UC012 | Arquiteto → Back-end + Front-end + DevOps | Aceita com ressalvas | CI corrigido (segredos de 32+ caracteres, CODIGO_SECRET, typecheck e npm audit). D2 fechado: proxy `/api` do Vite em dev, CORS e rate limit ajustados no compose, contorno do E2E removido. CSP aplicada no build. Pendente: critério 8 (360/768/1440 px) sem verificação visual; token em localStorage (ACH-04). |
| 2 | [Cadastro com Casa Individual automática](m1/1.2-cadastro-com-casa-automatica.md) | 1.2, 6.5 | UC008, UC009 | Back-end → Front-end | Aceita | Critérios 1–12 cobertos por testes do back (123) e E2E. |
| 3 | [Login](m1/1.1-login.md) | 1.1 | UC004, UC005 | Back-end → Front-end | Aceita | Mensagem genérica, 429 e conta com exclusão solicitada verificados. |
| 4 | [Boas-vindas e navegação pública](m1/1.0.1-boas-vindas-navegacao-publica.md) | 1.0.1 | UC001, UC002 | Front-end | Aceita | Telas públicas e redirecionamento verificados no E2E. |
| 5 | [Termos de uso e privacidade](m1/9.2.1-termos-de-uso.md) | 9.2.1 | UC003 | Front-end + AppSec (texto) | Aceita com ressalvas | Texto-base em português; AppSec/LGPD ainda precisa revisar e definir o canal de contato real (critério 3). |
| 6 | [Tela Conta, perfil e dados cadastrais](m1/8.1-perfil-e-dados-cadastrais.md) | 8.1 | UC015 | Back-end → Front-end | Aceita com ressalvas | Foto de perfil fora da sprint (backlog). A tela 20 ao trocar o e-mail foi corrigida junto com a 8.2. |
| 7 | [Encerrar sessão](m1/1.4-encerrar-sessao.md) | 1.4, 8.4 | UC012 | Back-end → Front-end | Aceita | Logout encerra todos os dispositivos (decisão A1). Falha mantém a sessão. |
| 8 | [Recuperação de senha por código](m1/1.3-recuperacao-de-senha.md) | 1.3 | UC006, UC007, UC009 | Back-end → Front-end | Aceita com ressalvas | Enumeração de contas (ACH-10) formalmente aceita pelo PO. Códigos pendentes não são invalidados na troca de senha (ACH-09.5). |
| 9 | [Alteração de senha](m1/1.5-alteracao-de-senha.md) | 1.5 | UC010, UC011 | Back-end → Front-end | Aceita com ressalvas | Janela de 1 s no corte de sessão (A1) e senha em caracteres, não bytes (ACH-09.1) como pendências baixas. |
| 10 | [Alteração de e-mail por código](m1/8.2-alteracao-de-email.md) | 8.2 | UC015 | Arquiteto → Back-end → Front-end | Aceita | Reaceita no fechamento: a tela 20 pede a senha atual só quando o e-mail muda, trata SENHA_INCORRETA no campo e grava o token novo da confirmação. 4 testes de unidade novos e E2E m1-conta verde (inclui senha errada e recarregar após a troca). Contrato 3.8/3.9 atualizado. |
| 11 | [Exclusão de conta (solicitação)](m1/8.3-exclusao-de-conta.md) | 8.3 | UC013, UC014 | Back-end → Front-end | Aceita com ressalvas | Efeitos sobre assinatura e membros ficam como gancho M2/M5. E2E de exclusão rodando e verde após a correção da 8.2. |
| 12 | [Rotina de exclusão definitiva em até 24 h](m1/8.3.2-rotina-exclusao-definitiva.md) | 8.3.2 | UC013, UC014 | Back-end + DevOps | Aceita com ressalvas | PRAZO_EXCLUSAO_HORAS reduzido para 23: com a rotina horária, tudo é apagado em até 24 h (teste de limite em 23,5 h). Falha por titular de assinatura (ACH-08) é latente até o M5. |

Fluxo de cada história: PO → Arquiteto → Back-end / Front-end / AppSec / DevOps → QA → aceite do PO.
Arquivos separados por camada: nunca dois agentes no mesmo arquivo ao mesmo tempo.

## Decisões do PO (escopo e interpretação da documentação)

1. **Casa automática (RF32, M2):** implementada dentro do cadastro (história 1.2), em transação única; nome "Casa de <primeiro nome>"; plano Individual = Casa sem assinatura (não cria `Assinatura`). Só o necessário do M2.
2. **`GET /me` (e `PATCH /me` para nome):** não há `GET /me` na Tabela 17, mas as telas 05, 16 e 20 precisam dele (RF18). Incluído como contrato novo; o Arquiteto deve registrar na Tabela 17.
3. **Telas 05 e menu de navegação:** versão **mínima** (saudação, nome da Casa, papel, acesso à Conta). O conteúdo do Início é M4; Produtos/Família/Planos ficam desabilitados ou ocultos até seus módulos.
4. **Termos de uso (UC003, RF30):** embora esteja na área 9.2 do Linear, é tela pública do M1 e faz parte do escopo. Texto estático revisado pelo AppSec; sem checkbox obrigatório no cadastro, apenas aviso com link.
5. **Fora da sprint, registrado:** **foto de perfil** do UC015 (sem campo no schema; depende de armazenamento do M3), **RF29/UC032 contato** (não está em UC001–UC015; a entrada de contato na tela 16 fica oculta), **assinatura vencida no `/internal/jobs`** (M5).
6. **Logout (1.4) e 8.4** são a mesma funcionalidade: uma só história.
7. **Exclusão de conta:** o M1 faz bloqueio imediato + apagamento em 24 h. Os efeitos sobre assinatura (cancelar) e outros membros (Casa própria) dependem de M2/M5: o aviso do UC013 é implementado, os efeitos ficam como gancho rastreado.
8. **Recuperação de senha:** segue o UC006 (404 para e-mail inexistente), apesar do risco de enumeração de contas; mitigado com rate limit e sinalizado ao AppSec. Redefinir senha não autentica e invalida as sessões.
9. **Mensagem de login genérica** (não revela se o e-mail existe), conta com exclusão solicitada é tratada como credencial inválida.

## Pontos para o Arquiteto decidir antes de codar (bloqueiam histórias indicadas)

| # | Questão | Histórias afetadas | Proposta do PO |
|---|---|---|---|
| A1 | Como invalidar sessões/JWT no logout, na redefinição/alteração de senha e na exclusão (o schema não guarda sessão)? | 1.0, 1.3, 1.4, 1.5, 8.3 | Claim `iat` comparado a um campo de "sessões válidas desde" no `Usuario` (exige migration) ou JWT curto sem refresh |
| A2 | Onde guardar o **e-mail pendente** da troca por código (`CodigoVerificacao` não tem o campo)? | 8.2 | Coluna `novoEmail` opcional em `CodigoVerificacao`; e definir os dois passos de `PATCH /me` (solicitar e confirmar) |
| A3 | Destino da Casa Individual e dos produtos quando o único membro é apagado | 8.3.2 | Remover a Casa vazia junto; Casa com outros membros permanece |
| A4 | Pré-validação do código de recuperação sem consumi-lo (tela 04 etapa 2 → 18) | 1.3 | Dispensar: o front guarda e-mail+código e valida tudo em `/auth/redefinir-senha` |
| A5 | Valores de rate limit e tempo de vida do JWT | 1.0 | Definir com AppSec (ex.: JWT de 1 a 8 horas) |


## Decisões do PO no aceite da sprint 1 (15/11/2026)

10. **Planos (preços e limites):** confirmados para o MVP INDIVIDUAL R$ 0,00 / 1 membro / 1 GB, FAMILIA R$ 19,90 / 6 / 20 GB e BUSINESS R$ 49,90 / 15 / 100 GB. Os valores de preço e o 1 GB do Individual são premissas do grupo e podem ser editados em `backend/src/lib/planos.ts` sem migration.
11. **ACH-10 (enumeração de contas):** risco **aceito formalmente** pelo PO para o MVP, conforme UC006 (404 em recuperar-senha, 409 no cadastro e na troca de e-mail), mitigado por rate limit por IP e e-mail e tentativas por código. Revisão obrigatória antes de produção pública, junto com o AppSec.
12. **Prazo de exclusão (RNF16):** reduzir `PRAZO_EXCLUSAO_HORAS` para 23 para que o pior caso com o job horário fique dentro de 24 h.
13. **Resolução de 1 s no corte de sessões (A1):** aceita no MVP; ajuste só se virar problema real.
14. **Pré-produção:** o aceite é para ambiente de desenvolvimento e homologação. Produção exige CSP (ACH-04), CI corrigido, `npm audit` limpo (ACH-06), revisão do texto dos Termos e canal real do titular (LGPD).


---

# Sprint 2 — M5 Planos e Assinatura + M2 Casa e Membros

Legenda de status: A fazer · Em andamento · Em revisão · Em QA · Aceita · Aceita com ressalvas · Rejeitada.
Escopo: telas 11, 12, 13, 14, 15, 22, 24 · UC018, UC019, UC028 a UC031, UC033 a UC037 · Projeto Linear 6.x e 7.x · RF12 a RF16, RF25 a RF28, RF37, RF38 e a cota do plano (base do RF39, usada pelo M3) · RNF05, RNF12, RNF13, RNF31.
Fora desta sprint: M3 e M4, UC032/RF29 (contato), convite com aceite, pagamento real.
Ordem de construção: M5 primeiro (base de limites), depois M2. Fluxo de cada história: PO → Arquiteto → Back-end / Front-end / AppSec / DevOps → QA → aceite do PO. Nunca dois agentes no mesmo arquivo ao mesmo tempo.

## Histórias

| Ordem | História | Linear | UCs | Responsável (camadas) | Status | Observações |
|---|---|---|---|---|---|---|
| 1 | [Cota de plano da Casa (plano vigente e limites)](m5/7.0-cota-de-plano-da-casa.md) | 7.0 | base UC028, UC033 | Arquiteto → Back-end | Aceita | Serviço `plano.service` testado (limites, GB binário, CANCELADA vencida = Individual). Pronto para o M3. |
| 2 | [Visualizar planos](m5/7.1-visualizar-planos.md) | 7.1, 7.1.1 | UC019, UC029, UC030 | Back-end → Front-end | Aceita | Tela 13 e `GET /planos` para todos os papéis, matriz de papéis testada. |
| 3 | [Método de pagamento simulado](m5/7.3-metodo-de-pagamento-simulado.md) | 7.3 | UC028 | Arquiteto → Back-end → Front-end | Aceita | Só marca e 4 dígitos gravados; gateway só aceita cartões de teste e é recusado em produção. Fechamento: a tela 14 coleta só número e validade, mostra o banner de cartão de teste, recusa cartão real ainda no cliente e tem mensagens para PAGAMENTO_INDISPONIVEL e CONFLITO_CONCORRENTE. `PAGAMENTO_SIMULADO` está documentado no `.env.example`, no compose e no SETUP. |
| 4 | [Assinar ou alterar plano (ADMIN)](m5/7.2-assinar-ou-alterar-plano.md) | 7.2 | UC028 a UC030 | Back-end → Front-end | Aceita com ressalvas | Troca, recusa 402, duplo clique e encaixe cobertos. PENDENTE não é gravado (cobrança síncrona em uma transação; efeito equivalente). Tela 14 mostra mensagem genérica para `PLANO_NAO_COMPORTA`. |
| 5 | [Cancelar e reativar assinatura](m5/7.4-cancelar-e-reativar-assinatura.md) | 7.4 | UC031 | Back-end → Front-end | Aceita | Cancelar e reativar (ADMIN) com auditoria e confirmação; benefícios até a renovação. |
| 6 | [Rotina expirarAssinaturas](m5/7.5-expirar-assinaturas-rotina.md) | 7.5 | UC031 | Back-end + DevOps | Aceita com ressalvas | Rotina idempotente, trava da Casa e retry; volta ao Individual, desvincula extras e mantém produtos. Fechamento: o workflow `jobs.yml` fica vermelho quando `falhas > 0`. Resta o risco fail-open se o cron parar. |
| 7 | [Assinar plano como membro (tela 24)](m5/7.6-assinar-plano-como-membro.md) | 7.6 | UC028 | Back-end → Front-end | Aceita | Tela 24, saída da Casa e Casa nova, limpeza de cache; duplo clique sem cobrança dupla. |
| 8 | [Visualizar membros da Casa](m2/6.1-visualizar-membros-da-casa.md) | 6.1 | UC018, UC037 | Back-end → Front-end | Aceita com ressalvas | E-mail só para ADMIN. `usuarioId` sequencial visível a todos (FP6, risco aceito). O `<p>` vazio de e-mail foi corrigido no fechamento (`email` opcional no tipo). |
| 9 | [Adicionar membro pelo ADMIN](m2/6.2-adicionar-membro.md) | 6.2 | UC033, UC034 | Arquiteto → Back-end → Front-end | Aceita com ressalvas | Limite do plano, transferência e concorrência testados. Adição direta sem aceite (FP1) e oráculo residual 404 x 409 com vaga, limitados por rate limit e auditoria. Desvio D7 confirmado. Fechamento: a tela 11 ganhou "Sair da Casa" para EDITOR e LEITOR (POST /casa/sair, com confirmação), a mitigação de R-M2-1 exigida pelo PO. |
| 10 | [Editar papel de membro](m2/6.4-editar-papel-de-membro.md) | 6.4 | UC034, UC036 | Back-end → Front-end | Aceita | ADMIN não atribuível, papel vale na próxima requisição, matriz testada. |
| 11 | [Remover membro](m2/6.3-remover-membro.md) | 6.3 | UC035 | Back-end → Front-end | Aceita | Confirmação na UI (RNF12), Casa própria criada, produtos mantidos sem autor. |
| 12 | [Editar nome da Casa](m2/6.0-editar-nome-da-casa.md) | 6.0 | RF32 | Arquiteto → Back-end → Front-end | Aceita | `PATCH /casa` só ADMIN, validação sem `<`, `>`, controle e Cf. |
| 13 | [Ganchos da exclusão de conta](m2/6.6-ganchos-exclusao-de-conta.md) | 8.3, 8.3.2 | UC013, UC014 | Arquiteto → Back-end → Front-end | Aceita com ressalvas | ACH-08 fechado; herdeiro promovido e aviso da tela 21 corrigido. Substitui o UC013 literal (decisão D8): UC013 e histórias 6.2/6.6 devem ser atualizados. |

Transversal (RNF31 e RNF05), exigido no aceite de cada história acima: toda rota nova tem teste de matriz ADMIN, EDITOR, LEITOR e outra Casa (404 para recurso de outra Casa, 403 para papel insuficiente, 401 sem token) e grava log de auditoria nas ações de plano, assinatura, cancelamento e membros. O AppSec revisa as regras de papel antes do aceite.

**Aceite do PO da Sprint 2 em 15/11/2026:** 7 aceitas e 6 aceitas com ressalvas, nenhuma rejeitada. `make check` (back 276, front 64) e `make e2e` (91/91) passando. Detalhes em [sprint-2-relatorio.md](sprint-2-relatorio.md). Aceite vale para desenvolvimento e homologação, não para produção.
**Fechamento (15/11/2026):** os 3 defeitos médios e o `<p>` vazio da tela 11 foram corrigidos. A 7.3 passou a Aceita, ficando 8 aceitas e 5 aceitas com ressalvas. `make check` (back 276, front 71) e `make e2e` (92/92) passando.

## Decisões do PO (escopo e interpretação) — Sprint 2

15. **Acesso às telas 13, 14 e 24 por qualquer papel:** o sitemap (1.1) diz "somente ADMIN", mas UC019, UC028 e RF38 dizem qualquer papel. Prevalecem os UCs e o RF; só a tela 15 e o cancelar/reativar são ADMIN.
16. **Plano Individual não tem botão Assinar:** voltar ao Individual é cancelar a assinatura (benefícios até a renovação).
17. **Reativar assinatura** (UC031, fluxo alternativo, e Tabela 17) entra na história 7.4.
18. **Contratos novos além da Tabela 17:** `GET /assinaturas/atual` (tela 15), método de pagamento (tela 14), `PATCH /casa` (nome). O Arquiteto registra em `docs/api/`.
19. **Pagamento simulado:** aprovado por padrão; recusa simulada por regra de teste (proposta: cartão terminado em 0000). Nunca se guarda número completo nem CVV.
20. **Troca de plano:** nova assinatura imediata, sem cálculo proporcional (proposta, Q3).
21. **Produtos de quem sai, é removido ou é transferido:** ficam na Casa de origem sem autor (decisão da sprint 1, item 11 do backlog).
22. **Quem não pode ser adicionado (6.2):** ADMIN de Casa com outros membros e titular de assinatura vigente (proposta, Q5).
23. **Convite com aceite** permanece no backlog; a adição é direta.
24. **Contato com a equipe (RF29)** segue oculto.

## Perguntas ao Arquiteto (precisam de decisão antes de codar)

| # | Questão | Histórias | Proposta do PO |
|---|---|---|---|
| Q1 | Quando o ADMIN exclui a conta (ou é transferido) e a Casa tem outros membros: o UC013 manda dar Casa própria a todos, mas os produtos ficariam sem Casa. Qual o destino da Casa antiga e dos produtos? E a Casa que fica vazia ao transferir seu único membro (6.2)? | 6.6, 6.2 | Promover o membro mais antigo (preferir EDITOR) a ADMIN, voltar a Casa ao Individual, dar Casa própria aos demais, manter a Casa e os produtos. Casa vazia é removida (A3). |
| Q2 | Estado da assinatura do titular que exclui a conta: diagrama 5.4 diz EXPIRADA, UC013 e Tabela 17 dizem cancelada. E `Assinatura.titularId` sem `onDelete` quebra a rotina de apagamento (ACH-08): anular o titular ou apagar o registro? | 6.6, 7.5 | EXPIRADA imediata (motivo TITULAR_EXCLUIDO); `titularId` opcional (migration) para manter o histórico. |
| Q3 | Troca de plano: o que acontece com a assinatura anterior (não há estado ENCERRADA) e há cálculo proporcional? | 7.2 | Anterior vira EXPIRADA com motivo TROCA; sem proporcional no MVP. |
| Q4 | Onde guardar o método de pagamento (RF15)? O schema só tem `refPagamento`. | 7.3, 7.2 | Tabela `MetodoPagamento` por usuário com marca e 4 últimos dígitos, sem PAN/CVV; migration. |
| Q5 | Adicionar à Casa alguém que é ADMIN de outra Casa com membros, ou titular de assinatura vigente: bloquear ou tratar? | 6.2 | Bloquear com `MEMBRO_NAO_TRANSFERIVEL`; permitir só ADMIN solo sem assinatura (Casa vazia removida). |
| Q6 | O papel e a Casa são lidos do banco a cada requisição ou ficam no JWT? Mudança de papel, remoção e transferência precisam valer na próxima requisição. | 6.2, 6.3, 6.4 | Ler `Membro` por requisição no middleware de papel; JWT só identifica o usuário. |
| Q7 | Ao assinar como membro (muda de Casa e papel), reemitir o token ou basta o front refazer `GET /me`? | 7.6 | Basta refazer `GET /me`, se Q6 for adotada. |
| Q8 | Ciclo de renovação simulado: a renovação ATIVA mantém o mesmo registro (avança `dataRenovacao`) ou cria nova linha? Qual a regra da recusa simulada? Duração do mês (30 dias ou calendário)? Há aviso antes da renovação? | 7.5, 7.2 | Mesmo registro, +1 mês de calendário; recusa simulada por cartão de teste; aviso de renovação só na tela 05. |
| Q9 | Códigos de erro novos (`PLANO_NAO_COMPORTA`, `PAGAMENTO_RECUSADO`, `ESTADO_INVALIDO`, `LIMITE_MEMBROS`, `MEMBRO_JA_NA_CASA`, `MEMBRO_NAO_TRANSFERIVEL`, `USUARIO_NAO_ENCONTRADO`, `AVISO_NAO_CONFIRMADO`) e nomes das ações de auditoria entram na seção 1.3 do contrato e em `ACOES_AUDITORIA`. Confirmar nomes e HTTP. | todas | Adotar os nomes das histórias; criar `docs/api/m5-m2.md`. |
| Q10 | Rate limit e privacidade de `POST /casa/membros` (descobre e-mails cadastrados, mesmo risco do ACH-10). Limitar por ADMIN? | 6.2 | Limite por usuário e por Casa; 404 mantido (UC033). |
| Q11 | Armazenamento usado: soma de `Foto.tamanhoBytes`. GB binário ou decimal? | 7.0 | GB binário (1024³); uso 0 até o M3. |


## Decisões do PO no aceite da sprint 2 (15/11/2026)

25. **Desvio D7 confirmado:** ADMIN solo cuja Casa tem produtos devolve `MEMBRO_NAO_TRANSFERIVEL`. Volta à proposta original só com o convite com aceite.
26. **Promoção do herdeiro (D8) substitui o UC013 literal:** o membro mais antigo (preferindo EDITOR) vira ADMIN e mantém Casa e produtos. UC013 e histórias 6.2/6.6 serão atualizados.
27. **Risco R-M2-1 (adição sem consentimento) aceito para desenvolvimento e homologação**, condicionado a `POST /casa/sair` (já existe) e à tela "Sair da Casa" na Sprint 3 (item obrigatório). Convite com aceite, ou aceite formal, antes de produção pública.
28. **`usuarioId` sequencial visível (FP6) e oráculo residual 404 x 409 com vaga:** riscos aceitos no MVP, a rever antes de produção.
29. **Pagamento real continua fora do MVP.** Produção exige `PAGAMENTO_SIMULADO=false`, o que desliga as assinaturas pagas; um gateway real é pré-requisito de lançamento.
30. **npm audit do backend (deepmerge-ts via Prisma):** risco baixo aceito; upgrade para Prisma 7 planejado.


---

# Sprint 3 — M3 Produtos e Tags

Legenda de status: A fazer · Em andamento · Em revisão · Em QA · Aceita · Aceita com ressalvas · Rejeitada.
Escopo: telas 05 (só produtos recentes e atalho de cadastro), 06, 07, 08, 09, 17 (só o que é do M3: lista, busca e botão de cadastro), 23 · UC016, UC020 a UC026 · RF03 a RF11, RF33 a RF36 e RF39 · Projeto Linear 3.x (produtos), 4.x (histórico) e 5.x (tags) · RNF05, RNF08, RNF09, RNF11, RNF12, RNF31.
Fora desta sprint: M4 (estatísticas e indicadores do Início), edição e exclusão de tags, convite com aceite, foto de perfil, RF29.
Ordem de construção: fundação e tags, fotos, cadastro e duplicidade, leitura, edição, exclusão, histórico. Fluxo de cada história: PO → Arquiteto → Back-end / Front-end / AppSec / DevOps → QA → aceite do PO. Nunca dois agentes no mesmo arquivo ao mesmo tempo. Contrato: `docs/api/m3-produtos.md` (criado na 3.0).

## Histórias

| Ordem | História | Linear | UCs | Responsável (camadas) | Status | Observações |
|---|---|---|---|---|---|---|
| 1 | [Fundação do M3 (contrato, schema, índices e storage)](m3/3.0-fundacao-m3-contrato-schema-e-storage.md) | 3.0 | base | Arquiteto → Back-end + DevOps | Aceita | ADR 0003, contrato `m3-produtos.md`, migration, índices `lower(nome)`, proxy `/s3` e CORS entregues. Q1 a Q11 respondidas no ADR. |
| 2 | [Criar e listar tags da Casa](m3/5.1-criar-e-listar-tags.md) | 5.0, 5.1, 5.2 | UC023 | Back-end → Front-end | Aceita | `GET/POST /tags`, 409 `TAG_EXISTENTE`, unicidade por Casa sem diferenciar caixa, NFC. Matriz de papéis testada. Editar e excluir tag no backlog (decisão 34). |
| 3 | [Upload de foto por URL assinada, formatos, tamanho e cota](m3/3.1.2-upload-de-foto-com-url-assinada-e-cota.md) | 3.1.2, 3.1.5 | UC021 | Back-end → Front-end + DevOps | Aceita | Tipo real, 5 MB, 3 fotos, cota (409), PUT pendente e cópia para chave definitiva, EXIF removido, teto de pendentes (429). Reteste do AppSec em 15/11/2026: FD1 e FD5 fechados (S4). Pendências só de produção: R-M3-1 (Content-Length no R2), `nosniff`, domínio do bucket e redação de `X-Amz-Signature` só em produção; recodificação no navegador não feita. |
| 4 | [Cadastrar produto](m3/3.1-cadastrar-produto.md) | 3.1, 3.1.1, 3.1.3 | UC020, UC022, UC023 | Back-end → Front-end | Aceita | Transação única com cota, tela 08, preço string, validação Unicode e piso de data. |
| 5 | [Verificação de duplicidade](m3/3.1.4-verificacao-de-duplicidade.md) | 3.1.4 | UC020 | Back-end → Front-end | Aceita | 409 `PRODUTO_DUPLICADO` sem URL (usa `fotoCapaId`), tela 09 com somar, cadastrar mesmo assim e cancelar; soma atômica. |
| 6 | [Listar, buscar e filtrar produtos](m3/3.2-listar-buscar-e-filtrar-produtos.md) | 3.2, 3.2.1, 3.2.2 | UC016, UC024 | Back-end → Front-end | Aceita | Busca por nome, filtro por tag, paginação (até 10.000), recentes na tela 05. Busca `contém` sem índice trigram (risco de volume). |
| 7 | [Detalhe do produto](m3/3.2.3-detalhe-do-produto.md) | 3.2.3 | UC024 | Back-end → Front-end | Aceita | Tela 07 com fotos de URL de 15 min, refaz a consulta se a foto falhar. Falha intermitente de teste corrigida de forma preventiva e não reproduzida em 9 execuções. |
| 8 | [Editar produto](m3/3.3-editar-produto.md) | 3.3, 3.3.1 a 3.3.3 | UC025, UC021, UC023 | Back-end → Front-end | Aceita | PATCH com fotos e tags, cota por saldo líquido, `substituiFotoIds` no upload-url (troca com cota cheia). |
| 9 | [Excluir produto](m3/3.4-excluir-produto.md) | 3.4, 3.4.1, 3.4.2 | UC026 | Back-end → Front-end | Aceita | Confirmação (RNF12), auditoria, limpeza no S3. Sem lixeira (decisão 41). |
| 10 | [Histórico de adições e alterações](m3/4.1-historico-de-adicoes-e-alteracoes.md) | 4.0, 4.1 | UC017 (parcial) | Back-end → Front-end | Aceita | Eventos CRIADO, ALTERADO e QUANTIDADE_SOMADA, com autor nulo se saiu da Casa. UC017 segue no M4. |
| 11 | [Aviso: produtos ficam na Casa](m3/3.5-aviso-produtos-ficam-na-casa.md) | 3.5 (proposto) | UC020, UC035 | Front-end | Aceita | Aviso dispensável no cadastro do EDITOR e texto da tela "Sair da Casa". Mitiga R-M2-1. |

Transversal (RNF31 e RNF05), exigido no aceite de cada história: toda rota nova tem teste de matriz ADMIN, EDITOR, LEITOR, outra Casa (404) e sem token (401), e grava auditoria nas ações de produto e tag. O AppSec revisa o upload (tipo real, tamanho, chave, URL assinada) antes do aceite.

## Decisões do PO (escopo e interpretação) — Sprint 3

31. **Cota excedida é 409, não 422:** a Tabela 17 diz 422, mas o `plano.service` já devolve 409 `COTA_EXCEDIDA` (Sprint 2). Vale o 409; o contrato do M3 corrige a Tabela 17.
32. **Histórico (RF11) = adições recentes (tela 05) + eventos do produto (tela 07).** UC017 é do M4 (dashboard); aqui entra só "últimos produtos adicionados".
33. **Tela 17 e tela 05:** só lista, busca, botão "Adicionar produto" e produtos recentes. Indicadores, valor total e armazenamento do Início são do M4. A tela 08 mostra o uso de armazenamento (RF39) a partir do `GET /me`.
34. **Tags:** só criar e listar (RF35, Tabela 17). Editar nome e excluir tag ficam no backlog. Unicidade por Casa sem diferenciar maiúsculas.
35. **Duplicidade só no cadastro (RF33).** Editar o nome para um já existente não bloqueia (Q6 para confirmar). Comparação é `lower(nome)` com espaços das pontas removidos; acentos não são normalizados.
36. **Somar à quantidade** soma só a quantidade; os demais campos do produto existente ficam como estão (Q2 para confirmar).
37. **Fotos:** até 3, JPEG/PNG pelo tipo real (assinatura dos bytes), 5 MB, envio direto ao S3 por URL assinada de 5 min; a API é a autoridade na confirmação (ao salvar). Foto não conta na cota se o produto não for salvo (limpeza de órfãs, Q4).
38. **Permissões:** LEITOR só consulta (GET); EDITOR e ADMIN criam, editam e excluem qualquer produto da Casa (RNF31).
39. **Limites propostos pelo PO** (o Arquiteto confirma): nome 120, descrição 1 000, quantidade até 1 000 000, até 10 tags por produto, preço até 9 999 999 999,99.
40. **Risco R-M2-1:** história 3.5 avisa o EDITOR de que os produtos ficam na Casa (no cadastro e na saída da Casa).
41. **Sem lixeira, sem desfazer e sem exclusão em massa** no MVP.

## Perguntas ao Arquiteto (precisam de decisão antes de codar)

| # | Questão | Histórias | Proposta do PO |
|---|---|---|---|
| Q1 | O que conta como "alteração" no histórico e onde guardar? | 4.1, 3.3, 3.4 | Qualquer mudança em nome, descrição, preço, quantidade, data, tags ou fotos, um evento por salvamento, com antes e depois; sem mudança, sem evento. Reusar `LogAuditoria` (`entidade = Produto`) em vez de tabela nova. |
| Q2 | "Somar à quantidade" com preço (ou tags e fotos) diferente: o que fazer? E se o produto existente sumiu entre o 409 e a escolha? | 3.1.4 | Soma só a quantidade e mantém preço e demais dados do existente; refaz a verificação se o original sumiu. Alternativa: preço médio ponderado (distorce M4). |
| Q3 | Como o S3 (SeaweedFS) limita o tamanho no envio: URL assinada PUT com `Content-Length` assinado ou POST com política `content-length-range`? Funciona no SeaweedFS local e na S3 de produção? | 3.1.2 | POST assinado com `content-length-range` e `Content-Type` fixos, se suportado; caso contrário PUT e conferência por HEAD na confirmação. |
| Q4 | Fotos órfãs (enviadas e nunca vinculadas) e falha ao apagar do S3: como limpar? Foto "pendente" conta na cota? | 3.1.2, 3.1, 3.4 | Chave com prefixo `pendentes/` e rotina horária no `/internal/jobs` que apaga o que passar de 1 h; só `Foto` gravada conta na cota; tabela ou marca de `remocao pendente` para falhas de exclusão. |
| Q5 | Leitura das fotos: bucket privado com URL assinada de leitura (curta) ou leitura por rota da API? Cache e custo? | 3.2, 3.2.3 | URL assinada de leitura de 1 h, gerada na listagem e no detalhe; nunca bucket público. |
| Q6 | Editar o nome para um já existente deve avisar ou bloquear? | 3.3, 3.1.4 | Não verificar na edição (RF33 é só cadastro). |
| Q7 | Paginação e ordenação da lista (e do histórico): por página ou cursor, tamanho padrão? | 3.2, 4.1 | `pagina` e `limite` (padrão 20, máx. 100), `total` na resposta; ordem por `dataCadastro` decrescente e `id` como desempate; ordens `nome` e `dataCompra` opcionais. |
| Q8 | Concorrência na edição (duas edições do mesmo produto) e na cota (dois envios juntos): travar a Casa, versão otimista ou última gravação vence? | 3.3, 3.1 | Trava da Casa só para fotos e cota (padrão do M2 e do M5), última gravação vence nos campos simples. |
| Q9 | Contrato novo: rotas além da Tabela 17 (`GET /tags`, `GET /produtos/:id/historico`, ordem recentes), campo `duplicado`, códigos `PRODUTO_DUPLICADO`, `TAG_EXISTENTE`, `ARQUIVO_INVALIDO`, `LIMITE_FOTOS`, `COTA_EXCEDIDA` (409, não 422) e ações de auditoria. | todas | Adotar os nomes das histórias e criar `docs/api/m3-produtos.md`; corrigir a Tabela 17. |
| Q10 | Rate limit de `upload-url` e do cadastro, e privacidade das chaves (prefixo da Casa, nome gerado pelo servidor). Preço e quantidade devem ser strings decimais no JSON? | 3.1.2, 3.1 | Limite por usuário e por Casa; chaves aleatórias com prefixo `casa/<id>/`; preço como string decimal. |
| Q11 | Exclusão de conta ou da Casa (ADMIN solo apagado, A3) deve remover as fotos do S3 (LGPD)? E o armazenamento deve ser recalculado? | 3.4, M2 | Sim: a rotina de exclusão definitiva apaga os objetos da Casa; a cota é sempre calculada pela soma de `Foto`. |

**Aceite do PO da Sprint 3 em 15/11/2026:** 10 aceitas e 1 aceita com ressalvas (3.1.2), nenhuma rejeitada. `make check` (back 487, front 143) e `make e2e` (228/228, desktop e mobile) executados pelo PO e passando. QA aprovou o reteste 2. A revisão de segurança reprovou a rodada inicial (2 altas: FD1 objeto regravável e FD5 EXIF/GPS); ambas foram corrigidas e cobertas por testes de QA (`m3-reteste1` e `m3-reteste2`). O AppSec ainda não refez a revisão formal. Aceite vale para desenvolvimento e homologação, não para produção. Detalhes em [sprint-3-relatorio.md](sprint-3-relatorio.md).

## Decisões do PO no aceite da sprint 3 (15/11/2026)

42. **FD5 (EXIF/GPS):** resolvido por recodificação no servidor (sharp) e aviso na tela 08; recodificação no navegador fica opcional. O risco RA4 deixa de exigir aceite formal.
43. **Reteste do AppSec obrigatório antes de produção** para FD1, FD5, FD6 e FD8, mais conferência real de R2 (`Content-Length`, `nosniff`, domínio separado do bucket, redação de `X-Amz-Signature`).
44. **Tela 23 = Excluir produto** (não tags); tags sem tela própria, como na história 5.1.
45. **Contratos m1-auth.md e m5-assinatura.md** precisam receber `Perfil.uso.armazenamento` e `fotosOrfasPendentes` (ação do Arquiteto, baixa).
46. **Cursor de `limparFotosOrfas`** em memória aceito no MVP (idempotente); persistir antes de produção.
47. **npm audit do backend** (prisma/deepmerge-ts) segue aceito; upgrade para Prisma 7 na próxima janela.


---

# Sprint 4 — M4 Estatísticas e Início completo

Legenda de status: A fazer · Em andamento · Em revisão · Em QA · Aceita · Aceita com ressalvas · Rejeitada.
Escopo: telas 05 (completa), 10 e 17 (completa) · UC017 (completo) e UC027 · RF23 e RF24 (com RF10, RF11 e RF22 nas telas) · Projeto Linear 2.0, 2.1, 2.1.1, 2.1.2, 2.2 e 2.2.1 · RNF06, RNF07, RNF10, RNF19, RNF24, RNF27, RNF31.
Fora desta sprint: pagamento real, exportação de relatórios, filtro por período, comparação entre meses, Redis, e os itens de segurança e produção do backlog da Sprint 3.
Ordem de construção: fundação (contrato e agregações) → resumo (tela 05) → estatísticas (tela 10) → Início desktop (tela 17) → desempenho e consistência. Fluxo de cada história: PO → Arquiteto → Back-end / Front-end / AppSec / DevOps → QA → aceite do PO. Nunca dois agentes no mesmo arquivo ao mesmo tempo. Contrato: `docs/api/m4-estatisticas.md` (criado na 2.0).

## Histórias

| Ordem | História | Linear | UCs | Responsável (camadas) | Status | Observações |
|---|---|---|---|---|---|---|
| 1 | [Fundação do M4 (contrato, módulo, agregações e índices)](m4/2.0-fundacao-m4-contrato-e-agregacoes.md) | 2.0 | base UC017, UC027 | Arquiteto → Back-end + DevOps | Aceita | ADR 0004 e contrato entregues, sem migration; seed idempotente e carga (`make carga`, `make seed-volume`). CHECK de preço e quantidade no banco ficou como defeito baixo. |
| 2 | [Resumo da Casa (tela 05 Início, completa)](m4/2.1.1-resumo-da-casa-tela-inicio.md) | 2.1, 2.1.1 | UC017 | Back-end → Front-end | Aceita | Rota `/estatisticas/resumo` e tela 05 completos, Casa vazia sem erro, renovação sem dados de pagamento. Defeitos baixos de UI (plano repetido, contraste do selo LEITOR). |
| 3 | [Estatísticas da Casa (tela 10)](m4/2.2.1-estatisticas-da-casa.md) | 2.2, 2.2.1 | UC027 | Back-end → Front-end | Aceita | Rota `/estatisticas` e tela 10 com regras de empate, teto de 50 tags e BigInt no front. Rolagem a 360 px e WCAG 2.5.3 corrigidos. |
| 4 | [Início desktop (tela 17) e navegação](m4/2.1.2-inicio-desktop-e-navegacao.md) | 2.1, 2.1.2 | UC017, UC016 | Front-end | Aceita | Tela 17 com quatro indicadores, tabela, menu lateral e armazenamento. Contraste do selo LEITOR segue aberto (baixo). |
| 5 | [Desempenho, consistência e atualização dos indicadores](m4/2.2.2-desempenho-consistencia-e-invalidacao.md) | 2.2 (2.2.2 proposto) | UC017, UC027 | Back-end + Front-end → QA + DevOps | Aceita com ressalvas | Medido com 10.000 produtos e 200 tags: resumo 6 ms, completa 43 ms, telas abaixo de 250 ms; statement_timeout e 503 entregues; cache limpo entre contas. Ressalvas: teto de produtos e tags por Casa sem decisão (F-01) e ETag/304 apesar de no-store. |

Transversal (RNF31 e RNF27), exigido no aceite de cada história: toda rota nova tem teste de matriz ADMIN, EDITOR, LEITOR (todos recebem 200), outra Casa (isolamento dos números), sem token (401); Casa vazia devolve 200 com zeros e listas vazias; nenhum parâmetro aceita `casaId`. M4 é só leitura: sem auditoria.

## Decisões do PO (escopo e interpretação) — Sprint 4

48. **Pagamento continua simulado no MVP** (decisão do produto, reafirmada ao iniciar a Sprint 4). Nenhum gateway real é integrado; vale tudo o que já está em `PAGAMENTO_SIMULADO` e nas decisões 19 e 29. Gateway real segue como pré-requisito de lançamento em produção, fora desta sprint.
49. **Valor de um produto = preço × quantidade** (o preço é unitário). Valor total, maior gasto e valor por tag usam esse valor. A documentação não diz outra coisa.
50. **Telas:** 05, 10 e 17. UC017 define os campos do Início (valor total, quantidade de produtos, tags e membros, armazenamento, renovação, recentes); UC027 define os da tela 10 (maior gasto, valor médio, tag mais comprada, valor por tag, produtos mais antigos). O wireframe do desktop (RF24) pede quatro indicadores: valor total, maior gasto, valor médio e membros.
51. **Todos os papéis consultam** as estatísticas da própria Casa (UC017 e UC027, ator "membro da Casa, qualquer papel"); nunca de outra Casa. Sem ações de escrita.
52. **Casa vazia** é estado normal, não erro: 200 com `R$ 0,00`, contagens zero, `maiorGasto` e `tagMaisComprada` nulos e listas vazias (UC027, exceção: valores zerados ou mensagem informativa).
53. **Período:** todo o histórico da Casa, sem filtro de data no MVP (proposta; Q1).
54. **Valor médio** = valor total ÷ número de produtos cadastrados, 2 casas, meio para cima (proposta; Q2). **Tag mais comprada** = maior soma de quantidades (proposta; Q3). **Mais antigos** = 5 menores `dataCompra` (proposta; Q1).
55. **Produto com várias tags** conta inteiro em cada tag no "valor por tag"; a tela explica. **Produto sem tag** entra em "Sem tag" (última linha) e fora da "tag mais comprada". **Preço R$ 0,00** é válido: conta zero no valor e uma unidade nas quantidades.
56. **Dinheiro nunca em `Number`:** string decimal na API e soma em `numeric` no banco; o front só formata. Teto: preço 9.999.999.999,99 × quantidade 1.000.000.
57. **Linear:** o M4 usa 2.0 a 2.2.1. O código 2.2.2 (desempenho e consistência) é **proposto** pelo PO e precisa entrar na Tabela 10 do Projeto Linear; 2.0 como "fundação" segue o padrão das sprints anteriores (1.0, 3.0).
58. **Sem Redis e sem cache de servidor** no MVP (backlog RNF03); só índices, agregação no banco e cache do TanStack Query, salvo reprovação na medição de desempenho.

## Perguntas ao Arquiteto (precisam de decisão antes de codar)

| # | Questão | Histórias | Proposta do PO |
|---|---|---|---|
| Q1 | Período dos indicadores e quantos "produtos mais antigos": todo o histórico ou janela (12 meses)? Quantos itens e por qual data (compra ou cadastro)? | 2.2.1 | Todo o histórico; 5 itens; por `dataCompra` ascendente, desempate por `dataCadastro` e `id`. |
| Q2 | "Valor médio": por produto cadastrado ou por unidade (valor total ÷ soma das quantidades)? E arredondamento? | 2.2.1, 2.1.2 | Por produto cadastrado; 2 casas, meio para cima em `numeric`. |
| Q3 | "Tag mais comprada": por soma de quantidades, por número de produtos ou por valor (que já é o "valor por tag")? Regra de empate? | 2.2.1 | Soma de quantidades; empate por número de produtos e depois nome A–Z. |
| Q4 | Rotas e formato: `GET /estatisticas/resumo` (Início) e `GET /estatisticas` (tela 10), ou uma só? Nomes dos campos, `maiorGasto` com id do produto, valores como string decimal, `membros` e armazenamento no resumo (reaproveitando `plano.service`)? | todas | Duas rotas, para o Início não pagar o custo da tela 10; contrato em `docs/api/m4-estatisticas.md`. |
| Q5 | Agregação por tag: SQL parametrizado (`$queryRaw` com `Prisma.sql`) ou `groupBy` do Prisma? A soma `preço × quantidade` exige expressão que o `aggregate` não faz: aceitar SQL bruto parametrizado para o M4? Precisa de índice novo (por exemplo `produto_tag(tag_id)`)? | 2.0, 2.2.1 | SQL parametrizado só com `Prisma.sql`, `casaId` sempre do token; confirmar índices com `EXPLAIN` no seed de volume. |
| Q6 | Cache e limites: rate limit próprio nas rotas do M4? `Cache-Control`/ETag? Cache curto por Casa no servidor se a medição reprovar? | 2.2.2 | Só o limite global; sem cache de servidor; `staleTime` de 30 s no front. |
| Q7 | Consistência: o resumo e a tela 10 devem vir de uma única transação de leitura (`REPEATABLE READ`) para o valor total bater sempre? | 2.2.2 | Uma consulta por rota (CTEs) ou transação de leitura; o valor total do resumo e o da tela 10 saem da mesma função do service. |
| Q8 | Quem calcula percentuais (participação da tag e uso do armazenamento): a API ou o front? | 2.1.1, 2.2.1 | O front, a partir de strings e bytes, protegido contra total zero; a API não devolve percentuais. |
| Q9 | O Início mostra "membros" e "tags" por rota nova ou pelo `GET /me`? E o aviso de renovação (hoje na `GET /assinaturas/atual`, só ADMIN) precisa de uma leitura para todos os papéis? | 2.1.1, 2.1.2 | O resumo devolve `membros`, `tags` e `renovacao` (`{status, data}` ou `null`) para todos os papéis, sem expor dados de pagamento. |
| Q10 | Seed de volume (10.000 produtos) fica em `make seed-volume` e entra no CI de desempenho ou só local? | 2.0, 2.2.2 | Só local e na medição de QA; o CI não roda o volume. |

**Aceite do PO da Sprint 4 em 15/11/2026:** 4 aceitas e 1 aceita com ressalvas (2.2.2), nenhuma rejeitada. `make check` (backend 512, frontend 178, lint e typecheck limpos) executado pelo PO e passando. `make e2e`: 270 passaram e 1 pulou (o spec de volume, que precisa de `make seed-volume`) em duas execuções; a primeira execução do PO teve 1 falha não identificada (269 passaram) que não se repetiu em duas rodadas seguintes, tratada como intermitência. QA aprovou o reteste 1 (271/271 com volume) e o AppSec aprovou o M4 e fechou FD1 e FD5 do M3. Aceite vale para desenvolvimento e homologação, não para produção. Detalhes em [sprint-4-relatorio.md](sprint-4-relatorio.md).

## Decisões do PO no aceite da sprint 4 (15/11/2026)

59. **FD1 e FD5 fechados** pelo reteste real do AppSec; a história 3.1.2 passa a "Aceita". Restam só itens de produção do R2.
60. **Pagamento segue simulado** (decisão 48). Gateway real ou lançamento sem pagamento é pré-requisito de produção.
61. **F-01 (teto por Casa):** risco aceito para desenvolvimento e homologação, com custo linear medido (43 ms com 10.000 produtos). Teto proposto de 20.000 produtos e 500 tags no M3, a confirmar com o Arquiteto antes de produção.
62. **npm audit (3 altas, deepmerge-ts via prisma):** exceção do CI vale até 2027-03-31; upgrade para Prisma 7 em sprint própria.
63. **Código Linear 2.2.2** continua proposto e precisa entrar na Tabela 10.
64. **Planos pagos desativados em produção (decisão do PO, 2026-11-15):** o MVP vai ao ar sem gateway e sem planos pagos. Todas as Casas usam o Individual. A tela 13 continua visível, com um aviso breve e os botões Assinar desabilitados (cinza); a tela 14 redireciona para a 13. `GET /planos` informa `contratacaoDisponivel` (false quando `PAGAMENTO_SIMULADO=false`) e a API recusa a contratação com 503. Em dev e testes o fluxo simulado continua ligado. Substitui a pendência "gateway real ou lançamento sem pagamento" da decisão 60.
