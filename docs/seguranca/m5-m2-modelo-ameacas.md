# Modelo de ameaças — M5 Planos e Assinatura (pagamento simulado) e M2 Casa e Membros

- **Autor:** Engenheiro de Segurança e Privacidade (AppSec / LGPD)
- **Data:** 2026-11-15
- **Escopo:** planos, método de pagamento simulado, assinar/trocar/cancelar/reativar, rotina `expirarAssinaturas`, cota do plano, membros da Casa (listar, adicionar por e-mail, editar papel, remover), nome da Casa e os ganchos da exclusão de conta (ADR 0002, D8).
- **Base lida:** `docs/api/m5-assinatura.md`, `docs/api/m2-casa.md`, `docs/adr/0002-m5-m2.md`, `docs/seguranca/m1-modelo-ameacas.md`, `AGENTS.md` (papel 7), `backend/prisma/schema.prisma`, `middlewares/autenticar.ts` e `middlewares/limitar.ts` (como estão hoje). Não li código dos módulos novos: ainda não existe (Back-end implementa a partir da história 7.1).
- **Uso:** a seção 7 é o checklist da revisão de código. A seção 6 lista as falhas de design que precisam de decisão do Arquiteto/PO **antes** de o Back-end implementar as histórias 6.2, 7.2, 7.3 e 6.6.
- **Regra do papel:** itens **[BLOQUEANTE]** são os que considero inaceitáveis até para MVP (captura de conta ou de dados de terceiros, PAN em produção, escalada de papel, cobrança dupla). Os demais podem virar backlog com aceite formal do PO.

---

## 1. Ativos

| # | Ativo | Onde vive | Por que importa |
|---|---|---|---|
| A1 | Vínculo Casa/papel (`membro`) | `membro` (`usuario_id` único; índice parcial de 1 ADMIN) | Base de toda autorização (RNF31) e do isolamento entre Casas |
| A2 | Assinatura e plano vigente | `assinatura`, `plano`, `plano.service` | Determina limites (RNF13) e, no futuro, cobrança real; fraude = uso grátis ou cobrança indevida |
| A3 | Método de pagamento (marca + 4 dígitos) e, **em trânsito**, PAN/validade/nome/CVV | `metodo_pagamento`; corpo de `PUT /pagamento/metodo` | PAN em trânsito traz escopo PCI e risco LGPD mesmo que seja descartado |
| A4 | Inventário da Casa (produtos, fotos; M3) | `produto`, `foto` | O que o ADMIN passa a controlar ao capturar um membro; o que se perde ao remover Casa |
| A5 | Dados pessoais de **outros** membros (nome, e-mail, papel, data de entrada) | `GET /casa/membros`, e-mails de aviso | LGPD: dado de terceiro exibido a quem o usuário não escolheu |
| A6 | Log de auditoria | `log_auditoria` | Evidência (RNF05); não pode virar depósito de PII |
| A7 | `JOBS_TOKEN` e a rotina horária | `POST /internal/jobs` | Quem dispara ou impede a rotina controla expiração, renovação e apagamento de contas |
| A8 | Cota de e-mails e disponibilidade da API | Resend/SMTP, limitadores | Avisos de adição/remoção/expiração são disparados por ações de usuário |

## 2. Atores

| Ator | Capacidade assumida |
|---|---|
| LEITOR / EDITOR malicioso | Token válido; tenta escalar papel, ler/alterar outra Casa, burlar limite |
| ADMIN malicioso (de uma Casa) | Pode adicionar por e-mail, remover, renomear; tenta capturar usuários que não consentiram, enumerar contas, apagar dados de terceiros |
| ADMIN de **outra** Casa | Tenta IDOR por `:usuarioId` e por id em qualquer corpo |
| Visitante que cria contas em massa | Cadastra contas (10/h por IP), assina "de graça" no gateway simulado, usa as contas como ADMINs de fachada |
| Atacante com token roubado | Troca plano, cancela, remove membros durante o prazo do token |
| Usuário que digita cartão real | Entrega PAN real a um sistema que é só simulação |
| Insider / operador | Lê logs, banco, e-mails transacionais |
| Terceiro com `JOBS_TOKEN` | Dispara a rotina (idempotente, mas encadeia apagamento de contas) |

## 3. Superfícies de ataque

| Superfície | Rotas / componentes | Entradas não confiáveis |
|---|---|---|
| Planos e cota | `GET /planos`, `plano.service` | nenhuma (somente leitura); `plano` vigente é decisão de servidor |
| Método de pagamento | `GET/PUT /pagamento/metodo` | `numero`, `validade`, `nome`, `cvv` |
| Assinar/trocar | `POST /assinaturas` | `plano`, `confirmaSaidaDaCasa`; token (papel e Casa lidos do banco por `autenticar`) |
| Cancelar/reativar/consultar | `GET /assinaturas/atual`, `POST .../cancelar`, `POST .../reativar` | `motivo` (texto livre) |
| Membros | `GET/POST /casa/membros`, `PATCH/DELETE /casa/membros/:usuarioId` | `email`, `papel`, `:usuarioId` |
| Casa | `PATCH /casa` | `nome` (vai a telas e e-mails de terceiros) |
| Exclusão de conta | `DELETE /me` (efeitos novos de ADR D8) | nenhuma nova; o efeito é a mudança |
| Rotina | `POST /internal/jobs` | `x-jobs-token`; dados já gravados |
| E-mails | `lib/mailer.ts` (adição, remoção, expiração, assinatura, cancelamento) | nome da pessoa e da Casa interpolados |

---

## 4. Ameaças STRIDE, mitigação esperada e onde no código

Convenção: `B:` = backend (`backend/src/...`), `F:` = frontend (`frontend/src/...`), `D:` = devops/config.

### 4.1 Assinatura e pagamento simulado (M5)

| ID | STRIDE | Ameaça | Mitigação esperada | Onde |
|---|---|---|---|---|
| S1 | E | **Trocar de plano, cancelar ou reativar sem ser ADMIN** (LEITOR/EDITOR chamando `cancelar`, `reativar`, `GET /assinaturas/atual`) | `autorizar('ADMIN')` nas três rotas; teste de matriz (sem token, LEITOR, EDITOR, ADMIN, ADMIN de outra Casa). Atenção: `POST /assinaturas` é aberta a todos **por desenho** e, para não ADMIN, tem outro efeito (sai da Casa). Nenhum id de Casa/assinatura em URL ou corpo | B: `assinatura.routes.ts` |
| S2 | E | **Papel/Casa "velhos" dentro do service (TOCTOU).** `autenticar` lê `casaId`/`papel` antes; o service roda depois. Entre os dois, o usuário pode ter sido removido, transferido ou ter assinado (duplo clique). Com o snapshot, um LEITOR que já virou ADMIN de Casa nova assina de novo como "membro", gera outra Casa e outra cobrança | O service **relê `Membro` do usuário dentro da transação, com a linha travada** (`FOR UPDATE` em `membro` ou `usuario`) e decide com o valor relido; nunca usa `req.usuario.papel/casaId` para decidir. Ver FP2 | B: `assinatura.service.ts`, `casa.service.ts` |
| S3 | T | **Manipular preço, plano ou estado** (corpo com `preco`, `status`, `dataRenovacao`, `planoId`, `titularId`, `casaId`) | Schema Zod com apenas `plano` (enum `FAMILIA\|BUSINESS`) e `confirmaSaidaDaCasa`; chaves extras ignoradas ou `.strict()`; preço e limites sempre lidos da tabela `plano`; `plano` mapeado por `nome`, nunca por id do cliente; nenhuma rota edita `plano` | B: `assinatura.schema.ts`, `assinatura.service.ts` |
| S4 | T/E | **Pagamento simulado em produção = plano pago de graça.** O gateway aprova qualquer cartão que passa no Luhn e não termina em `0000`. Se for para produção como está, todo mundo tem Business por R$ 0 | Flag explícita (`PAGAMENTO_SIMULADO=true`), **recusada em `NODE_ENV=production`** pelo `env.ts` (mesmo padrão de `RATE_LIMIT_DESLIGADO`) enquanto não houver gateway real; ou banner e política de que produção é "demonstração". Ver FP3 | B: `config/env.ts`, `gatewaySimulado.ts` |
| S5 | I | **PAN, validade, nome e CVV em trânsito, em log ou em erro.** O corpo de `PUT /pagamento/metodo` traz tudo. Vazamento por logger de requisição, handler do Zod que ecoa o valor recebido, `console.error(err)`, Sentry, mensagem 422 | Nunca logar `req.body` dessa rota; `details` do 422 só com `campo` e `mensagem` fixa (sem valor); `error.ts` não imprime corpo; PAN só em variável local, descartado após derivar marca e 4 dígitos; resposta e auditoria só com `marca` e `ultimos4`. Teste que sobe a rota com PAN e verifica que ele não aparece em saída de log nem no banco (`SELECT` em todas as tabelas) | B: `pagamento.service.ts`, `middlewares/error.ts`, `middlewares/validar.ts` |
| S6 | I | **Usuário digita cartão real** num sistema simulado: o servidor recebe PAN real (escopo PCI, art. 46 LGPD) | Em modo simulado aceitar somente os PANs de teste publicados (`4242…`, `4111 1100 0005 0000`) ou, no mínimo, banner fixo "ambiente de simulação: use cartões de teste" no front e rejeição de BIN real conhecido. Ver FP3 | B: `pagamento.service.ts`; F: tela 14 |
| S7 | D/T | **Corrida: contratação dupla / cobrança dupla.** Dois `POST /assinaturas` simultâneos (duplo clique, retry de rede, dois dispositivos) | Trava da linha da Casa (ADMIN) ou do usuário (não ADMIN) por `SELECT ... FOR UPDATE` **antes** de ler a assinatura vigente; índice único parcial como rede de proteção; segundo pedido recebe `409 ESTADO_INVALIDO` (não 500). Para trocar de plano, `updateMany` condicional na vigente (`WHERE status IN (ATIVA, CANCELADA) AND id = ?`, contagem 1) antes de criar a nova. Idempotency-Key no backlog (ver FP9). Teste com `Promise.all` de N pedidos: exatamente 1 assinatura vigente e 1 cobrança | B: `assinatura.service.ts` |
| S8 | T | **Corrida entre cancelar, reativar, trocar e a rotina.** Cancelar x renovar no mesmo instante; reativar logo antes de vencer | Toda transição é `updateMany` condicional pelo estado esperado e por `dataRenovacao` (`> agora` para reativar; `<= agora` para expirar/renovar), com checagem do número de linhas; falha vira `409 ESTADO_INVALIDO` | B: `assinatura.service.ts`, `jobs/expirarAssinaturas.ts` |
| S9 | R | **Negar ou ocultar a cobrança/cancelamento** (sem trilha) | Auditoria na **mesma transação** da mudança (ADR D9): `ASSINATURA_CRIADA`, `PLANO_ALTERADO`, `PAGAMENTO_RECUSADO`, `ASSINATURA_CANCELADA` (com motivo), `ASSINATURA_REATIVADA`, `ASSINATURA_RENOVADA`, `ASSINATURA_EXPIRADA`. E-mail ao titular. Log não vai perder se o e-mail falhar | B: `lib/auditoria.ts` |
| S10 | I | **`motivo` do cancelamento** é texto livre: PII digitada, injeção em e-mail, XSS armazenado | Limite 300, rejeitar `<>` e controle (já no contrato); escapar no e-mail; na auditoria guardar sem truncar mas sem indexar; tratar como dado pessoal (retenção/eliminação, seção 5) | B: `assinatura.schema.ts`, `mailer.ts` |
| S11 | S/I | **Método de pagamento de outro usuário**: `GET/PUT /pagamento/metodo` por `usuarioId` | A rota não recebe id: sempre `req.usuario.id`. `GET /assinaturas/atual` devolve `metodoPagamento` do **próprio** ADMIN, nunca de membro. Teste: dois usuários, A não lê nem altera o de B | B: `pagamento.service.ts` |
| S12 | D | **Esgotar cota de e-mail ou o gateway com assinar/cancelar/reativar em laço** | Limites por usuário já previstos (10/15 min); garantir que `limitar` vem **depois** de `autenticar` (senão a chave vira o IP, `limitar.ts` cai no IP se `req.usuario` ainda não existe). Contar sucessos e erros (não só erros) | B: ordem dos middlewares |
| S13 | E | **Assinar como membro serve de saída sem consentimento do ADMIN** e de "criar Casas" em massa | Aceito pelo PO (decisão 15/RF38). Exigir `confirmaSaidaDaCasa: true` (rodar a validação no servidor); limitar a 10/15 min; cada saída/criação auditada. Registrar que LEITOR pode, pagando, sair da Casa — e que **é a única saída voluntária existente** (FP2) | B: `assinatura.service.ts` |

### 4.2 Limite de membros e cota (RNF13, RF39)

| ID | STRIDE | Ameaça | Mitigação esperada | Onde |
|---|---|---|---|---|
| Q1 | T/E | **Contornar o limite com adições simultâneas** (duas requisições, ou adicionar enquanto o plano é trocado) | `POST /casa/membros` trava a linha da Casa de destino (`FOR UPDATE`), conta membros e insere na mesma transação; `assinar` e `adicionar` travam **a mesma linha** (casa) para se serializarem; `PLANO_NAO_COMPORTA` também sob a trava. Teste com `Promise.all` de adições com 1 vaga: 1 sucesso, resto `LIMITE_MEMBROS` | B: `casa.service.ts`, `plano.service.ts` |
| Q2 | T | **Contornar o limite por outro caminho**: promover herdeiro, assinar como membro, job que desvincula membros, remoção seguida de re-adição | Toda inclusão em `Membro` passa por **uma única função** que checa vaga; revisar cada `membro.create/update`. O índice `usuario_id` único garante uma Casa por usuário. A contagem inclui usuários com exclusão solicitada até serem removidos (EDITOR/LEITOR saem no pedido: verificar) | B: busca por `prisma.membro.(create|update|upsert)` |
| Q3 | T | **Plano vigente interpretado de forma diferente por módulos** (ATIVA vencida, CANCELADA vencida) | Só `plano.service` decide (invariante I5); `grep` proibindo ler `assinatura`/`plano` em outro lugar; teste cobre CANCELADA vencida = Individual e ATIVA vencida = vigente | B: todo `src/` |
| Q4 | D | **Fail-open da cota**: se a rotina para, ATIVA vencida continua vigente indefinidamente (uso grátis); fotos acima da cota ficam (M3) | Monitorar execução do job (DevOps; alerta se nenhuma execução em 2 h). Em produção com cobrança real isso passa a ser perda financeira. Registrar como risco aceito até gateway real (seção 8) | D: workflow cron; B: `jobs` |
| Q5 | I | **Detalhes de `PLANO_NAO_COMPORTA` e `LIMITE_MEMBROS`** vazam uso de outra Casa | Os `details` contêm só números da **própria** Casa do token. Teste: nenhum id/nome de outra Casa em respostas de erro | B: services |

### 4.3 Membros da Casa (M2)

| ID | STRIDE | Ameaça | Mitigação esperada | Onde |
|---|---|---|---|---|
| M1 | E | **Escalada de papel**: `papel: "ADMIN"` em `POST`/`PATCH`; mass assignment; trocar o próprio papel; EDITOR editando papéis | Zod `z.enum(['EDITOR','LEITOR'])` (ADMIN → 422); `autorizar('ADMIN')` nas rotas de escrita; ADMIN não altera a si mesmo (`ESTADO_INVALIDO`). Papel gravado somente de valor validado, nunca de `req.body` direto. Único caminho para novo ADMIN é a promoção do herdeiro (D8) | B: `casa.schema.ts`, `casa.service.ts`, `casa.routes.ts` |
| M2 | E/I | **IDOR entre Casas**: `PATCH/DELETE /casa/membros/:usuarioId` com id de membro de outra Casa; `usuarioId` sequencial | Busca **sempre** por `{ usuarioId, casaId: req.usuario.casaId }`; fora da Casa: `404 NAO_ENCONTRADO` idêntico ao inexistente. Cuidado: o contrato devolve **409** quando o alvo é o próprio ADMIN e **404** para estranho: isso só revela o que o ADMIN já sabe (ele mesmo). Teste de matriz incluindo "ADMIN de outra Casa" esperando 404 | B: `casa.service.ts` |
| M3 | D/T | **Remover o último ADMIN / deixar Casa sem ADMIN.** O índice parcial garante **no máximo** um ADMIN, **não garante pelo menos um** | Rotas de membros nunca removem nem rebaixam o ADMIN; `DELETE /me` do ADMIN com outros membros promove herdeiro **na mesma transação**; Casa solo é apagada pela rotina. Herdeiro deve ser um membro **sem** `exclusaoSolicitadaEm` (senão a Casa herda um ADMIN condenado). `DELETE /me` trava a Casa (`FOR UPDATE`) na mesma ordem das demais rotas. Verificação de invariante ao final dos testes: `SELECT casa_id FROM casa c WHERE c.id IN (SELECT casa_id FROM membro) AND NOT EXISTS (admin)` retorna vazio | B: `auth.service.excluirConta`, `casa.service.ts` |
| M4 | S/T | **Sequestro de usuário por "adicionar por e-mail".** A adição é direta, sem aceite: qualquer ADMIN que conheça um e-mail move aquela pessoa para a Casa dele. Contas recém-criadas (solo, sem assinatura, **sem produtos**) são justamente as transferíveis. Efeitos: (1) a vítima passa a cadastrar produtos (como EDITOR) em uma Casa controlada pelo atacante, que depois a remove e **fica com os dados**; (2) a vítima perde a Casa Individual (removida); (3) o atacante vê nome e e-mail da vítima; (4) a vítima não tem como sair (FP1/FP2). Com Família/Business o atacante captura 5 a 14 pessoas | Mitigação de desenho (preferida): **convite com aceite** (hoje no backlog) — sai do backlog **antes** de produção. Mitigações enquanto não: (a) só transferir quem nunca criou conteúdo **e** reconhecer que isso ainda captura contas novas; (b) a vítima ganha rota `POST /casa/sair` (volta a uma Casa nova Individual); (c) e-mail de aviso com texto claro e link para sair (sem token mágico); (d) limite por hora menor (ex.: 5/h por ADMIN) e por assinatura ATIVA; (e) alerta de abuso (> N adições/dia). Registrar o risco no PO como **não aceito** sem (b) | B: `casa.service.adicionarMembro`; F: tela 12 |
| M5 | I | **Enumeração de e-mails** em `POST /casa/membros`: 404 `USUARIO_NAO_ENCONTRADO` x 409/201 distingue conta existente. Ordem atual (conta → já na Casa → transferível → vaga) faz o 404 sair mesmo com a Casa lotada | Inerente ao UC033 (adição por e-mail de conta existente). Mitigar: (a) **checar vaga e papel antes de consultar o e-mail** (um ADMIN sem vaga não faz oráculo); (b) limite por usuário já previsto (20/h e 5 erros/15 min) **mais** limite por IP; (c) respostas de 404 e de "exclusão solicitada" idênticas (corpo e tempo); (d) contar também o 201 no limite horário; (e) auditar tentativas com 404/409 (sem o e-mail em claro: usar hash HMAC curto ou só contador). Aceite formal do PO (como ACH-10) | B: `casa.service.ts`, `limitar.ts` |
| M6 | I | **`MEMBRO_NAO_TRANSFERIVEL` como oráculo de estado**: distingue o ADMIN com membros, o titular e o solo com produtos de uma conta transferível | Sem `details` (já). Como o outro ramo é um `201` que age, o oráculo só aparece para alvos não transferíveis; aceitável se M4 for resolvido. Se a adição passar a exigir aceite, a resposta pode ser uniforme (`202`) e o oráculo some | B/PO |
| M7 | T | **TOCTOU na transferência**: a vítima assina/vira titular, ou recebe produtos, entre a checagem de "transferível" e o `UPDATE membro` | Travar a linha do **usuário-alvo** (`SELECT ... FROM usuario WHERE id = ? FOR UPDATE`) e relê-lo (Membro, assinatura vigente, contagem de produtos) dentro da transação; mesma ordem de travas em todas as rotas (id de Casa crescente, depois id de usuário crescente) para evitar deadlock; mapear `40P01` (deadlock) e `40001` para novo retry ou `409`, nunca `500` | B: `casa.service.ts` |
| M8 | T/D | **Casa de origem apagada com dados** ao transferir ADMIN solo (a regra "só se sem produtos" depende da contagem em tempo real) e **cascade do schema**: `assinatura.casa_id ON DELETE CASCADE` apaga o histórico de assinaturas; `produto`, `tag` ao apagar Casa | Contar produtos **dentro** da transação com a Casa travada; usar `DELETE` explícito e ordenado; teste: Casa com produto criado entre a checagem e a remoção. Para histórico de cobrança (quando for real), reter por obrigação legal: não pode sumir com a Casa | B: `casa.service.ts`; schema |
| M9 | T | **Remover membro com e-mail de aviso e confirmação só no front** (RNF12) | A confirmação é do front; no servidor, o `DELETE` é idempotente e auditado. Aceitável: o token é Bearer (sem CSRF), mas XSS faz o clique por você (ver M13) | F: modal; B: auditoria |
| M10 | I | **Nome da Casa e nome do ADMIN dentro de e-mails a terceiros** (adição, remoção, expiração): phishing com a marca do KeepIT ("Casa: sua conta foi suspensa, clique em http://…") | E-mails de membros usam **texto fixo**; o nome do ADMIN entra só como texto escapado; nome da Casa fora do assunto; sem links controlados pelo usuário; `nome` da Casa rejeita `<` `>` e controle (contrato) **e** a validação precisa rodar no `PATCH /casa` e no nome padrão derivado do nome do usuário ("Casa de <primeiro nome>") | B: `mailer.ts`, `campos.ts` |
| M11 | I | **Lista de membros expõe e-mail e `usuarioId` a todos os papéis**, inclusive a quem foi adicionado sem consentimento | Ver seção 5 (P12) e FP6: preferir e-mail só para o ADMIN e mascarado para EDITOR/LEITOR. `senhaHash` e códigos nunca no select (usar `select` explícito, não `include` do usuário inteiro) | B: `casa.service.listarMembros` |
| M12 | R | **Falta de trilha de tentativas negadas** (403/404 em `:usuarioId` de outra Casa; tentativas `MEMBRO_NAO_TRANSFERIVEL`) | Logar (log de segurança, não `log_auditoria`) 403/404 de IDOR com `usuarioId` do chamador e rota, sem PII de terceiros; contador por usuário para alerta | B: `middlewares/autorizar.ts`, services |
| M13 | E | **XSS/token roubado** executa ações de ADMIN (remover todos, trocar papel) | Risco herdado de A2/F4 do M1. CSP no front; nenhuma re-autenticação por senha nas ações de membros (aceito), mas **cancelar assinatura** e **remover membro** são as mais destrutivas: considerar `senhaAtual` no backlog | F/D |
| M14 | E | **Estado stale após mudança de papel/Casa** com o mesmo token | Já mitigado: `autenticar` relê `Membro` a cada requisição (positivo). Verificar que **nenhum** código usa papel/Casa vindos do JWT ou de cache de perfil do front para decidir; o front não deve confiar no `Perfil` em cache para liberar UI sem backend | B/F |

### 4.4 Exclusão de conta e rotinas

| ID | STRIDE | Ameaça | Mitigação esperada | Onde |
|---|---|---|---|---|
| J1 | T | **Rotina executada em paralelo ou repetida** (dois cron, reenvio) cobrando ou expirando duas vezes | Cada assinatura em transação própria; `updateMany` condicional (`status = ATIVA AND data_renovacao <= agora`) com contagem 1; renovação avança a **data** (não "agora + 1 mês"); `FOR UPDATE SKIP LOCKED` ou trava da Casa para execuções concorrentes; teste: duas chamadas simultâneas = 1 renovação | B: `jobs/expirarAssinaturas.ts` |
| J2 | E | **`JOBS_TOKEN` vazado** dispara expiração/renovação e apagamento de contas | Já aberto no M1 (ACH-02, ACH-05): mínimo 32 chars, rejeitar valor de exemplo em produção, `timingSafeEqual`, remover alias `/jobs/run`. A rotina é idempotente, o que limita o dano (não cria cobrança indevida **se** J1 estiver correto) | B: `config/env.ts`, `app.ts` |
| J3 | D | **Job grande/lento**: 200 por execução, N Casas novas por expiração (até 14 por assinatura), e-mails para cada membro; falha de e-mail dentro da transação | Limite por execução (já); e-mails **depois do commit** e fora da transação; falha de uma assinatura não derruba as demais (`try/catch` por item) e é logada sem PII; timeout da transação; alerta se a fila de vencidas cresce | B: `jobs/` |
| J4 | I | **Falha parcial deixa Casa inconsistente** (membros desvinculados sem Casa nova; Casa sem ADMIN) | Todo o RF37 de uma assinatura em **uma** transação (expirar + desvincular + criar Casas + auditoria); se qualquer passo falha, nada muda e a próxima execução tenta de novo | B: `jobs/`, `assinatura.service.ts` |
| J5 | T | **Herdeiro inadequado ou competição `DELETE /me` x remoção** (duas exclusões de conta quase simultâneas na mesma Casa; herdeiro com exclusão solicitada; ADMIN e herdeiro apagando ao mesmo tempo) | Escolha do herdeiro filtra `exclusaoSolicitadaEm IS NULL`; sem herdeiro elegível, ADMIN "solo" (a Casa vai para a rotina de apagamento); `DELETE /me` trava Casa e depois usuário, na ordem global; teste das duas exclusões em paralelo e do invariante "toda Casa com membros tem 1 ADMIN" | B: `auth.service.excluirConta` |
| J6 | I | **Dados pessoais deixados além de 24 h** (RNF16): titular com assinatura (ACH-08), `metodo_pagamento`, logs com nome/e-mail | `titular_id SetNull` (feito); `metodo_pagamento` com `ON DELETE CASCADE` (feito) — confirmar no banco após apagar; nomes em `detalhes` de auditoria (ver P8) | B: `jobs/apagarContas.ts`; schema |
| J7 | R | **Rotina sem trilha**: ações do sistema com `usuarioId` nulo | `ASSINATURA_EXPIRADA`/`RENOVADA` com `casaId` e `entidadeId`; um log de resumo da execução (`expiradas`, `renovadas`, `apagadas`, duração) sem PII | B: `jobs/` |

### 4.5 Ameaças transversais

| ID | STRIDE | Ameaça | Mitigação esperada | Onde |
|---|---|---|---|---|
| X1 | E | **Rota nova sem `autenticar`/`autorizar`** (esquecimento) | Teste automatizado que percorre as rotas do Express e falha se alguma rota fora de `/auth/*` e `/internal/*` responder diferente de 401 sem token; matriz de papéis por rota (`testarMatrizDePapeis`) | B: `*.test.ts` |
| X2 | I | **IDs inteiros sequenciais** (usuário, Casa, assinatura) | Autorização por `casaId` em toda consulta; 404 uniforme; ids de assinatura em respostas só da própria Casa | B |
| X3 | I | **Respostas de erro com stack, SQL ou valor recebido** | `errorHandler` devolve só código e mensagem fixa; sem `console.error(err)` com argumentos do Prisma (herdado de ACH-09) | B: `error.ts` |
| X4 | D | **Rate limit em memória** (zera em reinício, por instância) | Aceito no MVP com 1 instância (F9 do M1); todos os limites novos são `porUsuario`: confirmar que a chave **não** cai no IP por falta de `req.usuario` | B: `limitar.ts` |
| X5 | I | **Respostas de assinatura/pagamento/membros cacheáveis** | `Cache-Control: no-store` nesses grupos de rota | B: `app.ts` |
| X6 | T | **Valores numéricos**: `:usuarioId` gigante estoura `Int` do Postgres (500); bytes em `Number` | Zod `int().positive().max(2147483647)`; `usadoBytes` somado em `BigInt` ou `Number` com verificação de `Number.isSafeInteger` | B: `casa.schema.ts`, `plano.service.ts` |

---

## 5. Requisitos LGPD aplicáveis

| # | Requisito | Base | O que verificar |
|---|---|---|---|
| P1 | **Minimização** (art. 6, III) — pagamento | Coletar o mínimo | O contrato pede `nome` do titular e `cvv`, mas descarta ambos. Se só são "validados", coletá-los é desnecessário: remover `cvv` e `nome` do corpo (ou, no mínimo, não persistir nem logar). Nenhum PAN/validade/CVV gravado (I6) |
| P2 | **Dados de outros membros visíveis** (art. 6, III e VII) | Necessidade e segurança | `GET /casa/membros` mostra nome, e-mail e data de entrada de todos os membros a todos os papéis. Decidir (PO) o mínimo: nome e papel a todos; **e-mail só ao ADMIN** (ou mascarado `a***@dominio` para EDITOR/LEITOR, coerente com RNF25). `usuarioId` interno pode ser trocado por identificador opaco |
| P3 | **Informação clara ao titular** (art. 9) na adição | Transparência | O e-mail de aviso e a tela do membro dizem **quem** (ADMIN, nome), **o que muda** (Casa, papel, o que ele passa a ver: nome e e-mail dos membros, produtos), **o que acontece com o que ele cadastrou** (fica na Casa, sem autor) e **como sair**. Texto de aviso na tela 24 (assinar como membro) também |
| P4 | **Consentimento / autonomia sobre o vínculo** (art. 7 e 8; art. 18, IX) | Adição direta é tratamento sem manifestação do titular | A base legal "execução de contrato" não cobre uma terceira pessoa decidir por você onde seus dados ficam. Convite com aceite (backlog) ou, no mínimo, rota de saída (FP2) e registro do evento. **Risco alto até resolvido** |
| P5 | **Direito de eliminação** (art. 18, VI; RNF16) | Apagar em 24 h | Cobre: `metodo_pagamento` (cascade), `titular_id` (SetNull), e-mails de aviso no provedor, e a **autoria** de produtos (`adicionadoPorId` nulo). Hoje apagar conta do ADMIN com herdeiro preserva produtos que outros membros usam (interesse legítimo/coletivo): documentar na política |
| P6 | **Logs de auditoria sem PII** (RNF05; art. 6, III e X) | Minimização | `detalhes` **sem** e-mail, senha, cartão, texto livre além do necessário. Os campos `de/para` de `CASA_RENOMEADA` e o `motivo` do cancelamento podem conter nome de pessoa ("Casa de Ana"): tratar como pseudônimo (guardar só tamanho ou hash) ou definir retenção e anonimização na exclusão de conta. Entidade `Usuario` + `entidadeId` fica (id sem nome) |
| P7 | **Dados de pagamento** (art. 46; RNF04) | Segurança | Marca + 4 dígitos são o único dado de cartão em repouso (aceitável, fora do escopo PCI). Em trânsito, PAN real **não** pode ser aceito em produção simulada (S6) |
| P8 | **Retenção de histórico de cobrança** | Art. 16 e obrigação legal | Assinaturas são simuladas hoje. Ao ligar cobrança real: reter registros fiscais pelo prazo legal, separados da exclusão da Casa (hoje `assinatura.casa_id` é `CASCADE`). Registrar no backlog |
| P9 | **Eliminação em terceiros e backups** | Art. 16 | Resend, backup do banco e logs do Render (herdado de P3 do M1) continuam com e-mails de aviso (nome, nome da Casa); prazo máximo na política |
| P10 | **Transparência sobre simulação** | Art. 9 | Termos e tela 14 deixam claro que o pagamento é simulado e que nenhuma cobrança ocorre; evita expectativa indevida e coleta de PAN real |
| P11 | **Canal do titular (DPO)** e incidente (art. 18, 41, 48) | Herdado | Mantém F8/P6 do M1; vazamento de membros ou captura em massa (M4) é incidente a notificar |
| P12 | **Menores** (art. 14) | Casa Família | O plano Família sugere crianças como membros; o termo atual declara maiores de 18 anos. Registrar como risco aceito ou prever tratamento (decisão do PO) |

---

## 6. Falhas de design encontradas nos contratos (`docs/api/m5-assinatura.md`, `docs/api/m2-casa.md`) e no ADR 0002

Severidade: A = alta (captura de dados/conta, PAN, cobrança dupla), M = média, B = baixa. "Decisor" é quem precisa agir.

| ID | Sev. | Falha | Evidência | Recomendação | Decisor |
|---|---|---|---|---|---|
| FP1 | A | **Adição direta sem aceite permite capturar qualquer usuário "solo sem produtos"**, ou seja, qualquer conta nova. O ADR D7 decidiu proteger quem **tem produtos**, mas justamente quem acabou de se cadastrar (e vai criar produtos na Casa errada) fica desprotegido. Atacante com plano pago (ou o gateway simulado, que aprova tudo) captura 5 a 14 pessoas por vez e depois fica com o inventário (a remoção zera o autor, mas os produtos permanecem) | m2-casa.md 1 e 3.2; ADR D7 (desvio da proposta do PO) | Antecipar o **convite com aceite** para a Sprint 2 (ou adiar 6.2 até lá). Mínimo viável: exigir que o alvo **não tenha criado nada** e tenha sessão ativa recente **não** resolve; exigir aceite resolve. Ver M4 | PO + Arquiteto |
| FP2 | A | **Não existe rota para EDITOR/LEITOR saírem da Casa.** Quem foi adicionado sem querer só sai se o ADMIN o remover, se excluir a conta, ou se **assinar um plano pago** (RF38). Combinado a FP1, a vítima fica presa e sua exclusão de conta é a única saída | Contratos m2 (nenhuma rota de saída) | `POST /casa/sair` (EDITOR/LEITOR; ADMIN não, por D8): cria Casa nova Individual como no remover, audita `MEMBRO_SAIU_DA_CASA`. Vale também como direito do titular (art. 18) | Arquiteto + PO |
| FP3 | A | **Gateway simulado sem trava de produção e sem restrição de PAN.** (a) Sem `env` que o impeça em produção, plano pago sai de graça; (b) aceita qualquer PAN com Luhn válido, então usuários digitarão cartão real e o servidor receberá PAN; (c) coleta `nome` e `cvv` sem uso | m5 3.3 e 3.4; ADR D5 | (a) `PAGAMENTO_SIMULADO` recusado em produção; (b) em modo simulado aceitar só os PANs de teste publicados, ou banner + lista de BIN reais; (c) remover `cvv` e `nome` do corpo ou nem trafegar. Documentar | Arquiteto + PO |
| FP4 | A | **Estratégia de travas incompleta e sem ordem global.** D5 trava a Casa (ADMIN) ou o usuário (não ADMIN); D7 trava a Casa de destino. Ficam sem trava: o **usuário-alvo** em `POST /casa/membros`, a Casa de origem a ser apagada, a Casa do usuário em `DELETE /me` (D8), `remover` e `PATCH papel`. Resultado: TOCTOU na transferência (M7), Casa sem ADMIN em `DELETE /me` concorrente (M3/J5) e deadlock `40P01` virando 500 | ADR D5, D7, D8 | Registrar no ADR uma **regra única**: ordem de travas (Casa por id crescente, depois Usuário por id crescente), `Membro` relido sob trava, mapeamento de `40P01`/`40001` para retry. Adicionar teste de concorrência para cada combinação | Arquiteto |
| FP5 | A | **Snapshot de `papel`/`casaId` do `autenticar` usado pelo service.** O ADR D2 diz que o vínculo é lido por requisição (positivo), mas nada impõe que o service o releia sob trava; um duplo clique de LEITOR em `POST /assinaturas` pode criar duas Casas e duas assinaturas (cobrança dupla), e uma remoção concorrente deixa Casa vazia sem membro | ADR D2 e D5 | Regra no ADR: services de escrita **relêem** `Membro` do ator na transação com trava e decidem por ele. Caso de teste: duas requisições simultâneas de LEITOR | Arquiteto |
| FP6 | M | **`email` e `usuarioId` de todos os membros visíveis a LEITOR e EDITOR**; o `usuarioId` sequencial é o parâmetro das rotas de escrita | m2 2 e 3.1 | E-mail só para ADMIN (ou mascarado); expor identificador opaco no lugar do id sequencial se possível; justificar a necessidade de cada campo (LGPD) | PO |
| FP7 | M | **Ordem de validação de `POST /casa/membros` cria oráculo de contas mesmo com a Casa lotada**; 201 também não conta no limite de erros; `MEMBRO_NAO_TRANSFERIVEL` revela estado | m2 3.2; ADR D11 | Verificar vaga **antes** de consultar o e-mail; limite por IP além do por usuário; contar sucessos na janela de 1 h; auditar tentativas; aceite formal do PO do risco residual (equivalente a ACH-10) | Arquiteto + PO |
| FP8 | M | **Histórico de assinatura apagado por `ON DELETE CASCADE`** quando a Casa é removida (transferência de ADMIN solo; apagamento de ADMIN solo); `log_auditoria` perde `casa_id` (SetNull) e fica sem como ser agrupado | schema (`Assinatura.casa`) | Para pagamento real: `Restrict` ou arquivar; no MVP simulado, registrar como aceito. Para auditoria: guardar `casaId` em `detalhes` para eventos de remoção | Arquiteto |
| FP9 | M | **Sem chave de idempotência** em `POST /assinaturas`: retry por timeout após o commit gera 409 confuso; com gateway real, risco de cobrança dupla fora do banco | m5 3.4 | Aceitar `Idempotency-Key` (backlog) e documentar; no MVP, o 409 `ESTADO_INVALIDO` serve, mas o front precisa relê `GET /me` ao receber 409 | Arquiteto |
| FP10 | M | **Rotina sem alerta e fail-open**: se o cron para, ATIVA vencida segue vigente indefinidamente e `CANCELADA` vencida já é Individual só por leitura (inconsistência entre limite efetivo e membros vinculados, que só são desvinculados pelo job) | ADR D1, D6 | Alerta de ausência de execução; registrar o desvio de que membros extras permanecem vinculados após CANCELADA vencida até o job; ao adicionar membro, o limite já usa Individual (consistente). Limite de 200 por execução precisa de alerta de fila | DevOps + Arquiteto |
| FP11 | M | **Texto livre e dados de terceiros em e-mails**: nome da Casa e do ADMIN em e-mails para membros (adição, remoção, expiração). O contrato não define o conteúdo; risco de phishing (ACH-07 do M1 reaparece) | m2 3.2, 3.4; m5 3.8 | Definir no contrato o texto fixo e que não há links controlados pelo usuário; escapar sempre | Arquiteto + Back |
| FP12 | M | **`GET /assinaturas/atual` devolve `metodoPagamento` (marca e 4 dígitos) por rota ADMIN-only, mas `Perfil.assinatura` vai a todos**: ok; porém **EDITOR/LEITOR sem rota para saber o vencimento do benefício** além do Perfil. Sem risco; apenas registrar que `dataRenovacao` é visível a todos os membros | m5 3.5 e 5 | Aceitar; confirmar que `Perfil.assinatura` não traz `titularId` nem nome do titular | PO |
| FP13 | B | **`motivo` do cancelamento em texto livre** vai à auditoria e ao e-mail | m5 3.6 | Lista fechada de motivos ou texto sem armazenar além do necessário; escapar no e-mail | PO |
| FP14 | B | **Nome padrão da Casa deriva do nome do usuário** ("Casa de <primeiro nome>") e é gravado sem passar pela mesma validação de `nome` da Casa | m5 3.4, m2 3.4 | Reusar o `nomeSchema`/`casaNomeSchema` na construção do nome; truncar em 80 | Back |
| FP15 | B | **`DELETE /casa/membros/:id` responde 204 sem corpo e sem dupla confirmação no servidor** (RNF12 só no front) | m2 3.4 | Aceitar: a confirmação é UX; a trilha está na auditoria | PO |
| FP16 | B | **`PUT /pagamento/metodo` com `nome`** aceita caracteres Unicode de controle/bidi; só `<`/`>` e controle são barrados | m5 3.3 | Rejeitar também caracteres de formatação bidi (`U+202A–U+202E`, `U+2066–U+2069`) | Back |

Pontos positivos dos contratos (manter): papel e Casa lidos do banco a cada requisição (sem JWT com papel), id de Casa sempre do token, 404 uniforme para recurso de outra Casa, só `marca` e `ultimos4` gravados (I6), preço e limites lidos do servidor, `autorizar` por rota com matriz de teste (RNF31), índice único parcial de ADMIN por Casa, trava de linha em assinar e adicionar, rotina idempotente com transação por assinatura, auditoria em todos os eventos de plano e membros, rate limit por usuário nas rotas novas, `MEMBRO_NAO_TRANSFERIVEL` sem motivo, e a **decisão de não apagar Casa com produtos** (ADR D7) que evita destruição de dados de terceiros.

---

## 7. Checklist de revisão do código de M5 e M2

Marcar na revisão. `[B]` = bloqueante (não vai para produção sem corrigir).

### 7.1 Autorização e isolamento (RNF31)

- [ ] [B] Toda rota nova usa `autenticar` → `autorizar(...)` → `validar` → controller; nenhuma fora de `/auth` e `/internal` responde diferente de 401 sem token (teste que varre as rotas).
- [x] [B] Rotas ADMIN-only (`GET /assinaturas/atual`, `cancelar`, `reativar`, `POST/PATCH/DELETE /casa/membros...`, `PATCH /casa`) retornam 403 para EDITOR e LEITOR; 401 sem token; teste `testarMatrizDePapeis` em **cada** rota com as cinco colunas.
- [x] [B] `casaId` vem somente de `req.usuario.casaId`; `grep` em `req.body`, `req.params`, `req.query` não encontra `casaId`, `titularId`, `planoId`, `assinaturaId`, `papel` usados como fonte de decisão sem validação.
- [x] [B] `:usuarioId` consultado por `{ usuarioId, casaId }`; membro de outra Casa e inexistente produzem **a mesma** resposta 404 (corpo e código).
- [x] [B] `papel` aceito em `POST/PATCH` é `z.enum(['EDITOR','LEITOR'])`; `ADMIN` e outros valores: 422; nenhum `membro.create/update` grava `ADMIN` fora da promoção do herdeiro.
- [ ] Services de escrita **relêem** `Membro` do ator dentro da transação, sob trava; não decidem com `req.usuario.papel/casaId` (S2/FP5).
- [ ] Nenhum módulo lê `assinatura`/`plano` para decidir limites fora de `plano.service` (`grep prisma.assinatura|prisma.plano`).
- [x] `limitar(...porUsuario)` vem **depois** de `autenticar` em todas as rotas (senão a chave cai no IP).
- [ ] `select` explícito nas consultas de membros: nunca `senhaHash`, códigos, tokens; `include: { usuario: true }` não aparece.
- [ ] `:usuarioId` validado com `int().positive().max(2147483647)`.

### 7.2 Assinatura e pagamento

- [x] [B] Corpo de `POST /assinaturas` só aceita `plano` e `confirmaSaidaDaCasa`; preço, limites e datas vêm do servidor.
- [ ] [B] `PAGAMENTO_SIMULADO` (ou equivalente) é **recusado em produção** no `env.ts`; o gateway real, quando existir, vive atrás da mesma interface.
- [x] [B] PAN, validade, nome e CVV **não** aparecem em: logs, auditoria, `detalhes` do 422, mensagens de erro, banco (`SELECT` em todas as tabelas), resposta, snapshot de teste, `console.*`.
- [x] [B] Fluxo de assinar, trocar, cancelar e reativar em **uma transação** com `SELECT ... FOR UPDATE` antes de ler o estado; transições por `updateMany` condicional com contagem 1.
- [x] [B] Teste de concorrência: N `POST /assinaturas` simultâneos do mesmo usuário (ADMIN e LEITOR) resultam em 1 assinatura vigente, 1 cobrança e 1 Casa nova; os demais respondem 409 (não 500).
- [x] Recusa de pagamento (`0000`) não altera Casa, assinatura anterior nem papel; há log `PAGAMENTO_RECUSADO` sem cartão.
- [x] Cancelar: só ATIVA da Casa do token; cancelar CANCELADA, EXPIRADA, vencida ou Individual: 409; `motivo` com limite e sem `<>`/controle.
- [x] Reativar: só CANCELADA com `dataRenovacao > agora`, checado **na transação**.
- [x] `GET /pagamento/metodo` e `PUT` operam somente no usuário do token; teste: A não lê/altera o de B.
- [x] `ultimos4` e `marca` são os únicos campos gravados em `metodo_pagamento`; `MetodoPagamento` removido com o usuário (cascade).
- [x] Rate limits: assinar, método, cancelar e reativar 10/15 min por usuário (contando sucessos e erros).
- [x] E-mail de confirmação/cancelamento: texto fixo, valores escapados, falha de envio não desfaz a transação.
- [x] `Perfil.assinatura` não expõe `titularId`, nem dados de cartão.

### 7.3 Limite de membros e cota

- [x] [B] `POST /casa/membros` trava a Casa de destino, conta membros e insere **na mesma transação**; teste com `Promise.all` e 1 vaga: 1 sucesso.
- [ ] [B] Toda inclusão em `Membro` (adicionar, assinar como membro, remover, expiração, exclusão, herdeiro) passa por função única que checa vaga/consistência; busca `prisma.membro.(create|update|upsert|delete)` revisada linha a linha.
- [ ] Ordem das validações de `POST /casa/membros` com **vaga e papel antes da consulta do e-mail** (M5/FP7); teste mostra que Casa lotada não revela existência de conta.
- [x] `details` de `LIMITE_MEMBROS` e `PLANO_NAO_COMPORTA` só trazem dados da própria Casa.
- [x] ATIVA vencida = vigente; CANCELADA vencida = Individual (testes) e as duas regras só existem em `plano.service`.

### 7.4 Membros, papéis e a Casa

- [x] [B] ADMIN não altera nem remove a si mesmo (`ESTADO_INVALIDO`); nenhuma rota deixa Casa sem ADMIN; teste de invariante ao fim dos cenários: toda Casa com membros tem exatamente 1 ADMIN.
- [ ] [B] Transferência: relê e **trava o usuário-alvo**; reavalia titular, ADMIN com membros e produtos **dentro** da transação; ordem de trava (Casa por id, depois usuário por id); `40P01`/`40001` mapeados (retry ou 409).
- [x] [B] Casa de origem **não** é removida se tiver produtos (conferido sob trava); remoção explícita e ordenada (sem confiar só em cascade).
- [ ] [B] Existe (ou há decisão formal do PO sobre) rota de saída da Casa para EDITOR/LEITOR e/ou convite com aceite (FP1/FP2). Sem nenhum dos dois, o PO registra o risco M4 como aceito por escrito.
- [x] Papel igual ao atual: 200 sem alteração e **sem** log; mesmo nome da Casa: 200 sem log.
- [ ] `PATCH /casa`: `nome` validado (1–80, sem `<>`/controle/bidi), só para ADMIN, em **sua** Casa; nome padrão da Casa também usa o schema.
- [ ] `GET /casa/membros`: ordem e campos conforme decisão P2/FP6; sem dados de outra Casa.
- [x] Remover membro: Casa Individual criada, `adicionadoPorId = null` nos produtos, auditoria `MEMBRO_REMOVIDO` e `CASA_CRIADA`, e-mail pós-commit.
- [ ] 6.2: auditoria `MEMBRO_ADICIONADO` **sem e-mail** do alvo; tentativas negadas contadas sem e-mail em claro (M5/M12).

### 7.5 Exclusão de conta e rotinas

- [ ] [B] Herdeiro escolhido entre membros com `exclusaoSolicitadaEm IS NULL` (preferindo EDITOR, depois mais antigo, depois menor id); sem herdeiro: tratamento de ADMIN solo.
- [ ] [B] `DELETE /me` do ADMIN: expira a assinatura (`TITULAR_EXCLUIDO`), promove herdeiro, cria Casas dos demais, grava auditoria, tudo na mesma transação do bloqueio da conta; trava a Casa; teste de **duas exclusões concorrentes** na mesma Casa.
- [x] [B] `expirarAssinaturas` é idempotente e concorrente-segura: `updateMany` condicional com contagem 1; duas execuções simultâneas = 1 efeito; uma transação por assinatura; falha de uma não impede as demais.
- [x] Renovação avança a partir de `dataRenovacao` anterior, com **uma** cobrança simulada mesmo após job parado; recusa → EXPIRADA (`RECUSA`).
- [x] Expiração: ADMIN permanece, membros extras ganham Casa própria Individual (ADMIN), auditoria `ASSINATURA_EXPIRADA`, `MEMBRO_REMOVIDO`, `CASA_CRIADA`; e-mails só **depois** do commit.
- [ ] `POST /internal/jobs`: `x-jobs-token` com `timingSafeEqual`, sem alias, `JOBS_TOKEN` >= 32 chars e diferente do exemplo em produção (herdado de ACH-02/05); ordem: expirar/renovar antes de apagar contas; resposta `{ expiradas, renovadas, apagadas }` sem dados pessoais.
- [ ] Após apagar conta: sem `metodo_pagamento`, sem `titular_id`, sem `Membro` do usuário; Casa vazia removida.

### 7.6 Auditoria, logs e LGPD

- [ ] Todas as 16 ações de ADR D9 existem em `ACOES_AUDITORIA` e são gravadas **na mesma transação** da mudança.
- [ ] `detalhes` sem e-mail, senha, cartão; `de/para` de nome de Casa e `motivo` tratados conforme P6 (retenção/anonimização na exclusão de conta).
- [ ] 403 e 404 de IDOR registrados em log de segurança com `usuarioId` do chamador (sem PII de terceiros).
- [ ] `error.ts` não imprime corpo de requisição; nenhum `console.log(req.body)` em `pagamento`, `assinatura`, `casa`.
- [ ] Mensagens de erro nunca ecoam e-mail, nome ou Casa de terceiros.
- [ ] E-mails de adição/remoção/expiração: texto fixo, escapado, sem links controlados pelo usuário, sem nome de Casa no assunto.
- [ ] Política de privacidade cita: pagamento simulado, visibilidade dos dados entre membros, e como sair de uma Casa (P3, P10).

### 7.7 Front-end

- [ ] Tela 14: banner "pagamento simulado, use cartão de teste"; `autocomplete` adequado; PAN/CVV não vão a `localStorage`, `console`, URL nem estado global persistido; campo limpo após envio.
- [ ] Tela 24: aviso de saída da Casa **antes** de enviar; botão em carregando; ao receber 409, refaz `GET /me`.
- [x] Após assinar como membro ou mudar de Casa, o cache do TanStack Query é limpo por inteiro.
- [ ] UI de papéis (telas 11, 12, 22) só **esconde** ações; a API é a barreira (não confiar no perfil em cache).
- [x] Modal de remoção/cancelamento exige confirmação explícita (RNF12); sem `dangerouslySetInnerHTML`; nomes de membros e da Casa renderizados como texto.
- [ ] E-mails dos membros mascarados conforme decisão P2.

### 7.8 OWASP Top 10 (a marcar no PR)

- [ ] A01 Controle de acesso: seções 7.1 e 7.4
- [ ] A02 Falhas criptográficas: PAN/CVV não gravados; `JOBS_TOKEN` forte
- [x] A03 Injeção: Prisma sem SQL cru, exceto `FOR UPDATE` (usar `$queryRaw` parametrizado, **sem** interpolação de string)
- [ ] A04 Design inseguro: itens FP1 a FP5 decididos
- [ ] A05 Configuração insegura: gateway simulado barrado em produção
- [ ] A06 Componentes vulneráveis: `npm audit` no CI (herdado)
- [ ] A07 Autenticação: reautenticação em ações destrutivas (backlog)
- [x] A08 Integridade: rotina idempotente, transações
- [ ] A09 Logs e monitoramento: seção 7.6, alerta de job parado
- [ ] A10 SSRF: não se aplica (sem chamadas externas novas; gateway real, no futuro, entra na revisão)

---

## 8. Riscos aceitos até decisão formal

| Risco | Dono da decisão | Registro |
|---|---|---|
| Adição direta sem aceite (captura de contas novas, sem saída) | PO | **Não aceito** sem rota de saída (FP2) e sem plano de convite com aceite (FP1) |
| Enumeração de e-mails em `POST /casa/membros` (404 x 409 x 201) | PO | Pendente: aceitar com limites e ordem de validação corrigida (FP7), como ACH-10 |
| E-mail dos membros visível a todos os papéis | PO | Pendente (FP6/P2) |
| Gateway simulado em produção | Arquiteto + PO | Aceito **somente** com trava de `env` e banner (FP3); risco financeiro zero, risco de PAN real só mitigado por S6 |
| ATIVA vencida segue vigente se o job parar | Arquiteto + DevOps | Aceito no MVP com alerta (FP10) |
| `ON DELETE CASCADE` de assinatura ao apagar Casa | Arquiteto | Aceito no MVP simulado; mudar antes de cobrança real (FP8/P8) |
| Sem idempotency-key | Arquiteto | Aceito no MVP (FP9) |
| Rate limit em memória | Arquiteto | Herdado do M1 (F9) |
| Menores no plano Família | PO | Pendente (P12) |

---

## 9. Top 10 riscos (ordem de prioridade)

1. **M4/FP1/FP2:** adição direta de membros sem aceite e sem rota de saída captura contas novas e dados.
2. **S4/S6/FP3:** gateway simulado sem trava de produção e aceitando PAN real.
3. **S2/FP5/S7:** snapshot de papel/Casa e travas incompletas: cobrança dupla e Casas duplicadas.
4. **M3/J5/FP4:** Casa sem ADMIN ou herdeiro condenado em exclusões concorrentes; sem ordem global de travas (deadlock vira 500).
5. **M7:** TOCTOU na transferência (alvo vira titular ou ganha produtos entre a checagem e o `UPDATE`).
6. **M5/FP7:** enumeração de e-mails e oráculo de estado (`MEMBRO_NAO_TRANSFERIVEL`), limite que não conta o 201.
7. **S5:** PAN/CVV vazando por log, erro do Zod ou `console.error`.
8. **M2/S1/X1:** IDOR e autorização esquecida em rota nova (matriz de teste obrigatória).
9. **P2/FP6/M11:** e-mail e id de todos os membros visíveis a todos os papéis (LGPD).
10. **J1/J2/FP10:** rotina concorrente, `JOBS_TOKEN` fraco (ACH-02 ainda aberto) e fail-open se o cron parar.


---

## 10. Revisão de código da Sprint 2 (AppSec)

Resultado: **sem vulnerabilidade crítica/alta**; aprovado com ressalvas. Itens `[x]` do checklist foram verificados no código; os demais ficam abertos.

Ressalvas bloqueantes ([B]) ainda abertas, a tratar antes de produção:
- 7.2 (`[B]` 196): não há trava de produção do gateway simulado em `config/env.ts` e o servidor aceita qualquer PAN com Luhn válido, mais nome e CVV sem uso (FP3). Corrigir com `PAGAMENTO_SIMULADO` recusado em produção, aceitar só PANs de teste e remover `cvv` e `nome`.
- 7.3 (`[B]` 220): `40P01`/`40001` não são mapeados no `error.ts` (deadlock vira 500). O job de vencimento não trava a Casa.
- 7.3 (`[B]` 222): falta rota de saída da Casa para EDITOR/LEITOR (FP2). A movimentação sem consentimento está aceita pelo PO (decisão 23), sem registro formal do risco M4.
- 7.4 (`[B]` 231): `tratarExclusaoDeConta` escolhe o herdeiro sem filtrar `exclusaoSolicitadaEm IS NULL` (hoje inalcançável, porque EDITOR/LEITOR saem no pedido; filtrar mesmo assim).

Achados (arquivo:linha em backend/src):
- `modules/casa/membros.service.ts:82-84`: a consulta do e-mail vem antes da vaga (FP7); Casa Individual enumera e-mails (404 x 409).
- `lib/campos.ts:61`: `idSchema` sem `.max(2147483647)`; `:usuarioId` enorme estoura o int4 no Postgres e vira 500.
- `modules/casa/membros.service.ts:53-73`: e-mail e `usuarioId` de todos os membros para todos os papéis (FP6).
- `modules/assinatura/vencimento.service.ts:34-115`: sem trava da Casa; corrida estreita com `adicionarMembro` deixa Casa Individual com membro a mais.
- `modules/casa/casa.schema.ts:19-28` e `assinatura.schema.ts:55-61`: caracteres bidi aceitos.
- `npm audit --omit=dev`: backend com 3 altas na cadeia `prisma` > `@prisma/config` > `deepmerge-ts` (esgotamento de pilha ao mesclar grafos recursivos; só no CLI e na config do Prisma, sem entrada de usuário). Frontend: 0.
