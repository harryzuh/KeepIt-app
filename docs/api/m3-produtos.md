# Contrato da API — M3 Produtos e Tags

Referência única para Back-end e Front-end (o Front-end implementa **somente** a partir deste documento).
Convenções gerais (URL base, formato, token, erro `{ error, message, details? }`, rate limit global) em [`m1-auth.md`](m1-auth.md), seções 1 e 2. Plano e cota em [`m5-assinatura.md`](m5-assinatura.md); papéis em [`m2-casa.md`](m2-casa.md). Decisões e justificativas: [ADR 0003](../adr/0003-m3.md).
Os schemas Zod ficam em `backend/src/modules/produtos/produtos.schema.ts` e `backend/src/modules/tags/tags.schema.ts` e **devem** refletir exatamente os campos abaixo.

> **Mudanças em relação à Tabela 17** (`docs/05-diagramas/5.5-diagrama-operacao.md`, já corrigida): (1) `COTA_EXCEDIDA` é **409**, não 422 (é o que o `plano.service` faz); (2) rotas novas `GET /tags` e `GET /produtos/:id/historico`; (3) campos novos `duplicado` e `duplicadoId` em `POST /produtos`; (4) códigos novos `LIMITE_FOTOS`, `PRODUTO_DUPLICADO`; (5) a confirmação das fotos acontece **ao salvar o produto** (não há rota `.../fotos/confirmar`).

## 1. Regras de negócio que o front precisa conhecer

- **Produto pertence à Casa**, nunca ao usuário. Todos os membros da Casa veem todos os produtos. A Casa vem **sempre do token**.
- **Permissões (RNF31):** `LEITOR` só consulta (`GET`). `EDITOR` e `ADMIN` criam, editam e excluem **qualquer** produto da Casa e criam tags. Esconder botões na tela é complemento: a API recusa com `403 SEM_PERMISSAO`.
- **Recurso de outra Casa ou inexistente:** `404 NAO_ENCONTRADO` (nunca 403, para não revelar que existe).
- **Campos do produto:**

| Campo | Regra |
|---|---|
| `nome` | obrigatório, 1 a 120 caracteres após `trim`; sem `<`, `>`, caracteres de controle nem invisíveis (categorias Unicode `Cc` e `Cf`, ex.: U+200B e U+202E; U+200D e U+FE0F, usados em emojis, são aceitos). A API normaliza para **NFC** e reduz espaços internos repetidos a um só |
| `descricao` | opcional (`null` ou omitido), até 1000 caracteres após `trim`; vazio vira `null`; sem `<`, `>`, controle nem invisíveis (quebra de linha e tabulação são permitidas); normalizada para NFC |
| `preco` | obrigatório, **somente string decimal** com ponto (`"1234.50"`), 0 a `"9999999999.99"`, no máximo 2 casas. **Número JSON é recusado** (`422 DADOS_INVALIDOS`, campo `preco`); responde sempre string. O front converte o formato brasileiro (`1.234,50`) antes de enviar |
| `quantidade` | obrigatório, inteiro de 1 a 1 000 000 |
| `dataCompra` | obrigatória, `"AAAA-MM-DD"`, data de calendário válida, **a partir de `1900-01-01`** e **não futura** (comparada com a data de hoje em `America/Sao_Paulo`) |
| `tagIds` | opcional, de 0 a 10 ids distintos, todos de tags **da própria Casa**; id de outra Casa ou inexistente → `422 DADOS_INVALIDOS` (sem revelar que existe) |
| `fotos` | opcional, até 3 (ver seção 5) |

- **Duplicidade (RF33):** no **cadastro**, se já existe na Casa produto com o mesmo `lower(trim(nome))` (sem normalizar acentos nem espaços internos), a API responde `409 PRODUTO_DUPLICADO` e **não grava nada**. O front abre a tela 09 com as opções **Somar à quantidade**, **Cadastrar mesmo assim** e **Cancelar** (Cancelar é só fechar o modal: não há chamada). Editar o nome para um já existente **não** bloqueia.
- **Fotos (seção 5):** JPEG ou PNG, até 5 MB (5 242 880 bytes), até 3 por produto; o navegador envia **direto ao S3** por URL assinada de 5 minutos; a API confere tudo de verdade quando o produto é salvo.
- **Cota de armazenamento (RF39):** soma de `tamanhoBytes` das fotos **gravadas** da Casa, contra o plano vigente. `GET /me` traz `uso.armazenamento` (`{ usadoBytes, limiteBytes }`) para **todos os papéis** (a tela 08 mostra o uso). `usadoBytes` soma o tamanho das imagens **já recodificadas** pela API (ver seção 5).
- **`GET /me` (aditivo, M1):** o `Perfil` ganha `uso: { armazenamento: { usadoBytes: number; limiteBytes: number } }` (também em `login`, `cadastro` e `PATCH /me`, que devolvem `Perfil`). Vale para todos os papéis.
- **`POST /internal/jobs` (aditivo):** a resposta ganha `fotosOrfasPendentes: number` (objetos órfãos vencidos que a conciliação não conseguiu apagar; esperado 0). A conciliação tem orçamento de tempo (45 s) e retoma de onde parou na execução seguinte. Os contratos `m1-auth.md` (`Perfil.uso` e 3.12) e `m5-assinatura.md` (3.8) já citam este campo e o `uso` do `Perfil` (Sprint 4, ADR 0004); este documento continua sendo a referência normativa.
- **Histórico (RF11):** um evento por salvamento que mudou algo; salvar sem mudança não gera evento. Visível a todos os papéis.
- **Exclusão:** definitiva, sem lixeira e sem desfazer; o front pede confirmação (tela 23, RNF12). Remove fotos (inclusive do S3) e vínculos com tags; as tags continuam existindo.
- **Autor que saiu da Casa:** `adicionadoPor` vem `null` (o front mostra "ex-membro"). Aviso ao EDITOR de que os produtos ficam na Casa: história 3.5 (só front).

## 2. Tipos compartilhados

```ts
type Papel = 'ADMIN' | 'EDITOR' | 'LEITOR';
type TipoImagem = 'JPEG' | 'PNG';

interface Tag { id: number; nome: string }

interface FotoLeitura {
  url: string;        // URL ASSINADA de leitura (GET), válida por **15 minutos** (`expiraEm`); a assinatura fixa `Content-Type`, `Content-Disposition: inline` e `Cache-Control: private`. Ver seção 6 sobre `VITE_S3_PROXY`.
  expiraEm: string;   // ISO 8601 UTC
}

interface Foto extends FotoLeitura {
  id: number;
  ordem: number;      // 0, 1, 2 (0 = capa)
  tipo: TipoImagem;
  tamanhoBytes: number;
}

interface ProdutoResumo {            // itens da lista (telas 05, 06, 17)
  id: number;
  nome: string;
  preco: string;                      // "1234.50"
  quantidade: number;
  dataCompra: string;                 // "2026-03-15"
  dataCadastro: string;               // ISO 8601 UTC
  tags: Tag[];                        // ordem alfabética sem diferenciar caixa
  fotoCapa: FotoLeitura | null;       // primeira foto (ordem 0) ou null
  adicionadoPor: { id: number; nome: string } | null;   // null = ex-membro
}

interface ProdutoDetalhe extends Omit<ProdutoResumo, 'fotoCapa'> {   // tela 07
  descricao: string | null;
  fotos: Foto[];                      // ordenadas por `ordem`
  atualizadoEm: string;               // ISO 8601 UTC
}

interface Pagina<T> {
  itens: T[];
  pagina: number;                     // 1-based
  limite: number;
  total: number;                      // total de itens que casam com o filtro
  totalPaginas: number;               // 0 se total = 0
}
```

Datas em ISO 8601 UTC; `dataCompra` é só data. O front formata em pt-BR e BRL (`R$ 1.234,50`).

## 3. Rotas

Todas exigem `Authorization: Bearer` (valem `401 NAO_AUTENTICADO`, `401 SESSAO_EXPIRADA`, `429 MUITAS_TENTATIVAS` e `500`). Ids em rotas são inteiros de 1 a 2147483647; outro formato → `422 DADOS_INVALIDOS`. Respostas com URL assinada saem com `Cache-Control: no-store`.

| # | Método e caminho | Papel | Resumo | UC · RF | História |
|---|---|---|---|---|---|
| 1 | `GET /tags` | ADMIN, EDITOR, LEITOR | Tags da Casa | UC023 · RF35 | 5.1 |
| 2 | `POST /tags` | ADMIN, EDITOR | Cria tag | UC023 · RF35 | 5.1 |
| 3 | `POST /produtos/fotos/upload-url` | ADMIN, EDITOR | URL assinada de envio de foto | UC021 · RF05, RF39 | 3.1.2 |
| 4 | `POST /produtos` | ADMIN, EDITOR | Cadastra produto (ou soma à quantidade) | UC020, UC022 · RF03, RF33 | 3.1, 3.1.4 |
| 5 | `GET /produtos` | ADMIN, EDITOR, LEITOR | Lista, busca e filtra | UC016 · RF10, RF34 | 3.2 |
| 6 | `GET /produtos/:id` | ADMIN, EDITOR, LEITOR | Detalhe | UC024 · RF36 | 3.2.3 |
| 7 | `PATCH /produtos/:id` | ADMIN, EDITOR | Edita campos, tags e fotos | UC025 · RF04 a RF08 | 3.3 |
| 8 | `DELETE /produtos/:id` | ADMIN, EDITOR | Exclui | UC026 · RF09 | 3.4 |
| 9 | `GET /produtos/:id/historico` | ADMIN, EDITOR, LEITOR | Eventos do produto | RF11 | 4.1 |

**Limites de requisição por usuário (RNF14):** `upload-url` 30/min; `POST /produtos` 60/min; `PATCH` 60/min; `DELETE` 60/min; `POST /tags` 30/min. Os `GET` seguem o limite global.

### 3.1 `GET /tags` (UC023)

Resposta `200`, ordenada por nome sem diferenciar caixa:

```json
{ "itens": [ { "id": 3, "nome": "Cozinha", "quantidadeProdutos": 4 }, { "id": 5, "nome": "Eletrônicos", "quantidadeProdutos": 2 } ] }
```

Sem paginação (tags são poucas). Só as tags da Casa do token.

### 3.2 `POST /tags` (UC023, RF35)

Corpo: `{ "nome": "Garantia" }`. `nome`: 1 a 40 caracteres após `trim`, sem `<`, `>` nem controle.
`201`: `{ "id": 9, "nome": "Garantia" }` (guarda o texto como foi digitado, já com `trim`).
Erros: `422 DADOS_INVALIDOS`; `409 TAG_EXISTENTE` quando já há tag com o mesmo nome **sem diferenciar caixa** (`"cozinha"` = `"Cozinha"`), com `details: { "existente": { "id": 3, "nome": "Cozinha" } }` para o front selecionar a existente; `403`.
Registra `TAG_CRIADA`.

### 3.3 `POST /produtos/fotos/upload-url` (UC021, RF05, RF39)

Pede a URL de **um** arquivo. Chame uma vez por foto. Funciona antes de o produto existir (cadastro) e na edição.

Corpo: `{ "tipo": "image/png", "tamanhoBytes": 482113, "substituiFotoIds": [12] }` (`substituiFotoIds` é opcional, até 3 ids; use na **troca de foto** na edição).

- `tipo`: `image/jpeg` ou `image/png`. Outro valor, ou `tamanhoBytes` ≤ 0 ou > 5 242 880 → `422 ARQUIVO_INVALIDO` (`message` "Use imagem JPEG ou PNG de até 5 MB").
- Corpo mal formado (campo ausente, tipo errado) → `422 DADOS_INVALIDOS`.
- A cota é conferida com o `tamanhoBytes` informado **somado aos envios já autorizados e ainda não salvos da Casa** (últimas 2 h): `usadoBytes + pendentes + tamanhoBytes > limite` → `409 COTA_EXCEDIDA` com `details: { plano, usadoBytes, limiteBytes }`. Isto é um aviso antecipado; a decisão final é ao salvar o produto. Na troca de foto, informe em `substituiFotoIds` as fotos gravadas que serão removidas: o aviso desconta o tamanho delas (saldo líquido, igual ao `PATCH`), então com a cota exatamente cheia a troca por foto de tamanho igual ou menor obtém a URL. Ids de outra Casa ou inexistentes são ignorados (não liberam cota). Id malformado → `422 DADOS_INVALIDOS`.
- **Teto de envios pendentes:** no máximo **10 por usuário** e **30 por Casa** emitidos nas últimas 2 h e ainda não salvos em um produto. Acima disso: `429 MUITAS_TENTATIVAS` (mensagem: salve o produto ou aguarde). Envio salvo em produto, ou com mais de 2 h, deixa de contar.

Resposta `200`:

```json
{
  "chave": "casas/4/pendentes/3f0c2b9e-6a1d-4c57-9d6e-0a8f6a2b7c11.png",
  "url": "http://s3:9000/keepit-fotos/casas/4/pendentes/3f0c...png?X-Amz-Algorithm=...&X-Amz-Signature=...",
  "metodo": "PUT",
  "cabecalhos": { "Content-Type": "image/png" },
  "expiraEm": "2026-11-15T17:05:00.000Z",
  "confirmarAte": "2026-11-15T19:00:00.000Z"
}
```

- `chave`: guarde e envie em `fotos` ao salvar o produto. É gerada pelo servidor (nunca use o nome do arquivo) e aponta para a área de **envio** (`pendentes/`). A chave **não é a da foto servida**: ao salvar, a API grava a imagem tratada em outra chave (`casas/<id>/fotos/...`) e apaga a de envio. Reusar a `chave` depois de salva dá `422 ARQUIVO_INVALIDO`; regravar na URL de envio não altera a foto já salva.
- `url`: use **exatamente como veio** (a assinatura cobre o caminho, a consulta e os cabeçalhos), aplicando só a regra de `VITE_S3_PROXY` da seção 6. `expiraEm` = 5 minutos.
- O envio é `PUT` com o **arquivo como corpo**, os `cabecalhos` indicados e **o mesmo número de bytes** de `tamanhoBytes` (`fetch(url, { method, headers: cabecalhos, body: file })`; o navegador define o `Content-Length`). Sem `Authorization` e sem outros cabeçalhos. Se o tamanho ou o tipo enviados diferirem dos assinados, o S3 responde `403`: peça uma URL nova.
- Resposta `403` do S3 depois dos 5 minutos = URL vencida: peça outra.
- `confirmarAte`: a foto enviada e **não salva** em um produto é apagada pela rotina de limpeza a partir deste instante (2 horas). Salvar depois disso responde `422 ARQUIVO_INVALIDO` e o front deve reenviar.

### 3.4 `POST /produtos` (UC020, UC022, RF03, RF06, RF07, RF08, RF10, RF33)

Corpo:

```json
{
  "nome": "Cafeteira Elétrica",
  "descricao": "Preta, 15 xícaras",
  "preco": "249.90",
  "quantidade": 1,
  "dataCompra": "2026-03-15",
  "tagIds": [3, 9],
  "fotos": [ { "chave": "casas/4/fotos/3f0c...png" } ],
  "duplicado": "SOMAR",
  "duplicadoId": 17
}
```

`descricao`, `tagIds`, `fotos`, `duplicado` e `duplicadoId` são opcionais. `casaId`, `adicionadoPorId` e `dataCadastro` **nunca** vêm do corpo (campos desconhecidos são ignorados).

**Ordem das verificações:** autenticação e papel → validação do corpo (422 `DADOS_INVALIDOS`) → duplicidade (409) → fotos (422/409) → gravação.

- `duplicado` (opcional): `"SOMAR"` ou `"CADASTRAR_MESMO_ASSIM"`; outro valor → `422 DADOS_INVALIDOS`. Ignorado se não há duplicidade.
- `duplicadoId` (obrigatório com `SOMAR`, senão `422 DADOS_INVALIDOS`): o `id` do produto que a tela 09 mostrou.

**Resposta de sucesso** (envelope único para as duas saídas):

```json
{ "resultado": "CRIADO", "produto": { /* ProdutoDetalhe */ } }
```

| Situação | HTTP | `resultado` |
|---|---|---|
| Produto novo criado | `201` | `CRIADO` |
| `duplicado: "SOMAR"` e o produto `duplicadoId` ainda é o duplicado | `200` | `QUANTIDADE_SOMADA` (`produto` é o **existente**, já com a soma) |
| `duplicado: "SOMAR"` mas o duplicado **sumiu** (excluído/renomeado) e não há outro | `201` | `CRIADO` (o front avisa "O produto original não existe mais; cadastramos como novo") |

**Erros:**

- `422 DADOS_INVALIDOS`: campos do produto (ver seção 1), `details: [{ campo, mensagem }]` (ex.: `campo: "preco"`, `tagIds.1`, `fotos.0.chave`).
- **`409 PRODUTO_DUPLICADO`**: já existe produto com o mesmo `lower(trim(nome))` na Casa e o corpo não trouxe `duplicado` (ou trouxe `SOMAR` com `duplicadoId` diferente do duplicado atual). Nada é gravado, nenhuma foto é apagada. Corpo:

```json
{
  "error": "PRODUTO_DUPLICADO",
  "message": "Já existe um produto com este nome na Casa",
  "details": {
    "existente": {
      "id": 17, "nome": "Cafeteira elétrica", "preco": "199.00", "quantidade": 2,
      "dataCompra": "2025-10-02", "fotoCapaId": 31
    },
    "quantidadeInformada": 1,
    "opcoes": ["SOMAR", "CADASTRAR_MESMO_ASSIM", "CANCELAR"]
  }
}
```

  `fotoCapaId` é o id da foto de capa do existente (ou `null`). **O `details` não traz URL de foto** (URL assinada em erro pode ir parar em log): para mostrar a miniatura na tela 09, busque `GET /produtos/{existente.id}` e use `fotos[0].url`.

  Com vários duplicados (possível depois de "Cadastrar mesmo assim"), `existente` é o **mais antigo** (menor `id`). As três `opcoes` são sempre as mesmas; `CANCELAR` não é um valor aceito no corpo (é só fechar o modal).
  O front reenvia **o mesmo corpo** acrescentando `duplicado` (e `duplicadoId = details.existente.id` no `SOMAR`). As fotos já enviadas continuam válidas até `confirmarAte`.
- `SOMAR` soma **só a quantidade informada** à do existente (atômico); preço, descrição, data, tags e fotos do existente não mudam, e o que mais foi digitado é descartado (o modal avisa). Fotos informadas junto são descartadas e apagadas do S3. Se a soma passar de 1 000 000 → `422 DADOS_INVALIDOS` (`campo: "quantidade"`) e nada muda.
- `422 ARQUIVO_INVALIDO`, `422 LIMITE_FOTOS`, `409 COTA_EXCEDIDA`: ver seção 5.
- `403 SEM_PERMISSAO` (LEITOR).

Registra `PRODUTO_CRIADO` (ou `PRODUTO_QUANTIDADE_SOMADA`) na mesma transação.

### 3.5 `GET /produtos` (UC016, RF10, RF34)

Query (todos opcionais):

| Parâmetro | Regra |
|---|---|
| `busca` | texto, `trim`, até 120 caracteres; **controle ou invisíveis (inclusive NUL) → `422 DADOS_INVALIDOS`**; normalizada para NFC e espaços repetidos reduzidos a um. Casa produtos cujo **nome contém** o texto, sem diferenciar maiúsculas/minúsculas e sem normalizar acentos. `%`, `_` e `\` valem como texto literal. Vazio = sem busca |
| `tagId` | inteiro. Só produtos com essa tag. Tag de outra Casa ou inexistente → lista **vazia** (`200`, sem erro) |
| `pagina` | inteiro de 1 a **10 000**, padrão 1 |
| `limite` | inteiro de 1 a 100, padrão 20 |
| `ordem` | `recentes` (padrão: `dataCadastro` decrescente, desempate por `id` decrescente) ou `nome` (`lower(nome)` crescente, desempate por `id`) |

Valores inválidos ou fora da faixa → `422 DADOS_INVALIDOS`. `busca` e `tagId` combinam com E.

Resposta `200`: `Pagina<ProdutoResumo>`:

```json
{
  "itens": [ { "id": 21, "nome": "Cafeteira Elétrica", "preco": "249.90", "quantidade": 1, "dataCompra": "2026-03-15",
               "dataCadastro": "2026-11-15T16:00:00.000Z", "tags": [ { "id": 3, "nome": "Cozinha" } ],
               "fotoCapa": { "url": "...", "expiraEm": "..." }, "adicionadoPor": { "id": 10, "nome": "Ana Souza" } } ],
  "pagina": 1, "limite": 20, "total": 1, "totalPaginas": 1
}
```

Página além do fim → `200` com `itens: []`. **Produtos recentes da tela 05 (RF11):** `GET /produtos?limite=5` (ordem padrão).

### 3.6 `GET /produtos/:id` (UC024, RF36)

`200`: `ProdutoDetalhe` (fotos com URL de leitura de 15 minutos, tags, autor). Outra Casa ou inexistente: `404 NAO_ENCONTRADO`.

### 3.7 `PATCH /produtos/:id` (UC025, RF04 a RF08)

Corpo: **qualquer subconjunto** de `nome`, `descricao`, `preco`, `quantidade`, `dataCompra`, `tagIds`, `fotos` (mesmas regras do cadastro). Campo omitido não muda. `descricao: null` ou `""` limpa a descrição. Corpo sem nenhum campo conhecido → `422 DADOS_INVALIDOS`.

- `tagIds`: a lista **substitui** a anterior (`[]` remove todas).
- `fotos`: a lista **final**, na ordem desejada (a primeira vira a capa). Cada item é `{ "id": 12 }` (foto que já pertence ao produto) ou `{ "chave": "casas/..." }` (foto nova enviada). Fotos atuais que não aparecem na lista são removidas (e apagadas do S3 depois de gravar). `id` que não é do produto → `422 DADOS_INVALIDOS` (`fotos.N.id`). Omitir `fotos` não mexe nelas. **Só reordenar** (mesmos ids, ordem diferente) conta como alteração: muda a capa, atualiza `atualizadoEm` e gera evento `ALTERADO` com `fotos: { adicionadas: 0, removidas: 0 }` (o front mostra "Fotos reordenadas").)
- **Cota na edição:** conferida pelo **saldo líquido** (bytes novos − bytes removidos). Se o saldo é ≤ 0 a cota não bloqueia. Se estoura: `409 COTA_EXCEDIDA` e nada muda.
- **Sem verificação de duplicidade** (mudar o nome para um existente é permitido).
- **Sem mudança real** (todos os valores iguais aos atuais): `200` com o produto, **sem** evento, sem log e sem alterar `atualizadoEm`.
- Última gravação vence em cada campo; fotos e tags nunca ficam corrompidas (o produto é travado durante a edição). Em impasse do banco (raro): `409 CONFLITO_CONCORRENTE` (repita).

`200`: `ProdutoDetalhe`. Registra `PRODUTO_ALTERADO` (só se algo mudou).
Erros: `403`, `404`, `409 COTA_EXCEDIDA`, `422 DADOS_INVALIDOS | ARQUIVO_INVALIDO | LIMITE_FOTOS`.

### 3.8 `DELETE /produtos/:id` (UC026, RF09)

Sem corpo. `204`. Remove o produto, as fotos e os vínculos com tags (as tags permanecem). Os objetos do S3 são apagados depois da gravação; se essa limpeza falhar, o produto já foi excluído e a rotina de órfãos apaga o objeto depois. Já excluído, de outra Casa ou inexistente: `404 NAO_ENCONTRADO` (o front trata o segundo clique como sucesso silencioso). Registra `PRODUTO_EXCLUIDO` com id, nome, quantidade, preço e nº de fotos (os dados do log não dependem da linha excluída).

### 3.9 `GET /produtos/:id/historico` (RF11)

Query: `pagina` (1 a 10 000, padrão 1) e `limite` (1 a 100, **padrão 20**). Ordem: mais novo primeiro.

Resposta `200`: `Pagina<EventoHistorico>`:

```ts
interface EventoHistorico {
  id: string;                      // id do log (inteiro grande em texto)
  tipo: 'CRIADO' | 'ALTERADO' | 'QUANTIDADE_SOMADA';
  criadoEm: string;                // ISO 8601 UTC
  autor: { nome: string } | null;  // null = ex-membro (saiu da Casa ou conta apagada) (sem e-mail, por privacidade)
  detalhes: DetalhesCriado | DetalhesAlterado | DetalhesSomada;
}

interface DetalhesCriado { nome: string; preco: string; quantidade: number; tags: string[]; fotos: number }

interface DetalhesAlterado {
  alteracoes: {
    nome?: { de: string; para: string };
    descricao?: { de: string | null; para: string | null };
    preco?: { de: string; para: string };
    quantidade?: { de: number; para: number };
    dataCompra?: { de: string; para: string };            // "AAAA-MM-DD"
    tags?: { adicionadas: string[]; removidas: string[] };  // nomes das tags
    fotos?: { adicionadas: number; removidas: number };     // só contagens (ex.: "1 foto adicionada")
  };                                                         // só os campos que mudaram
}

interface DetalhesSomada { anterior: number; somada: number; final: number }
```

Um evento por salvamento: `ALTERADO` agrupa todos os campos mudados. O evento `PRODUTO_EXCLUIDO` não aparece (o produto não existe mais; fica só na auditoria). Outra Casa ou inexistente: `404`.

## 4. Códigos de erro do M3

Além dos de [`m1-auth.md`](m1-auth.md) seção 1.3 (`401`, `403 SEM_PERMISSAO`, `404 NAO_ENCONTRADO`, `422 DADOS_INVALIDOS`, `429`, `409 CONFLITO_CONCORRENTE`).

| HTTP | `error` | Quando | Mensagem sugerida ao usuário (front) |
|---|---|---|---|
| 409 | `PRODUTO_DUPLICADO` | Cadastro com nome já existente na Casa, sem escolha (`POST /produtos`) | abre a tela 09 |
| 409 | `COTA_EXCEDIDA` | A foto não cabe no armazenamento do plano (`upload-url`, `POST /produtos`, `PATCH /produtos/:id`). `details: { plano, usadoBytes, limiteBytes }` | "Espaço do plano esgotado" + link para os Planos (tela 13) |
| 429 | `MUITAS_TENTATIVAS` | Também no `upload-url` com 10 envios pendentes do usuário ou 30 da Casa (seção 3.3) | "Salve o produto ou aguarde para enviar mais fotos" |
| 409 | `TAG_EXISTENTE` | Tag com mesmo nome (sem diferenciar caixa) na Casa. `details.existente` | "Esta tag já existe" (seleciona a existente) |
| 422 | `ARQUIVO_INVALIDO` | Tipo fora de JPEG/PNG, tamanho ≤ 0 ou > 5 MB, tipo real diferente (conferido nos bytes, inclusive em relação ao tipo declarado no `upload-url`), imagem corrompida, acima de 8000 px por lado ou de 40 megapixels, objeto ausente ou vencido, chave de outra Casa ou que não é de envio (`pendentes/`). Em `POST`/`PATCH`, `details: [{ campo: "fotos.N", mensagem }]` | "Use imagem JPEG ou PNG de até 5 MB" |
| 422 | `LIMITE_FOTOS` | Mais de 3 fotos no produto (`fotos` com mais de 3 itens) | "Um produto aceita até 3 fotos" |

Observação de nomes: o código desta tabela para foto inválida é `ARQUIVO_INVALIDO` e o de tag repetida é `TAG_EXISTENTE` (os da Tabela 17 e das histórias do PO). Não existem `FOTO_INVALIDA` nem `TAG_DUPLICADA`.

Todos os demais erros seguem o formato padrão `{ error, message, details? }`. O front escolhe o texto pelo `error`.

## 5. Fluxo das fotos (resumo para o front)

1. Usuário escolhe um arquivo. O front confere tipo e tamanho (JPEG/PNG, até 5 MB; opcionalmente os primeiros bytes) para dar aviso imediato.
2. `POST /produtos/fotos/upload-url` com `tipo` e `tamanhoBytes` → `chave` + `url` + `cabecalhos`.
3. `PUT` do arquivo direto no S3 (seção 3.3 e seção 6). Mostra a miniatura local com opção de remover (remover antes de salvar é só descartar a `chave`; o objeto é limpo depois pela rotina).
4. Ao salvar o produto, envia `fotos: [{ chave }, ...]` (cadastro) ou a lista final com `{ id }` e `{ chave }` (edição).
5. **A API é a autoridade** e confere, para cada `chave` nova: é uma chave de **envio** (`pendentes/`) da Casa do token e do formato gerado pelo servidor; não foi salva antes; o objeto **existe** no S3; o **tamanho real** está entre 1 byte e 5 MB; o **tipo real** (bytes) é JPEG ou PNG **e é o mesmo tipo pedido no `upload-url`** (extensão da chave); a imagem **decodifica** e tem no máximo **8000 px por lado e 40 megapixels**; no total o produto tem no máximo 3; a **cota** do plano comporta o saldo líquido (com a Casa travada na transação). Qualquer falha → nada é gravado; objetos inválidos são apagados do S3.
   - **Recodificação (LGPD):** a API **recodifica** a imagem (remove EXIF/GPS e demais metadados, aplica a orientação aos pixels e descarta bytes extras após a imagem) e grava o resultado numa chave definitiva (`casas/<id>/fotos/...`) que nunca teve URL de escrita; o objeto de envio é apagado. Por isso `tamanhoBytes` de `Foto` (e a cota) é o do arquivo **recodificado**, geralmente diferente do enviado. O front deve avisar na tela 08: "A localização e outros dados ocultos da foto são removidos ao salvar". Recodificar também no navegador antes do `PUT` é opcional (melhor esforço).
6. A exibição usa `fotoCapa.url` / `fotos[].url` (GET assinado de 15 minutos). Não guarde essas URLs além de `expiraEm`; ao receber `403` na imagem, refaça a consulta do produto. Sugestão: `staleTime` das consultas de produto de no máximo 10 minutos.

## 6. URL assinada em dev, no navegador do host e no container e2e (obrigatório)

A assinatura da URL inclui o **host**. O backend assina para o host interno (`s3:9000`), que o navegador não alcança como tal. Solução (ADR 0003 D3): o front reescreve a **origem** da URL para um prefixo do próprio Vite, e o Vite repassa ao `s3:9000` reescrevendo o `Host`.

```ts
// src/lib/s3.ts (front). VITE_S3_PROXY = "/s3" em dev (definida no docker-compose); NÃO definir em produção.
export function urlDoS3(url: string): string {
  const proxy = import.meta.env.VITE_S3_PROXY;
  if (!proxy) return url;                       // produção (R2): usa a URL como veio
  const u = new URL(url);
  return `${proxy}${u.pathname}${u.search}`;    // "/s3/keepit-fotos/casas/4/fotos/....png?X-Amz-..."
}
```

Aplique `urlDoS3` à `url` de **envio** (`PUT`) e a **toda** URL de leitura (`fotoCapa.url`, `fotos[].url`). Em produção, a API assina para o domínio público do bucket (`S3_PUBLIC_ENDPOINT`) e o front usa a URL como veio; o CORS do bucket e a CSP (`connect-src` para o `PUT`, `img-src` para a leitura) precisam liberar esse domínio.
