# Contrato da API — M5 Planos e Assinatura

Referência única para Back-end e Front-end (o Front-end implementa **somente** a partir deste documento).
Convenções gerais (URL base, formato, token, erro `{ error, message, details? }`, rate limit global) estão em [`m1-auth.md`](m1-auth.md), seções 1 e 2. Decisões e justificativas: [ADR 0002](../adr/0002-m5-m2.md). Complementa a Tabela 17 (`docs/05-diagramas/5.5-diagrama-operacao.md`).
Os schemas Zod ficam em `backend/src/modules/assinatura/assinatura.schema.ts` e **devem** refletir exatamente os campos abaixo.

## 1. Regras de negócio que o front precisa conhecer

- **Plano Individual não é assinatura.** Casa sem assinatura vigente está no Individual (R$ 0,00, 1 membro, 1 GB). Voltar ao Individual é **cancelar** (benefícios até a data de renovação).
- **Estados da assinatura:** PENDENTE (transitório, interno, nunca aparece) → ATIVA → CANCELADA → EXPIRADA. Só ATIVA e CANCELADA são "vigentes". CANCELADA mantém os benefícios até `dataRenovacao`; depois disso a Casa é Individual, mesmo antes de a rotina horária marcar EXPIRADA.
- **Pagamento simulado:** aprovado por padrão; **recusado quando o cartão termina em `0000`** (cartão de teste de recusa: `4111 1100 0005 0000`). Cartão de teste aprovado: `4242 4242 4242 4242`. Nada sai do sistema.
- **Renovação:** mensal e automática enquanto ATIVA (mesmo registro, `dataRenovacao` avança 1 mês de calendário). Sem e-mail de aviso; o aviso é a data nas telas 05 e 15. Renovação recusada ou assinatura CANCELADA vencida: EXPIRADA, a Casa volta ao Individual e cada membro extra passa a ter uma Casa própria (o ADMIN fica).
- **Troca de plano:** cria uma assinatura nova na hora (sem cálculo proporcional); a anterior fica EXPIRADA. Não há "trocar para o mesmo plano": se está CANCELADA do mesmo plano, use reativar.
- **Quem assina:** qualquer papel. ADMIN assina para a própria Casa. EDITOR e LEITOR assinam sabendo que **saem da Casa atual e viram ADMIN de uma Casa nova** (aviso da tela 24, confirmado em `confirmaSaidaDaCasa`).
- **Cota:** limite de membros e de armazenamento vêm do plano vigente. GB em base binária (1 GB = 1.073.741.824 bytes).

## 2. Tipos compartilhados

```ts
type NomePlano = 'INDIVIDUAL' | 'FAMILIA' | 'BUSINESS';
type StatusAssinatura = 'ATIVA' | 'CANCELADA';          // só as vigentes aparecem na API
type MarcaCartao = 'VISA' | 'MASTERCARD' | 'AMEX' | 'ELO' | 'OUTRA';

interface PlanoDetalhe {
  id: number;
  nome: NomePlano;
  preco: string;                 // "0.00" | "19.90" | "49.90" (mensal, decimal em string)
  limiteMembros: number;         // 1 | 6 | 15
  limiteArmazenamentoGb: number; // 1 | 20 | 100
}

interface AssinaturaAtual {
  id: number;
  status: StatusAssinatura;
  plano: PlanoDetalhe;
  dataInicio: string;            // ISO 8601 UTC
  dataRenovacao: string;         // próxima cobrança (ATIVA) ou fim dos benefícios (CANCELADA)
  dataCancelamento: string | null;
  renovaAutomaticamente: boolean; // true se ATIVA
  podeReativar: boolean;         // true se CANCELADA e dataRenovacao > agora
}

interface MetodoPagamento {
  marca: MarcaCartao;
  ultimos4: string;              // "4242"
  atualizadoEm: string;
}

interface UsoDaCasa {
  membros: { emUso: number; limite: number };
  armazenamento: { usadoBytes: number; limiteBytes: number };
}
```

## 3. Rotas

Todas exigem `Authorization: Bearer` (valem `401 NAO_AUTENTICADO` e `401 SESSAO_EXPIRADA`, `429` global e `500`). O id da Casa vem sempre do token, nunca do corpo ou da URL.

| # | Método e caminho | Papel | Resumo | História |
|---|---|---|---|---|
| 1 | `GET /planos` | ADMIN, EDITOR, LEITOR | Lista os planos e indica o vigente da Casa | 7.1 |
| 2 | `GET /pagamento/metodo` | ADMIN, EDITOR, LEITOR | Método de pagamento do usuário (ou nulo) | 7.3 |
| 3 | `PUT /pagamento/metodo` | ADMIN, EDITOR, LEITOR | Cadastra ou troca o método (simulado) | 7.3 |
| 4 | `POST /assinaturas` | ADMIN, EDITOR, LEITOR | Assina ou troca de plano (pagamento simulado) | 7.2, 7.6 |
| 5 | `GET /assinaturas/atual` | **ADMIN** | Minha assinatura (tela 15) | 7.4 |
| 6 | `POST /assinaturas/atual/cancelar` | **ADMIN** | Cancela mantendo benefícios até a renovação | 7.4 |
| 7 | `POST /assinaturas/atual/reativar` | **ADMIN** | Religa a renovação antes da data | 7.4 |
| 8 | `POST /internal/jobs` | chave interna | Rotina horária (expirar, renovar, apagar contas) | 7.5 |

### 3.1 `GET /planos` (UC019, RF12, RF14)

Resposta `200`:

```json
{
  "planos": [
    { "id": 1, "nome": "INDIVIDUAL", "preco": "0.00",  "limiteMembros": 1,  "limiteArmazenamentoGb": 1 },
    { "id": 2, "nome": "FAMILIA",    "preco": "19.90", "limiteMembros": 6,  "limiteArmazenamentoGb": 20 },
    { "id": 3, "nome": "BUSINESS",   "preco": "49.90", "limiteMembros": 15, "limiteArmazenamentoGb": 100 }
  ],
  "planoAtual": "INDIVIDUAL",
  "assinatura": null
}
```

- `planos`: sempre os três, nesta ordem. Os textos de benefícios são do front.
- `planoAtual`: plano **efetivo** da Casa do usuário (selo "Plano atual"). `assinatura`: `{ status, dataRenovacao }` ou `null` (no Individual); com `CANCELADA` o front mostra o aviso "benefícios até dd/mm".
- O cartão Individual não tem botão Assinar. Erros: só os globais.

### 3.2 `GET /pagamento/metodo`

`200 { "metodo": MetodoPagamento | null }`. `null` = ainda não tem método: o front mostra só "Adicionar novo cartão" e desabilita o botão de pagar.

### 3.3 `PUT /pagamento/metodo` (RF15, RNF04)

Corpo:

```json
{ "numero": "4242 4242 4242 4242", "validade": "12/29" }
```

| Campo | Regra |
|---|---|
| `numero` | obrigatório; espaços e hifens são ignorados; 13 a 19 dígitos; passa no algoritmo de Luhn; **só cartões de teste**: `4242 4242 4242 4242` (aprovado) e `4111 1100 0005 0000` (recusa). Qualquer outro número, mesmo válido, é `422` (nenhum cartão real deve trafegar pelo servidor) |
| `validade` | obrigatório; `MM/AA`; mês 01 a 12; não pode estar vencida (vale até o último dia do mês) |

Efeito: o usuário passa a ter **um** método (substitui o anterior). **Só marca e 4 últimos dígitos são gravados**: número completo e validade são descartados e nunca logados nem devolvidos. **Nome do titular e CVV não são coletados** (campos removidos do contrato; se o cliente os enviar, o servidor os ignora). A marca é detectada pelo prefixo do número. Auditoria `METODO_PAGAMENTO_ALTERADO` (sem dados do cartão). Limite: 10 por 15 min por usuário.

Resposta `200 { "metodo": MetodoPagamento }`. Erros: `422 DADOS_INVALIDOS` com `details` por campo (`numero`, `validade`); `429`; `503 PAGAMENTO_INDISPONIVEL` quando o gateway simulado está desligado (produção, onde `PAGAMENTO_SIMULADO=true` é recusado na inicialização). O banner da tela 14 deve mandar usar o cartão de teste.

### 3.4 `POST /assinaturas` (UC028, RF13, RF15, RF37, RF38)

Corpo:

```json
{ "plano": "FAMILIA", "confirmaSaidaDaCasa": true }
```

| Campo | Regra |
|---|---|
| `plano` | obrigatório; `"FAMILIA"` ou `"BUSINESS"` (`INDIVIDUAL` ou outro valor: `422 DADOS_INVALIDOS`) |
| `confirmaSaidaDaCasa` | opcional (booleano). **Obrigatório `true` para EDITOR e LEITOR** (aviso da tela 24); **ignorado para ADMIN** |

O método de pagamento usado é o salvo do usuário (rota 3); não há campo de cartão aqui. Ordem das validações (a primeira que falhar responde): corpo → aviso → método presente → mesmo plano → encaixe no plano → pagamento.

**ADMIN:** assina na própria Casa; os membros e o armazenamento atuais precisam caber no plano. Se já há assinatura vigente de outro plano, ela vira EXPIRADA (motivo `TROCA`) e nasce uma nova ATIVA, na mesma transação.
**EDITOR ou LEITOR:** em uma transação, sai da Casa atual, uma Casa nova ("Casa de <primeiro nome>") é criada, ele vira o ADMIN dela e a assinatura nasce nessa Casa. Os produtos que ele cadastrou continuam na Casa antiga sem autor. A Casa nova tem 1 membro e 0 bytes: sempre cabe.

Resposta `201`:

```json
{
  "assinatura": { "id": 7, "status": "ATIVA", "plano": { "id": 2, "nome": "FAMILIA", "preco": "19.90", "limiteMembros": 6, "limiteArmazenamentoGb": 20 },
                  "dataInicio": "2026-11-15T17:00:00.000Z", "dataRenovacao": "2026-12-15T17:00:00.000Z",
                  "dataCancelamento": null, "renovaAutomaticamente": true, "podeReativar": false },
  "perfil": { "...": "Perfil completo atualizado (m1-auth.md, seção 2)" }
}
```

O front **substitui** o cache do perfil por `perfil` e **limpa o cache inteiro** do TanStack Query quando a Casa mudou (`perfil.casa.id` diferente da anterior). Não há token novo: o token atual segue válido.

Erros:

| HTTP | `error` | Quando | `details` |
|---|---|---|---|
| 402 | `PAGAMENTO_RECUSADO` | Cartão do usuário termina em `0000`. Nada muda (nem Casa nem assinatura anterior) | — |
| 409 | `ESTADO_INVALIDO` | ADMIN escolheu o plano da assinatura vigente (ATIVA ou CANCELADA vigente) | — |
| 422 | `DADOS_INVALIDOS` | `plano` ausente, `INDIVIDUAL` ou desconhecido; `confirmaSaidaDaCasa` não booleano | `[{ campo, mensagem }]` |
| 422 | `AVISO_NAO_CONFIRMADO` | EDITOR/LEITOR sem `confirmaSaidaDaCasa: true`. Nada é criado | — |
| 422 | `METODO_PAGAMENTO_AUSENTE` | Usuário sem método salvo (cadastre pela rota 3) | — |
| 422 | `PLANO_NAO_COMPORTA` | Membros ou armazenamento atuais da Casa excedem o plano (só ADMIN) | `{ plano, violacoes: [{ limite: 'MEMBROS' \| 'ARMAZENAMENTO', atual, maximo }] }` (armazenamento em bytes) |
| 429 | `MUITAS_TENTATIVAS` | Mais de 10 pedidos em 15 min por usuário | — |

Auditoria: `ASSINATURA_CRIADA` (+ `PLANO_ALTERADO` na troca, `ASSINATURA_EXPIRADA` motivo `TROCA` na anterior); para não ADMIN também `MEMBRO_SAIU_DA_CASA` e `CASA_CRIADA`; na recusa, `PAGAMENTO_RECUSADO`. E-mail de confirmação ao titular (falha de e-mail não desfaz a assinatura). Duplo clique: o botão deve ficar em estado de carregando; no servidor, pedidos simultâneos resultam em no máximo uma assinatura vigente (o segundo recebe `409 ESTADO_INVALIDO`).

### 3.5 `GET /assinaturas/atual` (tela 15, UC031)

Só ADMIN. Resposta `200`:

```json
{
  "assinatura": { "id": 7, "status": "CANCELADA", "plano": { "...": "PlanoDetalhe" },
                  "dataInicio": "2026-11-15T17:00:00.000Z", "dataRenovacao": "2026-12-15T17:00:00.000Z",
                  "dataCancelamento": "2026-11-20T10:00:00.000Z", "renovaAutomaticamente": false, "podeReativar": true },
  "planoAtual": { "id": 2, "nome": "FAMILIA", "preco": "19.90", "limiteMembros": 6, "limiteArmazenamentoGb": 20 },
  "uso": { "membros": { "emUso": 3, "limite": 6 }, "armazenamento": { "usadoBytes": 0, "limiteBytes": 21474836480 } },
  "metodoPagamento": { "marca": "VISA", "ultimos4": "4242", "atualizadoEm": "2026-11-15T17:00:00.000Z" }
}
```

- Casa Individual: `200` com `"assinatura": null` (não é 404), `planoAtual` = Individual. `metodoPagamento` é o do próprio usuário (ou `null`).
- Erros: `403 SEM_PERMISSAO` (EDITOR/LEITOR; esses obtêm o essencial por `Perfil.assinatura`).

### 3.6 `POST /assinaturas/atual/cancelar` (UC031, RF16, RNF12)

Só ADMIN. Corpo opcional: `{ "motivo": "texto até 300 caracteres" }` (`trim`; vazio vira ausente; sem `<`, `>` nem caracteres de controle). O front pede confirmação (modal da tela 15) antes de chamar.

Efeito (assinatura ATIVA da Casa do token): status → CANCELADA, `dataCancelamento = agora`, renovação desligada; o plano vigente continua até `dataRenovacao`. Auditoria `ASSINATURA_CANCELADA` (com o motivo). E-mail ao ADMIN com a data de término.

Resposta `200 { "assinatura": AssinaturaAtual }`. Erros: `403 SEM_PERMISSAO`; `409 ESTADO_INVALIDO` (já CANCELADA, EXPIRADA, vencida ou Casa Individual sem assinatura); `422 DADOS_INVALIDOS` (motivo longo); `429` (10 por 15 min por usuário).

### 3.7 `POST /assinaturas/atual/reativar` (UC031, RF16)

Só ADMIN, sem corpo. Efeito (assinatura CANCELADA com `dataRenovacao > agora`): volta a ATIVA, `dataCancelamento = null`, renovação religada. Auditoria `ASSINATURA_REATIVADA`.

Resposta `200 { "assinatura": AssinaturaAtual }`. Erros: `403 SEM_PERMISSAO`; `409 ESTADO_INVALIDO` (não está CANCELADA, ou a data de renovação já foi alcançada, ou Casa Individual); `429`.

### 3.8 `POST /internal/jobs` (rotina, RF37, RNF16)

Cabeçalho `x-jobs-token` (comportamento do M1: sem chave ou com token de usuário, `401 NAO_AUTENTICADO`). Executa **nesta ordem**: expirar e renovar assinaturas, depois apagar contas. Resposta `200`:

```json
{ "expiradas": 1, "renovadas": 2, "apagadas": 0, "falhas": 0, "fotosOrfasApagadas": 0, "fotosOrfasPendentes": 0 }
```

- `expiradas`: assinaturas que viraram EXPIRADA (CANCELADA vencida ou renovação recusada); `renovadas`: ATIVAS vencidas cuja cobrança simulada foi aprovada; `apagadas`: contas apagadas (M1); `falhas` (aditivo): assinaturas que falharam nesta execução e serão reprocessadas na próxima (esperado 0; se > 0 o servidor registra `ALERTA expirarAssinaturas` no log, e o workflow pode falhar o job). A rotina trava a Casa antes de reler status e membros e refaz a transação em impasse (40P01/40001).
- `fotosOrfasApagadas` (aditivo, Sprint 3): objetos do S3 sem `Foto` gravada e com mais de 2 h apagados pela conciliação, que roda por último (ADR 0003, Q4/Q11); falha do S3 é registrada no log e não derruba a rotina.
- `fotosOrfasPendentes` (aditivo, Sprint 3): objetos órfãos já vencidos (mais de 2 h) que a conciliação **não conseguiu apagar** nesta execução (esperado 0; falha do S3 ou fim do orçamento de tempo de 45 s). A próxima execução retoma de onde parou. Definição normativa em [`m3-produtos.md`](m3-produtos.md), seção 1.
- Para cada expirada: Casa volta ao Individual, o ADMIN permanece, cada membro extra recebe Casa própria (RF37), produtos mantidos; logs `ASSINATURA_EXPIRADA` (motivo `CANCELAMENTO` ou `RECUSA`), `MEMBRO_REMOVIDO` e `CASA_CRIADA`; e-mail ao ADMIN e aos membros desvinculados. Idempotente.

## 4. Matriz de permissões (RNF31)

Esperado por papel do chamador. "Outra Casa" = ADMIN de uma Casa diferente: nenhuma rota recebe id de Casa, então ele só alcança a própria assinatura.

| Rota | Sem token | LEITOR | EDITOR | ADMIN | ADMIN de outra Casa |
|---|---|---|---|---|---|
| `GET /planos` | 401 | 200 | 200 | 200 | 200 (a própria Casa) |
| `GET /pagamento/metodo` | 401 | 200 | 200 | 200 | 200 (o próprio) |
| `PUT /pagamento/metodo` | 401 | 200 | 200 | 200 | 200 (o próprio) |
| `POST /assinaturas` | 401 | 201 (7.6) | 201 (7.6) | 201 | 201 (a própria) |
| `GET /assinaturas/atual` | 401 | 403 | 403 | 200 | 200 (a própria) |
| `POST /assinaturas/atual/cancelar` | 401 | 403 | 403 | 200 | 200 (a própria) |
| `POST /assinaturas/atual/reativar` | 401 | 403 | 403 | 200 | 200 (a própria) |

## 5. O que muda no Perfil (`GET /me`) quando o plano ou a Casa mudam

Formato em [`m1-auth.md`](m1-auth.md), seção 2. O campo novo é `assinatura` (nulo no Individual). O front deve refazer `GET /me` (ou usar o `perfil` da resposta) após qualquer evento abaixo; para eventos causados por outra pessoa ou pela rotina, o perfil muda na **próxima** leitura (não há push).

| Evento | `plano` | `assinatura` | `casa` | `papel` |
|---|---|---|---|---|
| ADMIN assina ou troca de plano | novo plano | ATIVA, nova `dataRenovacao` | igual | igual |
| EDITOR/LEITOR assina (7.6) | novo plano | ATIVA | **Casa nova** (`id` e `nome` novos, `totalMembros = 1`) | **ADMIN** |
| ADMIN cancela | igual (até a renovação) | `status: CANCELADA` | igual | igual |
| ADMIN reativa | igual | `status: ATIVA` | igual | igual |
| Renovação aprovada (job) | igual | `dataRenovacao` +1 mês | igual | igual |
| Expiração (job), para o ADMIN | **Individual** (limites 1 membro, 1 GB) | `null` | `totalMembros = 1` | igual |
| Expiração (job), para o membro extra | Individual | `null` | **Casa nova** (Individual, `totalMembros = 1`) | **ADMIN** |
| Adicionar membro (M2) | pode mudar para o plano da Casa nova | acompanha a Casa nova | Casa do ADMIN que adicionou | papel escolhido |
| Remover membro (M2) | Individual | `null` | Casa nova | ADMIN |

Detalhes de M2 em [`m2-casa.md`](m2-casa.md).

## 6. Códigos de erro novos (acrescentam-se à tabela 1.3 de `m1-auth.md`)

| HTTP | `error` | Quando | Mensagem sugerida ao usuário (front) |
|---|---|---|---|
| 503 | `PAGAMENTO_INDISPONIVEL` | Gateway simulado desligado (produção sem gateway real) | "Pagamento indisponível no momento." |
| 402 | `PAGAMENTO_RECUSADO` | Pagamento simulado recusado (cartão final 0000) | "Pagamento recusado. Tente outro cartão." |
| 409 | `ESTADO_INVALIDO` | A ação não vale no estado atual (assinar o mesmo plano, cancelar/reativar fora do estado, remover o próprio ADMIN) | "Esta ação não está disponível agora." (ou o texto específico da tela) |
| 409 | `COTA_EXCEDIDA` | (M3) Envio de foto passa do armazenamento do plano | "Sem espaço de armazenamento no plano." |
| 422 | `PLANO_NAO_COMPORTA` | Membros ou armazenamento atuais não cabem no plano escolhido | "Seu plano atual tem N membros e X GB em uso; remova membros ou escolha outro plano." |
| 422 | `AVISO_NAO_CONFIRMADO` | EDITOR/LEITOR sem confirmar a saída da Casa | "Confirme que você vai sair da Casa atual." |
| 422 | `METODO_PAGAMENTO_AUSENTE` | Assinar sem método de pagamento salvo | "Adicione um cartão para continuar." |

Os códigos de M2 estão em [`m2-casa.md`](m2-casa.md), seção 5.
