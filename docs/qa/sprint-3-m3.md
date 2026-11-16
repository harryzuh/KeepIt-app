# QA Sprint 3 (M3 Produtos e Tags)

Resultado: REPROVADO (1 defeito alto, 3 médios, 3 baixos). Sem regressão em M1, M2 e M5.

## Execução
- `make check`: lint, typecheck e testes passam (backend 451, frontend 133).
- `make e2e`: 204 passaram, 9 falharam. Todas as 9 falhas são defeitos reais do M3 (abaixo).
- Specs novos (e2e/tests): `m3-api.spec.ts` (matriz de papéis em todas as rotas, IDOR de produto/foto/tag/chave, validação, duplicidade, busca, fotos por tipo real/tamanho/limite/cota, histórico, auditoria), `m3-produtos-ui.spec.ts`, `m3-fotos-ui.spec.ts`, `m3-responsivo.mobile.spec.ts` (360px), `m3-a11y-desktop.spec.ts` (axe, foco, teclado), apoio `m3-db.ts` e `m3-telas.ts`. Dependências de e2e adicionadas: `pg`, `@axe-core/playwright`. Screenshots em `e2e/test-results/sprint3-telas/`.
- Ajuste de teste antigo: `m5-m2-api.spec.ts` agora espera o campo aditivo `fotosOrfasApagadas` em `/internal/jobs` (mudança documentada nos contratos M1/M5; não é defeito).
- Rate limit (30 e 60/min) fica desligado no ambiente de dev (RATE_LIMIT_DESLIGADO); coberto pelos testes do backend, não pelo E2E.

## Defeitos
1. ALTA (frontend) Campo "Nova tag" da tela 08 colapsa para 35px de largura (desktop e 360px) e o botão "Criar tag" ocupa o resto. Não dá para digitar o nome da tag. Esperado: campo ocupando a largura. Origem: TagSeletor (`Input` com `className="flex-1"` não chega ao wrapper). Testes: "campo Nova tag ... >= 120px".
2. MÉDIA (backend) `GET /me` não traz `uso.armazenamento`, contra o contrato (seção 1 e história RF39). EDITOR/LEITOR veem só "limite do plano" na tela 08. Teste: "GET /me traz uso.armazenamento".
3. MÉDIA (backend) Tipo real diferente do declarado é aceito. Passos: upload-url com `image/png`, PUT de bytes JPEG, POST /produtos com a chave. Esperado 422 ARQUIVO_INVALIDO (Tabela do contrato, seção 4). Obtido 201; foto gravada como JPEG com chave `.png` e Content-Type png no S3 (ADR D2 e contrato divergem; AppSec FD7).
4. MÉDIA (frontend) Alvos de toque abaixo de 44px (RNF10): "Remover" e "Tornar capa" (16px de altura), chips de tag (40px) na 06 e 08, "Ver todos" (40px) na 05, "← Produtos" (20px) na 07. Testes de responsividade 360px.
5. BAIXA (frontend) axe `label-content-name-mismatch`: botão "Tornar capa" tem aria-label "Tornar a foto N a capa" que não contém o texto visível (WCAG 2.5.3).
6. BAIXA (frontend) Links da tela 05 anteriores ao M3 ("Minha assinatura", "Membros da Casa", "Ir para Minha conta", "Ver planos") têm 24px de altura. Fora do escopo do M3, registrado para o backlog.
7. BAIXA (backend/contrato) `upload-url` recusa com COTA_EXCEDIDA mesmo quando a troca de foto teria saldo líquido zero; com a cota cheia não é possível trocar uma foto (o PATCH em si usa o saldo líquido corretamente).

## Verificado e conforme
- Matriz semToken/LEITOR/EDITOR/ADMIN/outra Casa em todas as 9 rotas (401/403/2xx/404); recurso negado não é alterado.
- IDOR: tagIds, fotos[].id, chave de outra Casa (objeto alheio não apagado), duplicadoId de outra Casa, chave já gravada em outro produto (objeto preservado, sem 500), path traversal, ids fora do int4 (422, sem 500).
- Fotos: 422 para gif/svg/pdf/0/negativo/5 MB+1; 5 MB exatos passam; S3 recusa tamanho e tipo diferentes do assinado (403); objeto inexistente e texto como PNG/JPEG recusados; PNG renomeado .jpg aceito como PNG; 4 fotos = LIMITE_FOTOS; COTA_EXCEDIDA 409 em upload-url, POST e PATCH; exclusão apaga objetos do S3; rotina de órfãos preserva recentes.
- Duplicidade (3 opções na UI e na API, atomicidade de SOMAR, mais antigo no 409), busca com `%`/`_`/`\` literais, paginação, histórico (um evento por salvamento, sem evento sem mudança), auditoria, ex-membro, aviso do EDITOR (3.5), erro de rede, foco e Esc nos modais, `Cache-Control: no-store`.
- Sem rolagem horizontal, rótulos, alt em imagens e h1 em todas as telas novas; modais cabem em 360px.

## Reteste 1

Resultado: REPROVADO por 1 teste intermitente do front e por pendências de produção; todos os defeitos altos e médios estão corrigidos.

### Execução
- `make check`: lint, typecheck e testes passam (backend 486, frontend 140).
- `make e2e` (3 rodadas completas, 222 testes no total, chromium e mobile 360px): a rodada final teve 221 passando e 1 falha intermitente (item A abaixo). A primeira rodada teve 1 ECONNRESET isolado em cadastro (reinício do backend em modo watch durante a execução; passou ao repetir). M1, M2 e M5 sem regressão.
- Specs antigos atualizados para os contratos novos (não são defeitos): preço só string (422 para número), `fotoCapaId` sem URL no 409, chave de envio em `casas/<id>/pendentes/`, `uso.armazenamento` comparado ao de `/assinaturas/atual`, nomes acessíveis "Tornar capa da foto N" e "Remover foto N", `fotosOrfasPendentes` em `/internal/jobs`.
- Novo `e2e/tests/m3-reteste1.spec.ts` (7 testes, todos passam): regravar pela URL de envio após confirmar não altera a foto servida; EXIF/GPS e bytes anexados removidos; arquivo corrompido e 8001 px dão 422 ARQUIVO_INVALIDO; URL de leitura com validade <= 900 s, `response-*` e cabeçalhos do objeto (inline, private); teto de 10 envios pendentes (11º dá 429 MUITAS_TENTATIVAS); 409 sem URL assinada; validação (preço número, data 0001, U+202E, U+200B, NUL, NFD e espaço duplo na duplicidade, busca com NUL, `pagina` 10001).

### Situação dos defeitos anteriores
| # | Defeito | Resultado |
|---|---|---|
| 1 | Campo "Nova tag" colapsa | Corrigido (testes de 120 px passam no desktop e no mobile) |
| 2 | `GET /me` sem `uso.armazenamento` | Corrigido |
| 3 | Tipo real diferente do declarado | Corrigido (422) |
| 4 | Alvos de toque < 44 px | Corrigido (testes mobile passam) |
| 5 | `label-content-name-mismatch` | Corrigido (axe passa) |
| 6 | Links da tela 05 com 24 px | Corrigido |
| 7 | `upload-url` bloqueia troca com cota cheia | Aberto por decisão (limitação documentada no contrato, seção 3.3) |
| 8 | Objeto regravável após confirmar | Corrigido (chave de envio separada da servida) |
| 9 | EXIF/GPS servido | Corrigido no servidor (recodificação) e aviso na tela 08 |
| 10 | Leitura sem cabeçalhos seguros | Parcial: TTL 15 min, `response-*` e sem URL no 409 corrigidos; `nosniff` na borda do bucket e domínio separado seguem pendentes (ver B) |
| 11 | Sem teto de pendentes | Corrigido (10 por usuário, 30 por Casa) |
| 12 | Validação incompleta | Corrigido (a a f) |
| 13 | Portas em todas as interfaces | Corrigido (`infra-compose.spec.ts`) |
| 14 | npm audit (prisma/deepmerge-ts) | Aberto, aceito (só CLI; exige major do Prisma) |
| 15 | CSP sem `blob:`, sem Referrer-Policy, sem no-danger | Corrigido |

### Defeitos abertos ou novos
- A (baixa, frontend): `m3-fotos-ui` "foto que não carrega (URL assinada vencida): o front refaz a consulta do produto" falhou 1 vez em 3 rodadas completas (8 de 8 passam isoladas). Com a máquina carregada, o `GET /produtos/:id` não é repetido após o erro da imagem. Origem provável: `DetalheProduto.tsx` (`aoFalharFoto`) combinado com `loading="lazy"` e `FotoProduto.tsx`. Um teste que falha de vez em quando precisa ser tratado como falha.
- B (média, infra): o objeto servido pelo bucket não tem `X-Content-Type-Options: nosniff` (em dev o `/s3` é do mesmo domínio do app e o proxy do Vite não o acrescenta); domínio do bucket separado do app e redação de `X-Amz-Signature` em logs seguem pendentes para produção. Os cabeçalhos `Content-Disposition: inline` e `Cache-Control: private` estão corretos.
- C (média, infra): pendências de produção ainda não implementáveis no ambiente local: validar `Content-Length` do PUT assinado no R2 (R-M3-1), CORS de produção com uma origem, cron horário do job de órfãos e regra de ciclo de vida do bucket (o cursor do job é em memória).
- D (baixa, backend/doc): `m1-auth.md` (Perfil) e `m5-assinatura.md` (3.8) ainda não registram `uso.armazenamento` e `fotosOrfasPendentes`; só o `m3-produtos.md` os descreve.

## Reteste 2

Resultado: REPROVADO apenas por pendências de produção e de contrato que seguem abertas (nenhum defeito alto, nenhum teste falhando). Sem regressão em M1, M2 e M5.

### Execução
- `make check`: lint, typecheck e testes passam (backend 487, frontend 143).
- `make e2e` completo (chromium e mobile 360px): 227 passaram, 0 falharam.
- `m3-fotos-ui` repetido 3 vezes x 3 repetições com 4 workers (57 testes por rodada): 57 passaram nas 3 rodadas, inclusive "foto que não carrega". A intermitência não reapareceu.
- Novo `e2e/tests/m3-reteste2.spec.ts`: com a cota exatamente cheia, `upload-url` sem `substituiFotoIds` dá 409; com o id da própria foto dá 200; troca por foto 1 byte maior dá 409; id de outra Casa não libera cota (409); id malformado dá 422.

### Situação dos defeitos
| # | Defeito | Resultado |
|---|---|---|
| 1 | Consulta do produto não refeita quando a foto falha (intermitente) | Corrigido (9 execuções repetidas sob carga e a suíte completa passam) |
| 2 | Sem `nosniff` no objeto servido | Corrigido em dev (proxy `/s3`, `m3-infra-producao`). Domínio separado do bucket e redação de `X-Amz-Signature` em logs seguem dependentes de produção |
| 3 | Pendências de produção | Parcial: cron horário (`jobs.yml`), CORS de produção com uma origem, script de validação de Content-Length (passa no SeaweedFS) e lifecycle entregues. Validação no R2 real continua pendente. Cursor do job em memória não corrigido |
| 4 | Contratos m1/m5 sem campos aditivos | Aberto: `fotosOrfasPendentes` e `Perfil.uso.armazenamento` não constam em `m1-auth.md` nem `m5-assinatura.md` (m1 3.12 e m5 3.8 citam só `fotosOrfasApagadas`) |
| 5 | `upload-url` bloqueia troca com cota cheia | Corrigido (`substituiFotoIds`) |
| 6 | npm audit prisma/deepmerge-ts | Aberto, aceito (só CLI, exige major do Prisma) |

### Defeitos abertos
- MÉDIA (infra): validar no R2 real o `Content-Length` assinado (R-M3-1), `nosniff` e domínio do bucket separado, redação de `X-Amz-Signature` nos logs. Não verificável localmente.
- BAIXA (backend): cursor de `limparFotosOrfas` só em memória (`backend/src/jobs/index.ts`).
- BAIXA (backend/contrato): `m1-auth.md` e `m5-assinatura.md` sem `fotosOrfasPendentes` e `Perfil.uso.armazenamento` (Arquiteto).
- BAIXA (backend): npm audit, 3 altas via prisma/deepmerge-ts.
