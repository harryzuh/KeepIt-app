# Contrato da API — M4 Estatísticas (Início e tela 10)

Referência única para Back-end e Front-end (o Front-end implementa **somente** a partir deste documento; quem mudar o contrato atualiza este arquivo na mesma tarefa e cita a mudança).
Convenções gerais (URL base, formato, token, erro `{ error, message, details? }`, rate limit global) em [`m1-auth.md`](m1-auth.md), seções 1 e 2. Produtos e tags em [`m3-produtos.md`](m3-produtos.md); plano, membros e armazenamento em [`m5-assinatura.md`](m5-assinatura.md) e [`m2-casa.md`](m2-casa.md). Decisões e justificativas: [ADR 0004](../adr/0004-m4.md).
O schema Zod de **resposta** (`backend/src/modules/estatisticas/estatisticas.schema.ts`) deve refletir exatamente os campos abaixo. As rotas não têm entrada: não há corpo, parâmetro de caminho nem query.

## 1. Regras que o front precisa conhecer

- **Só leitura.** O M4 não grava nada e não gera auditoria.
- **Papéis:** `ADMIN`, `EDITOR` e `LEITOR` recebem `200` com os números da **própria Casa**. A Casa vem **sempre do token**. Não existe parâmetro `casaId`; qualquer query string é ignorada. Não há `403` nem `404` neste módulo.
- **Valor de um produto = `preco × quantidade`** (o `preco` do produto é **unitário**). Valor total, maior gasto e valor por tag usam esse valor. Todo o histórico da Casa entra: **não há filtro de período**.
- **Dinheiro é sempre string decimal**, formato fixo `^\d+\.\d{2}$` (ponto, sempre 2 casas, sem sinal, sem notação científica). **Nunca converta para `Number`:** o maior valor possível (preço `9999999999.99` × quantidade `1000000`, e a soma de muitos produtos) passa de 2^53 em centavos. O front **só formata** (R$ 12.345,67), separando parte inteira e decimais como texto. Contagens e `unidades` são inteiros JSON (seguros).
- **Casa vazia não é erro:** `200` com `valorTotal: "0.00"`, `valorMedio: "0.00"`, contagens `0`, `maiorGasto`, `tagMaisComprada` e `semTag` `null` e listas vazias. Nunca há divisão por zero nem `NaN`. O front mostra o estado vazio.
- **Percentuais são do front** (participação da tag sobre `valorTotal`, uso do armazenamento): calcule a partir das strings (aritmética inteira, por exemplo `BigInt` de centavos) e de `usadoBytes ÷ limiteBytes`; com total zero mostre "—". A API não devolve percentuais.
- **Produto com várias tags conta inteiro em cada uma:** a soma de `valorPorTag` pode passar do `valorTotal`; a tela 10 avisa ("Produtos com mais de uma tag aparecem em cada uma").
- **Cache:** respostas com `Cache-Control: no-store`. Use TanStack Query com chaves `['estatisticas', 'resumo']` e `['estatisticas', 'completa']`, `staleTime` de 30 s, e **invalide o prefixo `['estatisticas']`** após criar, editar, somar e excluir produto; criar tag; adicionar, remover ou sair da Casa; contratar, trocar, cancelar ou reativar plano; salvar ou excluir foto (ADR 0004, D7).
- **Produtos recentes da tela 05** não vêm aqui: use `GET /produtos?limite=5` ([`m3-produtos.md`](m3-produtos.md), seção 3.5).

## 2. Tipos

```ts
type Dinheiro = string;   // "12345.67", sempre ^\d+\.\d{2}$. Nunca Number.
type DataCivil = string;  // "2026-03-15" (só data)

interface ProdutoValor {            // maiorGasto e maisAntigos
  id: number;                       // abre o detalhe (tela 07)
  nome: string;
  preco: Dinheiro;                  // unitário
  quantidade: number;
  valor: Dinheiro;                  // preco × quantidade, exato
  dataCompra: DataCivil;
}

interface LinhaTag {
  id: number;
  nome: string;
  valor: Dinheiro;                  // soma de preco × quantidade dos produtos da tag
  unidades: number;                 // soma das quantidades
  produtos: number;                 // quantos cadastros usam a tag
}

interface Resumo {                  // GET /estatisticas/resumo
  valorTotal: Dinheiro;
  produtos: number;                 // linhas de produto (não é a soma das quantidades)
  unidades: number;                 // soma das quantidades
  tags: number;                     // todas as tags da Casa, inclusive sem produto
  membros: { emUso: number; limite: number };
  armazenamento: { usadoBytes: number; limiteBytes: number };
  plano: { nome: 'INDIVIDUAL' | 'FAMILIA' | 'BUSINESS' };
  /** Assinatura vigente. null = plano Individual (sem data). Nunca traz dados de pagamento. */
  renovacao: { status: 'ATIVA' | 'CANCELADA'; data: string } | null;   // data: ISO 8601 UTC
}

interface Estatisticas {            // GET /estatisticas
  valorTotal: Dinheiro;
  produtos: number;
  unidades: number;
  valorMedio: Dinheiro;             // valorTotal ÷ produtos, 2 casas, meio para cima; "0.00" se produtos = 0
  maiorGasto: ProdutoValor | null;
  tagMaisComprada: { id: number; nome: string; unidades: number; produtos: number } | null;
  valorPorTag: LinhaTag[];          // só tags com produto; até 50 linhas
  totalTagsComProduto: number;      // total real de tags com produto (>= valorPorTag.length)
  semTag: { valor: Dinheiro; unidades: number; produtos: number } | null;   // produtos sem nenhuma tag
  maisAntigos: ProdutoValor[];      // até 5
}
```

## 3. Rotas

Ambas exigem `Authorization: Bearer` (valem `401 NAO_AUTENTICADO`, `401 SESSAO_EXPIRADA`, `429 MUITAS_TENTATIVAS` do limite global, `503 ESTATISTICAS_INDISPONIVEL` e `500`). O 503 `{ error: "ESTATISTICAS_INDISPONIVEL", message }` ocorre quando uma consulta passa de 3 s (`statement_timeout` local à transação) ou não há conexão livre no pool em 1 s; é transitório e o cliente pode repetir. Sem outros erros. Sem limite de requisição próprio.

| # | Método e caminho | Papel | Resumo | UC · RF | História |
|---|---|---|---|---|---|
| 1 | `GET /estatisticas/resumo` | ADMIN, EDITOR, LEITOR | Indicadores do Início (telas 05 e 17) | UC017 · RF24 | 2.1.1, 2.1.2 |
| 2 | `GET /estatisticas` | ADMIN, EDITOR, LEITOR | Estatísticas completas (tela 10) | UC027 · RF23 | 2.2.1 |

### 3.1 `GET /estatisticas/resumo`

`200 Resumo`. Exemplo (Casa Família com 3 produtos):

```json
{
  "valorTotal": "5754.60",
  "produtos": 3,
  "unidades": 45,
  "tags": 4,
  "membros": { "emUso": 3, "limite": 6 },
  "armazenamento": { "usadoBytes": 482113, "limiteBytes": 21474836480 },
  "plano": { "nome": "FAMILIA" },
  "renovacao": { "status": "ATIVA", "data": "2026-12-15T17:00:00.000Z" }
}
```

Plano Individual: `"plano": { "nome": "INDIVIDUAL" }` e `"renovacao": null` (a tela mostra "Plano Individual"). Assinatura `CANCELADA` ainda vigente: `"renovacao": { "status": "CANCELADA", "data": "..." }` (a tela mostra "Benefícios até dd/mm/aaaa"); `CANCELADA` já vencida conta como Individual (mesma regra de `Perfil.plano`).

Casa vazia (Individual):

```json
{
  "valorTotal": "0.00", "produtos": 0, "unidades": 0, "tags": 0,
  "membros": { "emUso": 1, "limite": 1 },
  "armazenamento": { "usadoBytes": 0, "limiteBytes": 1073741824 },
  "plano": { "nome": "INDIVIDUAL" }, "renovacao": null
}
```

### 3.2 `GET /estatisticas`

`200 Estatisticas`. Exemplo (3 produtos: Notebook R$ 4.599,00 × 1, com as tags Eletrônicos e Garantia; Pilhas AA R$ 24,90 × 40, tag Utilidades; Caixa organizadora R$ 39,90 × 4, sem tag):

```json
{
  "valorTotal": "5754.60",
  "produtos": 3,
  "unidades": 45,
  "valorMedio": "1918.20",
  "maiorGasto": {
    "id": 31, "nome": "Notebook 14 polegadas", "preco": "4599.00", "quantidade": 1,
    "valor": "4599.00", "dataCompra": "2026-10-16"
  },
  "tagMaisComprada": { "id": 9, "nome": "Utilidades", "unidades": 40, "produtos": 1 },
  "valorPorTag": [
    { "id": 2, "nome": "Eletrônicos", "valor": "4599.00", "unidades": 1, "produtos": 1 },
    { "id": 3, "nome": "Garantia", "valor": "4599.00", "unidades": 1, "produtos": 1 },
    { "id": 9, "nome": "Utilidades", "valor": "996.00", "unidades": 40, "produtos": 1 }
  ],
  "totalTagsComProduto": 3,
  "semTag": { "valor": "159.60", "unidades": 4, "produtos": 1 },
  "maisAntigos": [
    { "id": 31, "nome": "Notebook 14 polegadas", "preco": "4599.00", "quantidade": 1, "valor": "4599.00", "dataCompra": "2026-10-16" },
    { "id": 32, "nome": "Pilhas AA (cartela)", "preco": "24.90", "quantidade": 40, "valor": "996.00", "dataCompra": "2026-11-05" },
    { "id": 33, "nome": "Caixa organizadora", "preco": "39.90", "quantidade": 4, "valor": "159.60", "dataCompra": "2026-11-07" }
  ]
}
```

Observe que a soma de `valorPorTag` (`10194.00`) passa do `valorTotal` (`5754.60`) porque o Notebook está em duas tags.

Casa vazia:

```json
{
  "valorTotal": "0.00", "produtos": 0, "unidades": 0, "valorMedio": "0.00",
  "maiorGasto": null, "tagMaisComprada": null,
  "valorPorTag": [], "totalTagsComProduto": 0, "semTag": null, "maisAntigos": []
}
```

## 4. Regras de cálculo e desempate

| Campo | Regra |
|---|---|
| `valorTotal` | soma exata de `preco × quantidade` de todos os produtos da Casa (em `numeric` no banco) |
| `produtos`, `unidades` | `COUNT(*)` e soma das quantidades |
| `valorMedio` | `valorTotal ÷ produtos` (por produto cadastrado, **não** por unidade), 2 casas, meio para cima (`ROUND` de `numeric`); `produtos = 0` devolve `"0.00"` |
| `maiorGasto` | maior `valor`; empate: `dataCompra` mais recente, depois menor `id`; sem produtos: `null` |
| `valorPorTag` | tags **com produto**, por `valor` decrescente; empate: nome A–Z sem diferenciar caixa, depois `id`; máximo 50 linhas (`totalTagsComProduto` diz quantas existem) |
| `semTag` | produtos sem nenhuma tag, numa linha; fica fora de `valorPorTag` e de `tagMaisComprada`; a tela a mostra por último; `null` se não houver |
| `tagMaisComprada` | maior `unidades` (soma de quantidades); empate: mais `produtos`, depois nome A–Z sem diferenciar caixa, depois `id`; sem tags em uso: `null` |
| `maisAntigos` | até 5 menores `dataCompra`, do mais antigo ao menos antigo; empate: `dataCadastro` mais antiga, depois menor `id` |
| Preço `0.00` | válido: soma zero ao valor e conta em `produtos` e `unidades` |
| Tags sem produto | não aparecem em `valorPorTag` (contam em `Resumo.tags`) |

## 5. Matriz de permissões (RNF31) e isolamento (RNF27)

| Rota | Sem token | LEITOR | EDITOR | ADMIN | Usuário de outra Casa |
|---|---|---|---|---|---|
| `GET /estatisticas/resumo` | 401 | 200 | 200 | 200 | 200 (só os números da própria Casa) |
| `GET /estatisticas` | 401 | 200 | 200 | 200 | 200 (só os números da própria Casa) |

Teste de isolamento obrigatório: duas Casas com produtos e tags **de mesmo nome**; os números de uma nunca mudam por causa da outra.

## 6. Desempenho (RNF06)

Meta: menos de 500 ms por rota e menos de 2 s na tela, com 10.000 produtos e 200 tags em uma Casa. Medido no banco com `EXPLAIN (ANALYZE)` nessa carga: cerca de 15 ms somando as consultas de `GET /estatisticas` (ADR 0004, D4). Sem índice novo, sem Redis, sem cache de servidor.
