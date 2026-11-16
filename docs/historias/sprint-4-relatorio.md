# Relatório da Sprint 4 — M4 Estatísticas e Início completo

Data do aceite: 15/11/2026 · Responsável: PO · Fontes: QA (`docs/qa/sprint-4-m4.md`, reteste 1), AppSec (`docs/seguranca/m4-modelo-ameacas.md` seção 10 e `m3-modelo-ameacas.md` seção 10.1), ADR 0004, contrato `docs/api/m4-estatisticas.md`, relatos das equipes.

## Veredito
**Sprint aceita para desenvolvimento e homologação, não para produção.** 5 histórias: 4 aceitas e 1 aceita com ressalvas (2.2.2), nenhuma rejeitada. Pagamento continua simulado, por decisão do produto.

Verificação feita pelo PO:
- `make check`: backend 512/512, frontend 178/178, lint e typecheck limpos.
- `make e2e`: 270 passaram e 1 pulou (o spec `m4-desempenho`, que exige `make seed-volume`) em duas execuções. A primeira execução teve 1 falha não identificada (269 passaram, saída com erro) que não se repetiu; tratada como intermitência, e o QA já registrou instabilidade parecida no teste mobile do M3. Com o volume carregado, o QA obteve 271/271.
- Desempenho (QA, 10.000 produtos e 200 tags): resumo 6 ms, completa 43 ms, Início 210 ms, Estatísticas 191 ms. Meta RNF06 (< 2 s) atendida com folga. AppSec mediu 41 ms e 50 requisições simultâneas sem erro.

## Situação de FD1 e FD5 (M3)
Ambos **fechados** pelo reteste real do AppSec contra o SeaweedFS. FD1: a chave de envio é `pendentes/<uuid>`, reuso em outro produto dá 422 e a regravação na mesma URL assinada não altera o objeto servido. FD5: o arquivo servido não tem EXIF, GPS nem marca do aparelho. A história 3.1.2 passou de "Aceita com ressalvas" para "Aceita". Sobra um objeto órfão em `pendentes/`, recolhido pela conciliação.

## 1. Entregue
- **Contrato e ADR 0004:** duas rotas (`GET /estatisticas/resumo` e `GET /estatisticas`), dinheiro em string decimal, SQL parametrizado, sem índice novo, sem migration.
- **Back-end (M4):** agregação no banco, transação `REPEATABLE READ` com `statement_timeout` de 3 s, `maxWait` de 1 s e 503 `ESTATISTICAS_INDISPONIVEL`; regras de empate; Casa vazia; isolamento por `casaId` do token; `no-store`. Matriz de papéis testada. Também: apagar objetos do S3 ao apagar Casa na exclusão de conta (pendência baixa do M3).
- **Front-end:** tela 05 (celular) e 17 (desktop) em `/inicio`, tela 10 em `/estatisticas`, formatação BRL por BigInt, percentuais no cliente, barras acessíveis, invalidação do prefixo `['estatisticas']`, cache limpo em login, logout (inclusive em outra aba) e saída da Casa.
- **Infra:** `make carga` e `make seed-volume`, helpers e2e de Casa com produtos, seed idempotente com casos de empate, auditoria de dependências com exceção datada, `prisma` com `--no-install` no deploy.
- **Segurança:** modelo de ameaças do M4 e reteste do M3.
- **Contratos:** `m1-auth.md` e `m5-assinatura.md` receberam `uso.armazenamento` e `fotosOrfasPendentes`.

## 2. Resultado por história
| História | Resultado | Ressalva |
|---|---|---|
| 2.0 Fundação do M4 | Aceita | CHECK no banco pendente (baixo) |
| 2.1.1 Resumo da Casa (tela 05) | Aceita | Plano repetido na tela (baixo) |
| 2.2.1 Estatísticas (tela 10) | Aceita | |
| 2.1.2 Início desktop (tela 17) | Aceita | Contraste do selo LEITOR (baixo) |
| 2.2.2 Desempenho, consistência e invalidação | Aceita com ressalvas | Sem teto por Casa (F-01); ETag e 304 apesar de `no-store` |

## 3. Defeitos abertos (nenhum crítico, alto ou médio)
| Área | Sev. | Item |
|---|---|---|
| Front | Baixa | Selo `LEITOR` (`PapelSelo.tsx`) com contraste abaixo de 4,5:1 |
| Front | Baixa | "Plano X" aparece duas vezes no Início (`Inicio.tsx` e `RenovacaoTexto.tsx`) |
| Back | Baixa | ETag fraco e 304 em `/estatisticas`, contra o ADR 0004 Q6 (desligar `etag` nessas rotas) |
| Back/Arquiteto | Baixa | Sem `CHECK (preco >= 0 AND quantidade >= 1)` e resposta do M4 sem `schema.parse` (F-10); 429 global sem `no-store` (F-05); senha fixa no script de carga e proteção só por `NODE_ENV` (F-09) |
| Back | Baixa | F-14: contrato diz "não há 403", mas usuário sem Casa recebe 403 `SEM_PERMISSAO`; ajustar o texto |
| PO/Arquiteto | Baixa | Sem teto de produtos, tags e vínculos por Casa (F-01), ver decisão 61 |
| Infra | Baixa | `npm audit`: 3 altas em deepmerge-ts via prisma, cobertas por exceção até 2027-03-31 (sem caminho de exploração) |
| QA | Baixa | Falha intermitente de 1 spec e2e na primeira execução do PO (não identificada); instabilidade citada no spec mobile do M3 |

Corrigidos nesta sprint: rolagem horizontal a 360 px, WCAG 2.5.3 no link "Maior gasto", `statement_timeout` ausente, cache entre contas.

## 4. Riscos
- LEITOR e EDITOR veem o patrimônio e a data de renovação (F-06 aceito; renovação já aparece no `/me`). Avisar no convite.
- Custo da agregação cresce linearmente com o tamanho da Casa; sem teto.
- Neon com pool pequeno: o 503 e o `statement_timeout` mitigam, mas falta teste de carga em produção.
- Itens do R2 (Content-Length, `nosniff`, domínio do bucket, logs) só verificáveis no provedor.
- Pagamento simulado: não há receita real; produção depende da decisão 60.

## 5. Backlog restante para o MVP ir a produção (pagamento simulado mantido)
1. **Decisão de lançamento sobre o pagamento:** manter simulado em beta fechado, com aviso claro, ou integrar gateway (fora desta decisão). `PAGAMENTO_SIMULADO` já responde 503 em produção sem gateway; definir o comportamento do beta.
2. **Produção/infra:** checklist do R2, domínio do bucket separado, redação de logs, CSP, deploy Vercel e Render, backup (RNF23), monitoramento (RNF28), persistir o cursor de `limparFotosOrfas`.
3. **Segurança:** teto de produtos e tags por Casa, CHECK no banco, convite com aceite (R-M2-1), upgrade para Prisma 7.
4. **Produto:** contato com a equipe (RF29/UC032), foto de perfil, editar e excluir tags, índice para a busca por nome, UC013 e textos das histórias, código Linear 2.2.2 na Tabela 10.
5. **Qualidade:** verificação visual 360/768/1440 px e axe em todas as telas, estabilizar specs intermitentes, corrigir os defeitos baixos da seção 3.
