# Relatório da Sprint 3 — M3 Produtos e Tags

Data do aceite: 15/11/2026 · Responsável: PO · Fontes: QA (`docs/qa/sprint-3-m3.md`, reteste 2), AppSec (`docs/seguranca/m3-modelo-ameacas.md`, seção 10), ADR 0003, contrato `docs/api/m3-produtos.md`, relatos das equipes.

## Veredito
**Sprint aceita para desenvolvimento e homologação, não para produção.** 11 histórias: 10 aceitas e 1 aceita com ressalvas (3.1.2), nenhuma rejeitada. Rodei `make check` (backend 487 testes, frontend 143) e `make e2e` (228 passaram, 0 falharam, desktop e mobile 360 px): tudo verde. QA aprovou o reteste 2. A revisão de segurança reprovou a rodada inicial por 2 achados altos (objeto regravável após confirmação, EXIF/GPS servido); ambos foram corrigidos e provados por specs de QA (`m3-reteste1`, `m3-reteste2`), mas o AppSec ainda não refez a revisão formal. Por isso a 3.1.2 fica com ressalvas e produção exige o reteste.

## 1. Entregue
- **Tags:** `GET/POST /tags`, únicas por Casa sem diferenciar caixa, 409 `TAG_EXISTENTE`.
- **Produtos:** CRUD completo (nome, descrição, preço string, quantidade, data, até 10 tags), busca por nome, filtro por tag, ordenação e paginação, detalhe, exclusão com confirmação e auditoria.
- **Duplicidade (RF33):** 409 `PRODUTO_DUPLICADO` com somar, cadastrar mesmo assim ou cancelar (tela 09); soma atômica.
- **Fotos:** até 3, JPEG/PNG pelo tipo real, 5 MB, PUT assinado direto ao S3 em `pendentes/`, recodificação no servidor (remove EXIF/GPS, limita 8000 px e 40 Mpx) e gravação em chave definitiva imutável; cota do plano (409 `COTA_EXCEDIDA`, saldo líquido, `substituiFotoIds` na troca); teto de 10 envios pendentes por usuário e 30 por Casa (429); rotina horária `limparFotosOrfas`.
- **Histórico (RF11):** eventos CRIADO, ALTERADO e QUANTIDADE_SOMADA; recentes na tela 05.
- **Telas:** 05 (recentes e atalho), 06, 07, 08, 09, 17 (parte M3) e 23; aviso "produtos ficam na Casa" ao EDITOR (R-M2-1).
- **Permissões:** LEITOR só consulta; matriz ADMIN/EDITOR/LEITOR/outra Casa/sem token testada (RNF31).
- **Infra:** proxy `/s3` com `nosniff` em dev, CORS, portas do Postgres e S3 só em 127.0.0.1, fixtures e helpers e2e, CORS de produção com uma origem, script de validação de Content-Length, cron horário com aviso de pendentes.

## 2. Resultado por história
| História | Resultado | Ressalva |
|---|---|---|
| 3.0 Fundação | Aceita | |
| 5.1 Tags | Aceita | Editar e excluir tag no backlog |
| 3.1.2 Upload de foto e cota | Aceita com ressalvas | Itens de produção (R2, nosniff, domínio do bucket, logs) e reteste do AppSec pendentes |
| 3.1 Cadastrar produto | Aceita | |
| 3.1.4 Duplicidade | Aceita | |
| 3.2 Listar, buscar, filtrar | Aceita | Busca `contém` sem índice trigram |
| 3.2.3 Detalhe | Aceita | |
| 3.3 Editar | Aceita | |
| 3.4 Excluir | Aceita | |
| 4.1 Histórico | Aceita | UC017 completo é do M4 |
| 3.5 Aviso produtos ficam na Casa | Aceita | |

## 3. Pendências e defeitos abertos (nenhum crítico ou alto)
| Área | Sev. | Item |
|---|---|---|
| Infra | Média | Produção: validar `Content-Length` assinado no R2 (R-M3-1), `nosniff` no objeto, domínio do bucket separado do app, redação de `X-Amz-Signature` nos logs. Só verificável no provedor |
| AppSec | Média | Refazer a revisão formal (FD1, FD5, FD6, FD8, FD9) e atualizar o checklist |
| Back | Baixa | Cursor de `limparFotosOrfas` em memória (idempotente); `apagarPrefixo` ao apagar Casa/conta não chamado (a rotina cobre em cerca de 3 h) |
| Arquiteto | Baixa | Replicar `Perfil.uso.armazenamento` e `fotosOrfasPendentes` em `m1-auth.md` e `m5-assinatura.md` |
| Back | Baixa | `npm audit`: 3 altas em prisma/deepmerge-ts (exige Prisma 7), só CLI |
| Front | Baixa | `staleTime` global de 30 s (contrato aceita mais); recodificação no navegador opcional |
| PO | Baixa | Atualizar textos das histórias (tela 23 é Excluir produto) e UC013 (herdado da Sprint 2) |

## 4. Riscos
- Foto sem revisão final do AppSec após as correções de FD1/FD5 (mitigado por testes de QA).
- Sem tetos de produtos e tags por Casa e busca sem índice (FD4): risco de volume.
- Tags sem editar ou excluir.
- Contratos de M1 e M5 desatualizados em dois campos aditivos.
- R-M2-1 segue aceito apenas para dev e homologação.

## 5. Backlog da Sprint 4
- **M4 Estatísticas e Início:** indicadores, valor total, armazenamento e UC017 completo (telas 05 e 17 completas).
- **Segurança e produção:** reteste AppSec do M3; checklist de produção (R2, domínio do bucket, logs, CSP); revisão de ACH-10 e FP6; convite com aceite (R-M2-1).
- **Transversais do MVP:** pagamento real ou decisão de lançamento sem pagamento; contato com a equipe (RF29/UC032); foto de perfil; editar e excluir tags; teto de produtos e tags por Casa e índice para busca; persistir o cursor da rotina de órfãs e chamar `apagarPrefixo` na exclusão; upgrade para Prisma 7; verificação visual 360/768/1440 px; acessibilidade geral; atualizar UC013 e textos das histórias.
