# Contrato da API — M2 Casa e Membros

Referência única para Back-end e Front-end (o Front-end implementa **somente** a partir deste documento).
Convenções gerais (URL base, formato, token, erro `{ error, message, details? }`, rate limit global) em [`m1-auth.md`](m1-auth.md), seções 1 e 2. Planos e assinatura em [`m5-assinatura.md`](m5-assinatura.md). Decisões e justificativas: [ADR 0002](../adr/0002-m5-m2.md).
Os schemas Zod ficam em `backend/src/modules/casa/casa.schema.ts` e **devem** refletir exatamente os campos abaixo.

## 1. Regras de negócio que o front precisa conhecer

- **Uma Casa por usuário, um ADMIN por Casa.** O ADMIN é o titular da assinatura. Papéis atribuíveis a membros: `EDITOR` e `LEITOR`. Ninguém vira ADMIN por estas rotas.
- **Adição direta:** o ADMIN informa o e-mail de uma conta já cadastrada; a pessoa entra na hora e recebe um e-mail de aviso (sem convite com aceite no MVP). Se ela estava em outra Casa, sai dela e vem para esta, em uma transação.
- **Quem não pode ser adicionado** (`MEMBRO_NAO_TRANSFERIVEL`): ADMIN de Casa com outros membros; titular de assinatura vigente; ADMIN sozinho cuja Casa tem produtos. A API não diz o motivo. Quem é ADMIN sozinho, sem assinatura e com Casa sem produtos, pode ser adicionado (a Casa vazia dele é removida).
- **Limite de membros** vem do plano vigente (Individual 1, Família 6, Business 15). No limite: `LIMITE_MEMBROS`; o front sugere trocar de plano.
- **Remover membro:** ele ganha uma Casa própria no plano Individual, da qual é ADMIN. Os produtos que ele cadastrou continuam na Casa, sem autor. Remover **não** muda a assinatura da Casa.
- **Papel e Casa valem na próxima requisição** do afetado, com o mesmo token (a API lê o vínculo do banco a cada chamada). O afetado só percebe ao refazer `GET /me` ou na próxima ação; não há push.
- **Nome da Casa:** 1 a 80 caracteres, sem `<`, `>` nem caracteres de controle. Por padrão "Casa de <primeiro nome>".

## 2. Tipos compartilhados

```ts
type Papel = 'ADMIN' | 'EDITOR' | 'LEITOR';
// PlanoDetalhe e StatusAssinatura: ver m5-assinatura.md, seção 2.

interface MembroDaCasa {
  usuarioId: number;     // é o id usado nas rotas /casa/membros/:usuarioId
  nome: string;
  email?: string;        // só o ADMIN recebe (minimização/LGPD); para EDITOR e LEITOR o campo vem ausente
  papel: Papel;
  entrouEm: string;      // ISO 8601 UTC
}
```

## 3. Rotas

Todas exigem `Authorization: Bearer` (valem `401 NAO_AUTENTICADO`, `401 SESSAO_EXPIRADA`, `429` global e `500`). O id da Casa vem **sempre** do token. Recursos por id são procurados dentro da Casa do token: se não estiverem nela, `404 NAO_ENCONTRADO` (nunca 403, para não revelar que existe). `:usuarioId` é inteiro de 1 a 2147483647; fora disso, `422 DADOS_INVALIDOS`.

| # | Método e caminho | Papel | Resumo | História |
|---|---|---|---|---|
| 1 | `GET /casa/membros` | ADMIN, EDITOR, LEITOR | Membros, plano e limite (tela 11) | 6.1 |
| 2 | `POST /casa/membros` | **ADMIN** | Adiciona um membro por e-mail (tela 12) | 6.2 |
| 3 | `PATCH /casa/membros/:usuarioId` | **ADMIN** | Troca o papel de um membro (tela 22) | 6.4 |
| 4 | `DELETE /casa/membros/:usuarioId` | **ADMIN** | Remove um membro, com confirmação no front (tela 22) | 6.3 |
| 5 | `PATCH /casa` | **ADMIN** | Renomeia a Casa | 6.0 |

`:usuarioId` é inteiro positivo; outro formato: `422 DADOS_INVALIDOS`.

### 3.1 `GET /casa/membros` (UC018, UC037, RF25)

Resposta `200`:

```json
{
  "casa": { "id": 4, "nome": "Casa de Ana" },
  "plano": { "id": 2, "nome": "FAMILIA", "preco": "19.90", "limiteMembros": 6, "limiteArmazenamentoGb": 20 },
  "assinatura": { "status": "ATIVA", "dataRenovacao": "2026-12-15T17:00:00.000Z" },
  "limiteMembros": 6,
  "membrosEmUso": 3,
  "membros": [
    { "usuarioId": 10, "nome": "Ana Souza", "email": "ana@keepit.test", "papel": "ADMIN",  "entrouEm": "2026-11-01T12:00:00.000Z" },
    { "usuarioId": 12, "nome": "Caio Lima", "email": "caio@keepit.test", "papel": "EDITOR", "entrouEm": "2026-11-05T09:00:00.000Z" },
    { "usuarioId": 15, "nome": "Bia Rocha", "email": "bia@keepit.test",  "papel": "LEITOR", "entrouEm": "2026-11-09T18:30:00.000Z" }
  ]
}
```

- Ordem: ADMIN primeiro, depois por `entrouEm` crescente (desempate por `usuarioId`). O front marca "(você)" comparando `usuarioId` com `Perfil.id`.
- `assinatura` é `null` no Individual. `limiteMembros` repete `plano.limiteMembros` por conveniência da barra de uso.
- **E-mail só para o ADMIN**: na resposta a EDITOR e LEITOR, `email` é omitido de todos os membros (o front mostra só o nome).
- Nunca devolve `senhaHash` nem dados de outra Casa.

### 3.2 `POST /casa/membros` (UC033, UC034, RF26, RNF13)

Corpo:

```json
{ "email": "caio@keepit.test", "papel": "LEITOR" }
```

| Campo | Regra |
|---|---|
| `email` | obrigatório; `trim` + minúsculas; formato de e-mail; até 120 caracteres |
| `papel` | opcional; `"EDITOR"` ou `"LEITOR"` (padrão `"LEITOR"`); `"ADMIN"` ou outro valor: `422 DADOS_INVALIDOS` |

Ordem das validações: corpo → **vaga no plano** → conta existente → já é da Casa → transferível → vaga (de novo, na transação). A vaga vem antes da consulta do e-mail para que uma Casa cheia (ex.: Individual) responda sempre `LIMITE_MEMBROS` e não revele quais e-mails têm conta. Limites por usuário: 20 por hora, 5 erros (404/409) por 15 min e 10 tentativas de qualquer resultado (os `201` contam) por 15 min. Tentativas negadas (`404`/`409` acima) geram auditoria `MEMBRO_ADICAO_NEGADA` com o código e um HMAC curto do e-mail (nunca o e-mail em claro). A checagem de vaga e a inclusão ocorrem na mesma transação, com a Casa travada (duas adições simultâneas não passam do limite). A pessoa recebe e-mail de aviso (falha de e-mail não desfaz). Produtos que ela cadastrou na Casa anterior ficam lá, sem autor.

Resposta `201`:

```json
{
  "membro": { "usuarioId": 12, "nome": "Caio Lima", "email": "caio@keepit.test", "papel": "LEITOR", "entrouEm": "2026-11-15T17:00:00.000Z" },
  "membrosEmUso": 3,
  "limiteMembros": 6
}
```

Erros (além dos globais):

| HTTP | `error` | Quando |
|---|---|---|
| 403 | `SEM_PERMISSAO` | EDITOR ou LEITOR |
| 404 | `USUARIO_NAO_ENCONTRADO` | E-mail sem conta KeepIT (mesma resposta para conta com exclusão solicitada). Mensagem: "A pessoa precisa ter uma conta KeepIT" |
| 409 | `MEMBRO_JA_NA_CASA` | A pessoa já é membro desta Casa (inclui o próprio ADMIN) |
| 409 | `MEMBRO_NAO_TRANSFERIVEL` | Ver seção 1. Sem `details` |
| 409 | `LIMITE_MEMBROS` | Casa já no limite do plano. `details`: `{ plano, limiteMembros, membrosEmUso }` |
| 422 | `DADOS_INVALIDOS` | E-mail inválido ou papel inválido (`details` por campo) |
| 429 | `MUITAS_TENTATIVAS` | Mais de 20 pedidos por hora ou 5 erros (404/409) em 15 min, por usuário |

Auditoria: `MEMBRO_ADICIONADO` (ADMIN, membro, papel, Casa anterior); se a Casa vazia da pessoa foi removida, `CASA_REMOVIDA`.

### 3.3 `PATCH /casa/membros/:usuarioId` (UC034, UC036, RF28)

Corpo: `{ "papel": "EDITOR" }` (`EDITOR` ou `LEITOR`; `ADMIN` ou outro: `422 DADOS_INVALIDOS`). Resposta `200 { "membro": MembroDaCasa }`. Papel igual ao atual: `200` sem alteração e sem log. A nova permissão vale na próxima requisição do membro.

| HTTP | `error` | Quando |
|---|---|---|
| 403 | `SEM_PERMISSAO` | EDITOR ou LEITOR |
| 404 | `NAO_ENCONTRADO` | Membro de outra Casa ou inexistente |
| 409 | `ESTADO_INVALIDO` | O alvo é o próprio ADMIN (o ADMIN não altera o próprio papel) |
| 422 | `DADOS_INVALIDOS` | Papel inválido ou `:usuarioId` não inteiro |

Auditoria: `MEMBRO_PAPEL_ALTERADO` (ADMIN, membro, papel anterior e novo).

### 3.4 `DELETE /casa/membros/:usuarioId` (UC035, RF27, RNF12)

Sem corpo. O front **pede confirmação** ("Remover <nome> da Casa?", com a nota de que os produtos dele continuam) antes de chamar. Efeito, em uma transação: o membro é desvinculado e ganha uma Casa própria Individual ("Casa de <primeiro nome>"), da qual é ADMIN; produtos que ele cadastrou ficam na Casa, sem autor; o limite de membros libera uma vaga. E-mail de aviso ao removido. Resposta `204`.

| HTTP | `error` | Quando |
|---|---|---|
| 403 | `SEM_PERMISSAO` | EDITOR ou LEITOR |
| 404 | `NAO_ENCONTRADO` | Membro de outra Casa ou inexistente |
| 409 | `ESTADO_INVALIDO` | O alvo é o próprio ADMIN (ele sai pela exclusão de conta) |
| 422 | `DADOS_INVALIDOS` | `:usuarioId` não inteiro |

Auditoria: `MEMBRO_REMOVIDO` (ADMIN, membro, Casa, Casa nova) e `CASA_CRIADA`.

### 3.5 `PATCH /casa` (RF32, RNF05)

Corpo: `{ "nome": "Família Souza" }`. `nome`: obrigatório; `trim`; 1 a 80 caracteres; sem `<`, `>`, caracteres de controle nem de formatação Unicode (ex.: U+202E). Resposta `200 { "casa": { "id": 4, "nome": "Família Souza" } }`. Mesmo nome: `200` sem log.

| HTTP | `error` | Quando |
|---|---|---|
| 403 | `SEM_PERMISSAO` | EDITOR ou LEITOR |
| 422 | `DADOS_INVALIDOS` | Nome vazio, só espaços, longo ou com caracteres proibidos (`details`: `[{ campo: "nome", mensagem }]`) |

Auditoria: `CASA_RENOMEADA` (nome anterior e novo). `Perfil.casa.nome` muda na próxima leitura; os demais membros veem o novo nome ao refazer `GET /me`.

### 3.6 `POST /casa/sair` (saída voluntária; fecha o risco de movimentação sem consentimento)

Sem corpo. Só **EDITOR e LEITOR** (ADMIN: `403 SEM_PERMISSAO`, pois a Casa nunca fica sem ADMIN). Em uma transação, com Casa e usuário travados: a pessoa sai da Casa, ganha uma Casa Individual própria ("Casa de <primeiro nome>") da qual é ADMIN, e os produtos que cadastrou ficam na Casa antiga sem autor. Resposta `200 { "perfil": Perfil }` (o front substitui o cache de `/me` e limpa o cache da Casa antiga). Erros: `409 ESTADO_INVALIDO` (já era ADMIN ao reconferir após a trava); `429` (10 por 15 min por usuário). Auditoria: `MEMBRO_SAIU_DA_CASA` (motivo `SAIU_PELA_PROPRIA_CONTA`) e `CASA_CRIADA`.

### Riscos aceitos (registro formal)

- **R-M2-1 · Adição direta sem consentimento (decisão 23 do PO, ADR 0002 D7).** Enquanto o convite com aceite estiver no backlog, qualquer ADMIN de Casa com plano pode mover para a sua Casa um EDITOR, LEITOR ou ADMIN solo sem produtos, apenas com o e-mail. Mitigações: `POST /casa/sair` (a pessoa volta a uma Casa própria quando quiser), bloqueio de ADMIN com membros, titular de assinatura e ADMIN solo com produtos (`MEMBRO_NAO_TRANSFERIVEL`), aviso por e-mail ao movido, auditoria das adições e negativas e limites de taxa. **Risco residual para o M4:** produtos que a pessoa cadastrar como EDITOR da Casa do ADMIN ficam com essa Casa ao sair (sem autor); o M3/M4 deve avisar o EDITOR dessa regra. Aceite do PO pendente de confirmação por escrito neste registro.

## 4. Matriz de permissões (RNF31)

| Rota | Sem token | LEITOR | EDITOR | ADMIN | ADMIN de outra Casa |
|---|---|---|---|---|---|
| `GET /casa/membros` | 401 | 200 | 200 | 200 | 200 (a lista da Casa dele) |
| `POST /casa/membros` | 401 | 403 | 403 | 201 | 201 (adiciona à Casa dele) |
| `PATCH /casa/membros/:usuarioId` | 401 | 403 | 403 | 200 | **404** (o membro não está na Casa dele) |
| `DELETE /casa/membros/:usuarioId` | 401 | 403 | 403 | 204 | **404** |
| `PATCH /casa` | 401 | 403 | 403 | 200 | 200 (renomeia a Casa dele) |
| `POST /casa/sair` | 401 | 200 | 200 | **403** | 403 (é o ADMIN da Casa dele) |

## 5. Códigos de erro novos (acrescentam-se à tabela 1.3 de `m1-auth.md`)

| HTTP | `error` | Quando | Mensagem sugerida ao usuário (front) |
|---|---|---|---|
| 404 | `USUARIO_NAO_ENCONTRADO` | Adicionar e-mail sem conta KeepIT | "A pessoa precisa ter uma conta KeepIT" |
| 409 | `LIMITE_MEMBROS` | Casa no limite do plano | "Sua Casa atingiu o limite de membros do plano." + link para trocar de plano |
| 409 | `MEMBRO_JA_NA_CASA` | Adicionar quem já é da Casa | "Esta pessoa já faz parte da sua Casa" |
| 409 | `MEMBRO_NAO_TRANSFERIVEL` | Pessoa que não pode mudar de Casa | "Esta pessoa não pode ser adicionada agora." |
| 409 | `ESTADO_INVALIDO` | Alterar ou remover o próprio ADMIN |
| 409 | `CONFLITO_CONCORRENTE` | Impasse no banco por pedidos simultâneos; nada foi gravado, repita o pedido | "Esta ação não está disponível." |

`ESTADO_INVALIDO`, `PLANO_NAO_COMPORTA` e demais códigos de plano: [`m5-assinatura.md`](m5-assinatura.md), seção 6.

## 6. O que muda no Perfil (`GET /me`) quando a Casa muda

Formato em [`m1-auth.md`](m1-auth.md), seção 2. Tabela completa por evento em [`m5-assinatura.md`](m5-assinatura.md), seção 5. Resumo de M2:

| Evento | Quem é afetado | O que muda no Perfil dele |
|---|---|---|
| Adicionado por um ADMIN | A pessoa adicionada | `casa` (da Casa do ADMIN), `papel` (escolhido), `plano` e `assinatura` (da Casa nova) |
| Removido pelo ADMIN | O removido | `casa` (Casa nova, `totalMembros = 1`), `papel = ADMIN`, `plano = INDIVIDUAL`, `assinatura = null` |
| Papel alterado | O membro | `papel` |
| Membro entra ou sai | Todos da Casa | `casa.totalMembros` |
| Casa renomeada | Todos da Casa | `casa.nome` |
| Exclusão de conta do ADMIN com outros membros | Herdeiro e demais | Herdeiro: `papel = ADMIN` (`plano = INDIVIDUAL`, `assinatura = null`, mesma Casa). Demais: Casa nova, `papel = ADMIN` |

Quando a Casa do usuário muda, o front limpa o cache inteiro do TanStack Query (os dados da Casa antiga não valem mais).

## 7. Exclusão de conta (`DELETE /me`): efeitos de M2 e M5 (UC013, fecha ACH-08)

Requisição e resposta não mudam (`m1-auth.md`, 3.11). Passam a valer estes efeitos, na mesma transação do bloqueio da conta (ADR 0002, D3 e D8):

| Quem exclui | Efeito |
|---|---|
| EDITOR ou LEITOR | O vínculo com a Casa é removido na hora (vaga liberada); produtos dele ficam sem autor; Casa e assinatura não mudam |
| ADMIN **sozinho** na Casa | A assinatura vigente, se houver, vai a EXPIRADA (`TITULAR_EXCLUIDO`); a rotina de 23 h apaga a conta e a Casa com todos os dados |
| ADMIN **com outros membros** | A assinatura vigente vai a EXPIRADA (`TITULAR_EXCLUIDO`); o membro mais antigo (preferindo EDITOR, e ignorando quem já pediu a própria exclusão) é promovido a ADMIN e **mantém a Casa e os produtos** (sem herdeiro elegível, vale o tratamento de ADMIN solo); todos os demais recebem Casa própria Individual; a Casa volta ao Individual |

O aviso da tela 21 para o ADMIN deve citar a assinatura (plano e `Perfil.assinatura.dataRenovacao`) e, havendo outros membros (`casa.totalMembros > 1`), que o membro mais antigo assumirá a Casa e os demais receberão Casas próprias. Para EDITOR, LEITOR e ADMIN solo o aviso não aparece.
