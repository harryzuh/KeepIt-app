# Modelo de ameaças — M3 Produtos, Tags e Fotos (upload por URL assinada)

- **Autor:** Engenheiro de Segurança e Privacidade (AppSec / LGPD)
- **Data:** 2026-11-15
- **Escopo:** `POST /produtos/fotos/upload-url`, envio `PUT` direto ao S3, confirmação ao salvar (`POST /produtos`, `PATCH /produtos/:id`), leitura por URL assinada, rotina `limparFotosOrfas`, CRUD de produtos, tags, busca, duplicidade, histórico/auditoria e o proxy `/s3` do Vite.
- **Base lida:** `docs/api/m3-produtos.md`, `docs/adr/0003-m3.md`, `AGENTS.md` (papel 7), `docs/seguranca/m1-modelo-ameacas.md` e `m5-m2-modelo-ameacas.md` (formato e ameaças herdadas), `backend/src/lib/s3.ts` (`chaveEhDaCasa`, `assinarEnvio`), `backend/prisma/migrations/20261117100000_m3_produtos_fotos_tags/migration.sql`, `infra/s3/cors.json`, `frontend/csp.ts`. **Não li código dos módulos `produtos/` e `tags/`:** ainda não existem. Esta etapa não altera código.
- **Uso:** a seção 6 lista falhas de design que precisam de decisão do Arquiteto **antes** de o Back-end implementar as histórias 3.1.2, 3.1, 3.3 e 3.4. A seção 7 é o checklist da revisão de código e de testes.
- **Regra do papel:** itens **[BLOQUEANTE]** são os que considero inaceitáveis até para MVP. Os demais podem virar backlog com aceite formal do PO.

---

## 1. Ativos

| # | Ativo | Onde vive | Por que importa |
|---|---|---|---|
| A1 | Inventário da Casa (nome, descrição, preço, quantidade, data, tags) | `produto`, `tag`, `produto_tag` | Patrimônio declarado pelo usuário; descrição livre pode conter dado pessoal (nota fiscal, endereço, número de série) |
| A2 | Fotos dos produtos (objetos no S3) | bucket `keepit-fotos`, `casas/<casaId>/fotos/<uuid>.<ext>` | Fotos de dentro de casas: móveis, cômodos, documentos, rostos; EXIF pode trazer GPS e modelo do aparelho |
| A3 | Credenciais do S3 (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) | env do backend | Quem as tem lê e apaga o bucket inteiro (todas as Casas) |
| A4 | URLs assinadas de envio (5 min) e de leitura (1 h) | corpo das respostas, cache do navegador, logs | São credenciais ao portador |
| A5 | Cota de armazenamento por plano (RF39) | `foto.tamanhoBytes`, `plano.service` | Controle de custo e de receita |
| A6 | Isolamento entre Casas (J1) | `casaId` do token em toda consulta; prefixo da chave | Falha = vazamento entre clientes |
| A7 | Histórico e auditoria (`log_auditoria`) | `detalhes` JSON | Evidência (RNF05); pode virar depósito de texto pessoal |
| A8 | Rotina `limparFotosOrfas` e `JOBS_TOKEN` | `POST /internal/jobs` | Mantém o bucket e a cota coerentes; apaga dados (LGPD) |
| A9 | Disponibilidade e custo do bucket | R2/SeaweedFS, banda | Envio abandonado e objetos grandes custam dinheiro |

## 2. Atores

| Ator | Capacidade assumida |
|---|---|
| LEITOR malicioso | Token válido; tenta escrever (produto, tag, `upload-url`) e ler fotos que não deveria |
| EDITOR malicioso | Escreve na própria Casa; tenta estourar cota, plantar conteúdo ativo, apagar objeto alheio da mesma Casa, inflar tabelas |
| ADMIN/EDITOR de **outra** Casa | Tenta IDOR por `:id`, `tagId`, `tagIds`, `fotos.id`, `duplicadoId` e `chave` |
| Ex-membro | Guarda URLs de leitura já obtidas (válidas até 1 h) |
| Visitante com conta nova (plano Individual) | Cria contas em massa para consumir banda e armazenamento |
| Atacante com XSS no front | Rouba URLs assinadas e faz PUT/GET em nome da vítima |
| Insider / operador | Lê logs, banco, bucket |
| Usuário comum | Fotografa documentos, crianças, fachada; sobe foto com GPS sem saber |

## 3. Superfície e fluxo de dados

```
Navegador ──(1) POST upload-url──▶ API ──assina──▶ (chave + URL PUT 5 min)
Navegador ──(2) PUT bytes ───────▶ S3  (Content-Type e Content-Length assinados)
Navegador ──(3) POST/PATCH produto (fotos:[{chave}])──▶ API ──HEAD + 16 bytes──▶ S3
                                         API ──tx: Casa FOR UPDATE, cota, foto.create──▶ Postgres
Navegador ◀──(4) ProdutoDetalhe com URL GET assinada 1 h── API
Job horário: lista casas/ ─▶ apaga objeto > 2 h sem linha em foto
```

Entradas não confiáveis: corpo de `upload-url` (`tipo`, `tamanhoBytes`), os **bytes** (que a API nunca vê passar), `chave`, `nome`, `descricao`, `preco`, `quantidade`, `dataCompra`, `tagIds`, `fotos[].id`, `duplicado`, `duplicadoId`, query de busca (`busca`, `tagId`, `pagina`, `limite`, `ordem`).

---

## 4. Ameaças STRIDE e mitigação esperada

Convenção: `B:` backend, `F:` frontend, `D:` devops. "Contrato" = `docs/api/m3-produtos.md`; "ADR" = `docs/adr/0003-m3.md`. Estado: **OK** = o desenho já cobre; **FALHA** = lacuna, ver seção 6; **VERIFICAR** = depende da implementação.

### 4.1 Uploads de foto

| ID | STRIDE | Ameaça | Mitigação esperada | Estado | Onde |
|---|---|---|---|---|---|
| U1 | S/T | **Tipo forjado:** extensão `.png` e `Content-Type: image/png` com conteúdo de outro formato (HTML, SVG, ZIP, PHP, executável) | Conferir os **bytes** (`FF D8 FF`; `89 50 4E 47 0D 0A 1A 0A`) ao salvar; gravar `Foto.tipo` pelo detectado; rejeitar se o tipo declarado ≠ detectado; apagar o objeto | OK com ressalva: o ADR D2 diz que o `Content-Type` do objeto é "o declarado" e o `Foto.tipo` é o detectado, o que admite divergência; o contrato 5.5 manda rejeitar. Ver FD7 | B: `produtos.service`, `lib/tipo-imagem.ts` |
| U2 | T | **Polyglot:** arquivo com cabeçalho PNG/JPEG válido e HTML/JS/PDF/ZIP anexado depois (ou ZIP no início do JPEG, "GIFAR"). Passa na conferência de 16 bytes | Servir sempre com `Content-Type` de imagem e `X-Content-Type-Options: nosniff`; bucket em **origem separada** do app e sem cookies; `Content-Disposition` e cache forçados na assinatura do GET (`ResponseContentType`, `ResponseContentDisposition`); a longo prazo reprocessar a imagem (decodificar e recodificar) | **FALHA parcial.** R-M3-2 aceita o risco sem condicionar a origem separada. **Em dev o `/s3` é da mesma origem do app** (`localhost:5173/s3`). Ver FD6 | D: bucket e domínio; B: `assinarLeitura` |
| U3 | T/E | **SVG/HTML servido como imagem:** SVG tem script; HTML em `.png` | SVG e HTML nunca passam (`image/svg+xml` não está em `MIMES_ACEITOS`; assinatura de bytes não bate); `Content-Type` assinado no PUT impede o S3 de gravar `text/html` | OK, desde que `tipoPorMime` use lista fechada e a assinatura do PUT inclua `content-type` (já inclui) | B: `s3.ts` |
| U4 | T/D | **Tamanho acima do assinado ou do limite:** PUT de 5 GB com `tamanhoBytes: 1` | `Content-Length` assinado; HEAD na confirmação (apaga acima de 5 MB); rate limit | OK no SeaweedFS (testado 403). **R2 não foi validado** (R-M3-1). Pior que gastar banda: com o objeto sendo **regravável** depois da confirmação, vira burla de cota. Ver FD1 | D: R2; B: confirmação |
| U5 | T/I | **URL de envio reutilizável por 5 min:** o mesmo PUT pode ser repetido; nada a torna de uso único. Após a confirmação, quem guarda a URL **substitui os bytes** já validados (mesmo tamanho e `Content-Type`) | Impedir regravação da chave confirmada: (a) a API **copia** o objeto para uma chave definitiva só do servidor (`CopyObject`) e apaga a original; ou (b) o PUT assinado exige `If-None-Match: *` (suporte a verificar em R2/SeaweedFS); ou (c) só confirmar depois do vencimento da URL | **FALHA [BLOQUEANTE].** Ver FD1 | B: `produtos.service`; ADR D2, D6 |
| U6 | I | **Objeto de outra Casa (chave previsível):** referenciar `casas/<outra>/fotos/<uuid>` em `fotos` | UUID v4 (122 bits); `chaveEhDaCasa` ancorada no prefixo da Casa do token; erro igual a "objeto ausente" (`ARQUIVO_INVALIDO`) para não confirmar existência | OK. Ressalvas: o regex aceita `[0-9a-f-]{36}` (qualquer combinação, não só UUID); o `casaId` na chave é identificador sequencial exposto (baixo). Ver FD10 | B: `s3.ts` |
| U7 | I/T | **Chave de outra foto da mesma Casa:** EDITOR envia, em `POST /produtos`, a `chave` de uma foto **já gravada** de outro produto. A API checa "não está em uso" (422), mas o texto do ADR manda "apagar objetos inválidos" e, em `SOMAR`, "fotos informadas são descartadas e apagadas do S3" | Nunca apagar chave que tenha linha em `foto`; só apagar chave **emitida para esta requisição e sem `Foto`**. Tratar `P2002` (unicidade de `foto.chave`) como `422 ARQUIVO_INVALIDO`, não 500 | **FALHA [BLOQUEANTE].** Ver FD2 | B: `produtos.service` |
| U8 | R | **Corrida de cota:** vários cadastros/edições simultâneos passam pela cota e estouram o plano | Trava `casa FOR UPDATE` e `exigirCotaParaEnvio(tx)` na mesma transação; saldo líquido na edição | OK para a decisão final. O aviso do `upload-url` não é travado (aceitável, é só antecipação). **Brecha:** a cota usa o tamanho lido por HEAD **antes** da trava; se o objeto for regravado depois (U5), o tamanho gravado em `Foto` ≠ tamanho real. Ver FD1 | B: `produtos.service`, `plano.service` |
| U9 | D | **Cota contornada por envios nunca confirmados:** só `Foto` gravada conta; cada usuário pode pedir 30 URLs/min de 5 MB (≈ 9 GB/h por usuário) e o objeto fica até a rotina (2 h + 1 h). A rotina remove **no máximo 500 por hora** e lê só as 10 primeiras páginas | Cota "pendente" por Casa/usuário (soma das URLs emitidas e não confirmadas), teto de URLs pendentes (ex.: 10 por usuário), limpeza que acompanhe a taxa de criação, ordem de varredura justa | **FALHA [ALTA].** Ver FD3 | B: `limparFotosOrfas`; ADR D6, R-M3-5 |
| U10 | D/I | **Objetos órfãos que nunca são limpos:** a varredura lista `casas/` em ordem lexicográfica e para em 10 páginas (10 000 objetos). Casas de id alto nunca são alcançadas se as de id baixo tiverem muitos objetos válidos | Varrer por prefixo de Casa com cursor persistido, ou regra de ciclo de vida do bucket + inventário; métrica de "órfãos pendentes" no `/internal/jobs` | **FALHA [ALTA].** Ver FD3 | ADR D6, R-M3-4 |
| U11 | T | **Janela entre confirmar e limpar (borda das 2 h):** a confirmação aceita a chave aos 1h59 e a rotina apaga aos 2h01 antes do commit; resulta em `Foto` sem objeto (imagem quebrada, cota consumida) | Margem: confirmar só até 1h45 (`confirmarAte` menor que o limite da rotina); a rotina confere de novo a linha `Foto` imediatamente antes de apagar; conferir também `modificadoEm` | VERIFICAR (baixa) | B: confirmação e job |
| U12 | I | **EXIF com localização (LGPD):** JPEG de celular traz GPS, data, modelo, número de série; fica no objeto e é entregue a todos os membros (inclusive LEITOR) e a quem tiver a URL | Remover metadados **antes de servir**: no front (recodificar em canvas antes do PUT; vale como minimização, não como controle, pois o cliente é não confiável) **e** no servidor (tarefa pós-envio que recodifica e grava em chave nova); aviso na tela 08; política de privacidade | **FALHA [ALTA, LGPD].** Hoje está no backlog (ADR D2 último parágrafo). Ver FD5 | F: tela 08; B: pós-processamento |
| U13 | I | **GET assinado vazando:** URL de 1 h pode parar em histórico, logs do proxy/CDN, cache do React Query, ferramenta de erro, captura de tela, mensagem copiada; vale para quem a tiver, sem revogação (R-M3-3) | TTL curto (≤ 15 min para leitura é viável com `staleTime` menor), `no-store` (já previsto), nunca registrar URL em log, redigir `X-Amz-Signature` no logger e na ferramenta de erros; a resposta `409 PRODUTO_DUPLICADO` também carrega URL em `details`; `Referrer-Policy` do front; `Content-Disposition`/`private` no GET | **FALHA [MÉDIA].** 1 h é longo para foto de interior de casa. Ex-membro e LEITOR removido mantêm acesso até vencer. Ver FD8 | B: logger, `assinarLeitura`; F: cache |
| U14 | I | **CDN/cache na frente do bucket (produção):** se a chave de cache ignorar a query string, a imagem sai sem assinatura depois | `Cache-Control: private, no-store` no GET (`ResponseCacheControl`), chave de cache com a assinatura, ou sem cache de borda | VERIFICAR (D:) | D: R2 |
| U15 | T | **CORS permissivo no bucket:** `AllowedOrigins: *` ou origem errada permite PUT/GET por outro site com URL roubada | Produção só com a origem exata do front, métodos `GET, PUT, HEAD`, cabeçalho `content-type` | OK em dev (`infra/s3/cors.json`); **VERIFICAR** em produção (D:) | `infra/s3/cors.json` |
| U16 | D | **Bomba de descompressão (pixel flood):** PNG de 5 MB que descomprime para dezenas de milhares de pixels por lado; derruba aba do navegador ao renderizar e qualquer futura geração de miniatura no servidor | Limite de dimensões na confirmação (ler IHDR do PNG e SOF do JPEG, ex.: ≤ 8000 px por lado, ≤ 40 Mpx); só então liberar miniaturas | **FALHA [MÉDIA].** Não há limite de dimensões no contrato. Ver FD9 | B: confirmação |
| U17 | R | **Sem rastro de quem enviou a foto:** `Foto` não guarda o autor; não dá para atender pedido de um titular específico nem investigar abuso (ex.: conteúdo ilegal) | Guardar `enviadoPorId` (`SetNull` ao apagar o usuário) ou registrar `FOTO_ENVIADA` na auditoria sem a chave | Decisão do PO/Arquiteto (FD11) | schema |
| U18 | E | **Credencial do S3 vazada ou ampla demais:** a chave do backend lê, lista e apaga todo o bucket | Chave só para este bucket; sem acesso público; dev: porta 9000 publicada só em `127.0.0.1`; produção: segredo no gerenciador de segredos, rotação | VERIFICAR (D:) | D: compose, R2 |
| U19 | E | **Proxy `/s3` do Vite no desenvolvimento:** repassa qualquer caminho ao S3 interno | Só em dev; confirmar que `VITE_S3_PROXY*` não existe no build de produção (variáveis `VITE_` são gravadas no bundle); SeaweedFS exige assinatura (GET sem assinatura = 403, testado) | OK com checagem de build (checklist 7.8) | `vite.config.ts` |
| U20 | T | **Falha parcial entre S3 e banco:** `DELETE` apaga o objeto depois do commit; se falhar, fica órfão; se o commit falhar depois de apagar, fica `Foto` sem objeto | Ordem do ADR (banco primeiro, S3 depois, sem lançar) está certa; nunca apagar o objeto antes do commit; job recolhe | OK | B: `produtos.service` |

### 4.2 Produtos, tags, busca e histórico

| ID | STRIDE | Ameaça | Mitigação esperada | Estado | Onde |
|---|---|---|---|---|---|
| P1 | I/E | **IDOR entre Casas** por `:id`, `tagId`, `tagIds`, `fotos.N.id`, `duplicadoId` e `chave` | Toda consulta e todo `UPDATE`/`DELETE` com `casa_id = req.usuario.casaId` **no mesmo `WHERE`** (nunca "busca por id, depois compara"); 404 para outra Casa; `422` indistinguível entre "de outra Casa" e "inexistente"; `duplicadoId` de outra Casa se comporta como "sumiu" (resposta `201 CRIADO`) | OK no desenho; **VERIFICAR** na implementação, principalmente o `UPDATE` da soma e o `fotos.N.id` | B: `produtos.service` |
| P2 | E | **LEITOR editando:** `POST`/`PATCH`/`DELETE` de produto, `POST /tags` e `POST /produtos/fotos/upload-url` | `autorizar(ADMIN_OU_EDITOR)` em **toda** rota de escrita, inclusive `upload-url`; papel lido do banco por requisição (`autenticar`); teste com `testarMatrizDePapeis` | OK; `upload-url` é a rota mais fácil de esquecer | B: `*.routes.ts` |
| P3 | T | **Injeção na busca:** `busca` com `%`, `_`, `\`, aspas, `'; DROP`; `ordem` ou `pagina` concatenados em SQL cru | Consulta parametrizada (`Prisma.sql`), `ESCAPE '\'` explícito, `ordem` por lista fechada (nunca interpolar), `$queryRawUnsafe` proibido; teste com `%` (não pode listar tudo) | VERIFICAR; o contrato já exige tratar `%`, `_`, `\` como literais | B: `produtos.service` |
| P4 | D | **Busca "contém" sem índice:** `ILIKE '%x%'` não usa o B-tree `lower(nome)`; Casa com muitos produtos + limite global dos `GET` permite carga | Limite próprio para `GET /produtos` com `busca` (ex.: 60/min por usuário), teto de produtos por Casa, `pg_trgm` no backlog com gatilho de medição | **FALHA [MÉDIA].** Ver FD4 | contrato 3 |
| P5 | D | **Paginação extrema:** `pagina=2147483647` e `limite=100` estoura o `skip` (Int de 32 bits do Prisma) → 500, ou força `OFFSET` enorme | Teto de `pagina` (ex.: ≤ 10 000) ou `totalPaginas` como limite; 422 acima | **FALHA [BAIXA].** Contrato diz só "inteiro ≥ 1". Ver FD9 | contrato 3.5, 3.9 |
| P6 | T | **Valores negativos ou enormes:** `quantidade` -1, 0, `1e9`, `"5"`, `5.0`, `true`, `null`; `preco` `"-1"`, `"1e3"`, `" 12"`, `"0x1F"`, `"١٢٣"`, `1.005` (número JSON); `dataCompra` `0001-01-01` ou `9999-12-31` | Zod **estrito** (sem `z.coerce` em corpo); inteiro 1 a 1 000 000; `preco` por regex `^\d{1,10}(\.\d{1,2})?$` na string; **número JSON só se o texto original tiver ≤ 2 casas** (ou recusar número e aceitar só string); `Decimal` no banco (nada de `Float`); `dataCompra` com piso (ex.: ≥ 1900-01-01) | **FALHA parcial:** contrato aceita número JSON com 2 casas (arredondamento binário) e não define piso para `dataCompra`. Ver FD9 | B: `produtos.schema.ts` |
| P7 | T | **Soma estoura o limite:** `SOMAR` repetido ou concorrente | `UPDATE … WHERE quantidade + n <= 1 000 000` atômico (previsto) | OK | ADR D4 |
| P8 | T/E | **XSS em nome, descrição e tag** (e nos textos `de`/`para` do histórico, nos nomes de autor e Casa) | Defesa real é a **saída**: React escapa por padrão; proibir `dangerouslySetInnerHTML`, `innerHTML`, `href` montado com dado do usuário, `eval`; CSP `script-src 'self'` (já existe). A recusa de `<` e `>` na entrada é só defesa extra | OK se a saída for escapada; **a lista negra não protege** atributos (`" onfocus=`), `javascript:`, e-mail HTML ou exportação CSV. Ver FD12 | F: componentes de lista, detalhe, histórico, tela 09 |
| P9 | T | **Caracteres invisíveis e de direção:** U+202E (inverte o texto), U+200B/U+FEFF (largura zero), U+2028/2029, NBSP, caracteres de formato (`Cf`) em nome/tag. Servem para spoofing na tela, no histórico e na tela 09, e para burlar a duplicidade | Normalizar na entrada: NFC, trocar NBSP/espaços Unicode por espaço, **colapsar** espaços internos, remover/recusar `Cf` (permitir só U+200D e U+FE0F dentro de sequência de emoji) e controles `Cc` (inclui NUL, que o Postgres recusa e viraria 500) | **FALHA [MÉDIA].** "Controle" no contrato não cobre `Cf`. Ver FD13 | B: schemas Zod |
| P10 | T | **Duplicidade contornada por Unicode e espaços:** `Café` (NFC) × `Café` (NFD), `Cafe`, `Café ` (NBSP), `Ca  fé` (2 espaços), caracteres de largura total, homóglifos (cirílico `а`). O contrato **decidiu não normalizar** acentos e espaços internos | Normalização de armazenamento (NFC + espaços colapsados) elimina NFD/NBSP/espaço duplo sem mudar a regra de acentos; homóglifos ficam como risco aceito (duplicidade é ajuda de UX, não controle de segurança) | **FALHA [BAIXA]** (risco aceitável, mas hoje evitável a custo baixo). Ver FD13 | contrato 1 |
| P11 | I | **Índice não usado na duplicidade:** contrato diz `lower(trim(nome))`, o índice é `(casa_id, lower(nome))`; a expressão com `trim` não casa com o índice | Armazenar `nome` já aparado (já é) e comparar `lower(nome) = lower($1)`, usando a mesma função (`lower`) do índice. Idem `tag` | **VERIFICAR** (desempenho e correção) | B: `produtos.service` |
| P12 | T | **`lower()` do JS ≠ `lower()` do Postgres** (ex.: `İ`, `ß`, `Σ`): a checagem na API passa, o índice único de tag no banco recusa | Comparar **no banco** (`lower(nome) = lower($1)`); tratar `P2002` do índice `tag_casa_id_lower_nome_key` como `409 TAG_EXISTENTE` (devolvendo `existente`), nunca 500 | VERIFICAR | B: `tags.service` |
| P13 | D | **Tabelas sem teto:** `POST /tags` 30/min por usuário = ~43 000 tags/dia; `GET /tags` **sem paginação** devolve todas, com `quantidadeProdutos` (contagem agregada); produtos por Casa sem teto explícito; `descricao` de 1000 caracteres duplicada em cada evento `ALTERADO` (de/para) | Teto de tags por Casa (ex.: 200, `422 LIMITE_TAGS`), teto de produtos por Casa por plano (ex.: 10 000), truncar `descricao` no histórico (guardar só "alterada" ou os primeiros 200 caracteres), retenção do `log_auditoria` | **FALHA [MÉDIA].** ADR D5 aceita "sem teto de tags". Ver FD4 | contrato 3.1, ADR D5 |
| P14 | I | **Enumeração por id sequencial e por mensagens:** ids de produto e `usuarioId` sequenciais (`adicionadoPor.id`) expostos a todos os papéis | 404 uniforme (já); `adicionadoPor` só com nome (sem id) se não houver necessidade na tela; limite global | VERIFICAR (herda FP6 do M5/M2) | contrato 2 |
| P15 | R | **Auditoria incompleta ou com dado pessoal:** `PRODUTO_EXCLUIDO` guarda nome, preço, quantidade; `ALTERADO` guarda textos de/para; sem IP; log sem retenção | Auditar toda escrita (`PRODUTO_*`, `TAG_CRIADA`) na **mesma transação**; não registrar chave, URL nem e-mail (previsto); definir retenção e o que acontece com os logs da Casa excluída (LGPD) | OK no conteúdo; **retenção indefinida.** Ver seção 5 | `auditoria.ts` |
| P16 | T | **Mass assignment:** corpo com `casaId`, `adicionadoPorId`, `dataCadastro`, `atualizadoEm`, `id` | Zod com `strip` e montagem **explícita** dos campos em `data` (nunca `...req.body`) | VERIFICAR | B: schema e service |
| P17 | T | **Idempotência:** clique duplo ou repetição por rede lenta em `POST /produtos` (com `CADASTRAR_MESMO_ASSIM`) cria dois produtos; duas requisições simultâneas passam pela checagem de duplicidade (o índice de nome não é único, de propósito) | Aceitável (duplicidade é UX); opcional: cabeçalho `Idempotency-Key` ou desabilitar o botão no front | Risco aceito (seção 8) | F: tela 08/09 |
| P18 | D | **Concorrência de `PATCH`/`DELETE`/soma:** impasse vira 500 | Ordem Casa → Produto (ADR D8), `comNovasTentativas`, `40P01`/`40001` → `409 CONFLITO_CONCORRENTE` | OK no desenho | ADR D8 |

---

## 5. Requisitos LGPD aplicáveis (M3)

| # | Requisito | Situação no M3 | Ação |
|---|---|---|---|
| L1 | **Minimização (art. 6, III):** fotos e EXIF | O EXIF (GPS, data, aparelho, às vezes nome do autor em XMP) fica no objeto e é servido a todos os membros | Remover metadados antes de servir (U12); aviso na tela 08 de que a foto fica visível a toda a Casa; recomendar não fotografar documentos |
| L2 | **Eliminação (art. 18, VI) e RNF16 (24 h):** exclusão de conta e de Casa | ADR D6/Q11 apaga `casas/<id>/fotos/` ao excluir a Casa e deixa a rotina recolher as falhas; **depende de a rotina horária estar de pé** (FP10 do M5/M2) e de ela alcançar o objeto (U10) | Teste de ponta a ponta "excluir Casa → prefixo vazio"; alerta se a rotina falhar ou ficar > 2 h sem rodar |
| L3 | **Conteúdo de quem sai da Casa** (R-M2-1) | Produtos e fotos ficam na Casa; `adicionadoPor` vira `null`. O aviso é a história 3.5 (só front) | Garantir que o aviso aparece **antes** da confirmação de sair, em texto claro; registrar no texto de privacidade (RF30) que os dados de produtos pertencem à Casa |
| L4 | **Foto com dado pessoal de terceiros** (rosto, documento, fachada com número) | Fora do controle técnico; o usuário é o controlador do que fotografa | Termos de uso proíbem documentos pessoais e fotos de terceiros; canal para denúncia; `Foto` sem autor impede localizar quem enviou (U17) |
| L5 | **Retenção do `log_auditoria`** | `detalhes` guarda nome, preço e textos de descrição (de/para), indefinidamente; produto excluído deixa o log | Prazo de retenção (ex.: 12 meses para eventos de produto), anonimização do `usuarioId` e remoção dos logs de produto quando a Casa é excluída |
| L6 | **Compartilhamento com operadores** | Bucket em terceiro (R2/Cloudflare) | Registrar o operador e a região no RIPD/política; criptografia em repouso ativada |
| L7 | **Registro de acesso** (marco civil) | A auditoria não grava IP | Decisão do PO; se gravar IP, entra em L5 |

---

## 6. Falhas de design nos contratos (`docs/api/m3-produtos.md`) e no ADR 0003

Severidade: A = alta, M = média, B = baixa. "Decisor" é quem precisa agir. **[BLOQUEANTE]** = não deve ir a produção sem correção.

| ID | Sev. | Falha | Evidência | Recomendação | Decisor |
|---|---|---|---|---|---|
| FD1 | A **[BLOQUEANTE]** | **O objeto confirmado pode ser regravado.** A URL de envio vale 5 min e pode ser repetida. Quem confirma a foto dentro desses 5 min e faz outro `PUT` (mesmo tamanho e mesmo `Content-Type`, que são o que está assinado) troca os bytes **depois** da conferência de tipo. Resultado: o tipo e o tamanho conferidos deixam de valer, e se o R2 não impuser `Content-Length` (R-M3-1) o objeto pode ter qualquer tamanho e a cota é burlada (a linha `Foto` guarda o tamanho antigo) | ADR D2(b)(c); R-M3-1 e R-M3-2; contrato 3.3 ("o mesmo número de bytes") e 5.5 | **Separar a chave gravável da chave servida.** Voltar ao prefixo `pendentes/` da proposta do PO (rejeitado no D6) **só para o PUT**: ao confirmar, a API faz `CopyObject` para `casas/<id>/fotos/<uuid>` (chave que nunca teve URL de escrita) e apaga o original. A conferência (HEAD, bytes, dimensões) é feita **na cópia** ou sobre o original já copiado; o `chaveEhDaCasa` aceita os dois prefixos conforme a etapa. Alternativas inferiores: `If-None-Match: *` assinado (verificar suporte) ou confirmar só após o vencimento da URL. Gravar o `ETag` em `Foto` e conferi-lo na rotina de reconciliação | Arquiteto |
| FD2 | A **[BLOQUEANTE]** | **A API "apaga objeto inválido/descartado" sem exigir que a chave seja só dela.** `SOMAR` descarta e apaga as fotos informadas; falhas de validação "apagam o objeto inválido". Se a `chave` informada já pertence a uma `Foto` gravada (de outro produto da Casa), o objeto de uma foto válida é destruído, a linha `Foto` fica sem objeto e a cota segue ocupada, sem auditoria. Há ainda a corrida: duas requisições com a mesma `chave` violam `foto.chave` única e viram 500 | ADR D2(c), D4 (Q2); contrato 3.4 ("Fotos informadas junto são descartadas e apagadas do S3"), 5.5 | Regra no ADR: **só se apaga chave sem linha em `foto`** (conferir dentro da mesma transação ou no `DELETE` condicionado); `P2002` em `foto.chave` → `422 ARQUIVO_INVALIDO` sem apagar nada; teste "chave de foto gravada em `SOMAR` não apaga o objeto" | Arquiteto |
| FD3 | A | **A limpeza de órfãos não acompanha a taxa de criação e é injusta entre Casas.** 30 URLs/min por usuário (até 1 800 objetos/h, 9 GB/h) contra 500 remoções/h; varredura lexicográfica limitada a 10 000 chaves sempre a partir de `casas/1/`: Casas de id alto podem **nunca** ser limpas (inclusive a Casa excluída, o que quebra RNF16). Nada limita o número de URLs pendentes por usuário | ADR D5 (30/min), D6 (limites por execução), R-M3-4, R-M3-5 | (1) Teto de **pendentes por usuário/Casa** (contar `upload-url` emitidos e não confirmados nas últimas 2 h, ex.: 10) e cota pendente por Casa; (2) a rotina varre **por Casa** (itera `casa`, lista `casas/<id>/fotos/`) ou guarda um cursor persistido; (3) limites de remoção proporcionais; (4) regra de ciclo de vida do bucket para `pendentes/` (1 dia) como rede de proteção; (5) `fotosOrfasPendentes` no retorno do job com alerta | Arquiteto + DevOps |
| FD4 | M | **Sem tetos de volume e sem limite próprio para busca e listagem de tags.** `GET /tags` não é paginado; "não há teto de tags" (D5); produtos por Casa sem teto; `ILIKE '%x%'` sem índice sob o limite global; `descricao` (até 1000) duplicada de/para em cada evento do histórico | Contrato 3.1, 3.5; ADR D5, D7 | Tetos por Casa (tags 200, produtos conforme plano); limite de 60/min por usuário em `GET /produtos` com `busca`; histórico guarda `descricao` truncada (200) ou só "alterada"; `pg_trgm` com gatilho de medição | Arquiteto + PO |
| FD5 | A (LGPD) | **EXIF com GPS é servido a todos os membros e a quem tiver a URL.** Está só no backlog, sem prazo e sem mitigação intermediária. O aviso ao usuário também não existe | ADR D2 (último parágrafo); histórias 3.1.2 e 3.1 | (1) Recodificação no cliente antes do PUT (minimização, melhor esforço); (2) tarefa no servidor após a confirmação: decodificar e **recodificar** a imagem (remove EXIF, neutraliza polyglot e acaba com FD6 e FD9) gravando em chave nova; (3) texto na tela 08. Até (2) existir, o PO assina o risco | Arquiteto + PO |
| FD6 | M | **Origem do bucket e cabeçalhos de servir não estão definidos.** O contrato mostra o `/s3` do Vite na **mesma origem do app** em dev; em produção não exige domínio sem cookies nem `nosniff`; a URL de leitura não força `Content-Type`, `Content-Disposition` nem `Cache-Control`. R-M3-2 aceita o polyglot sem essas condições | ADR D3, R-M3-2; contrato 6; `frontend/csp.ts` | Em produção: domínio do bucket **fora** do domínio do app (ou ao menos sem cookies de sessão), `X-Content-Type-Options: nosniff` na borda, `assinarLeitura` com `ResponseContentType` fixo (`image/jpeg`/`image/png`), `ResponseContentDisposition: inline; filename="foto"` e `ResponseCacheControl: private`. Em dev, aceitar (token não deve estar em `localStorage`; ver M1) e registrar | Arquiteto + DevOps |
| FD7 | B | **Ambiguidade entre ADR e contrato sobre tipo declarado × detectado.** ADR D2: "O `Content-Type` do objeto é o declarado; o `Foto.tipo` é o detectado". Contrato 5.5: tipo real diferente → `ARQUIVO_INVALIDO` | ADR D2 (penúltimo parágrafo) × contrato 3.3 e 4 | Regra única: **declarado ≠ detectado ⇒ `422 ARQUIVO_INVALIDO`** e apagar (só se a chave for sem `Foto`, FD2) | Arquiteto |
| FD8 | M | **URL de leitura de 1 h, sem revogação, também em `details` do 409.** Ex-membro e LEITOR removido mantêm acesso por até 1 h; o corpo de erro `PRODUTO_DUPLICADO` entra em log de erro com a URL | Contrato 3.4 e 5.6; ADR D5, R-M3-3 | TTL de leitura de 10 a 15 min (custa só um refetch); redigir `X-Amz-Signature` no logger e na ferramenta de erros; `Referrer-Policy: same-origin` (ou `no-referrer`) no front; não incluir URL em `details` de erro (a tela 09 pode pedir a capa pelo detalhe do produto) | Arquiteto |
| FD9 | M | **Validação de entrada incompleta no contrato.** (a) número JSON aceito em `preco`; (b) `dataCompra` sem piso; (c) `pagina` sem teto; (d) sem limite de **dimensões** da imagem; (e) sem regra de coerção (`z.coerce` aceitaria `""`, `null`, `true`) | Contrato 1, 3.5, 3.9; ADR D2 | (a) só string, ou número com checagem do texto original; (b) piso 1900-01-01; (c) `pagina` ≤ 10 000; (d) ler IHDR/SOF e recusar acima de 8000 px por lado ou 40 Mpx (`ARQUIVO_INVALIDO`); (e) estrito, sem `coerce` em corpo | Arquiteto |
| FD10 | B | **`chaveEhDaCasa` aceita `[0-9a-f-]{36}`** (qualquer arranjo de 36 caracteres hexadecimais e hífens, não só UUID v4); `casaId` sequencial na chave expõe o número de Casas | `backend/src/lib/s3.ts` linha 58; ADR D5 | Regex de UUID v4 (`[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}`); opcional: prefixo por hash da Casa | Back-end |
| FD11 | M | **`Foto` não registra quem enviou.** Impede atender pedido de titular, investigar abuso e atribuir custo | Schema do ADR D1 | `enviadoPorId` com `SetNull` (ex-membro), ou evento `FOTO_ENVIADA` na auditoria (sem a chave) | Arquiteto + PO |
| FD12 | M | **A proteção contra XSS descrita está na camada errada.** O contrato proíbe `<` e `>` na entrada (some inclusive de nomes legítimos, ex.: "Cabo > 2 m") e nada fala da saída | Contrato 1 (nome, descrição), 3.2 (tag) | Acrescentar ao contrato/ADR: texto do usuário **sempre** renderizado como texto (sem HTML bruto, sem `href`/`src` montados com dado), CSP mantida, ESLint `react/no-danger`; avaliar liberar `<` e `>` na entrada, mantendo a regra de saída; exportação CSV (M4) neutraliza prefixos `=`, `+`, `-`, `@` | Arquiteto + Front-end |
| FD13 | B | **Sem normalização Unicode em `nome` e `tag`.** `Cf` (U+202E, U+200B, U+FEFF) e NBSP passam; NFC × NFD e espaços duplos burlam a duplicidade (decisão consciente do PO de não normalizar acentos, mas não de aceitar variantes invisíveis) | Contrato 1 (duplicidade); histórias 3.1.4 e 5.1 | NFC, `trim`, espaços Unicode → espaço, colapsar espaços internos, recusar `Cc` e `Cf` (exceto U+200D e U+FE0F em emoji). Mantém "sem normalizar acentos" (`Cafe` ≠ `Café`) | Arquiteto |
| FD14 | B | **Janela de 2 h igual ao limite da rotina.** A confirmação aceita até o mesmo instante em que a rotina apaga (U11) | ADR D6; contrato 3.3 (`confirmarAte` = 2 h) | `confirmarAte` = 1 h 45 min; a rotina apaga só depois de 2 h | Arquiteto |
| FD15 | B | **Retenção do histórico e dos logs indefinida.** Texto de descrição e nome de produto ficam no `log_auditoria` mesmo depois da exclusão da Casa | ADR D4 ("a exclusão não apaga os logs") | Prazo de retenção e anonimização na exclusão da Casa (seção 5, L5) | PO + Arquiteto |
| FD16 | B | **Índice de duplicidade e a expressão `lower(trim(nome))`.** O contrato descreve `lower(trim(nome))`; o índice cobre `lower(nome)` | Contrato 1; ADR D1 | Descrever e implementar como `lower(nome) = lower(<nome aparado>)` | Arquiteto |

---

## 7. Checklist de revisão do código e dos testes do M3

Marque no PR. "Como verificar" é o comando, teste ou arquivo que comprova. Os comandos de Docker pressupõem `export PATH="/usr/local/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"`.

### 7.1 Autorização e isolamento (RNF31, J1)

- [x] Toda rota de `produtos.routes.ts` e `tags.routes.ts` passa por `autenticar`; as 7 de escrita (`POST /tags`, `upload-url`, `POST/PATCH/DELETE /produtos`) também por `autorizar(ADMIN_OU_EDITOR)`. *Como verificar:* ler os dois arquivos de rotas; `testarMatrizDePapeis` cobre as 9 rotas (ADMIN, EDITOR, LEITOR, sem token, token expirado).
- [x] LEITOR recebe `403 SEM_PERMISSAO` em **todas** as escritas, inclusive `upload-url`, e `200` nos três `GET`. *Verificar:* teste da matriz.
- [x] Nenhum `findUnique({ where: { id } })` sem `casaId`; `update`/`delete` usam `updateMany`/`deleteMany` ou `where` composto com `casaId`. *Verificar:* `grep -rn "where: { id" backend/src/modules/produtos backend/src/modules/tags` e revisão manual.
- [x] O `casaId` e o autor vêm de `req.usuario`, nunca do corpo. Corpo com `casaId`, `adicionadoPorId`, `dataCompra` futura de outra fonte etc. é ignorado. *Verificar:* teste que envia esses campos e confere o valor gravado; ausência de `...req.body` (grep).
- [x] IDOR com recurso de **outra Casa** em: `GET/PATCH/DELETE /produtos/:id`, `GET /produtos/:id/historico` (404); `tagIds` (422, mesma mensagem de id inexistente); `fotos.N.id` (422 igual ao inexistente); `tagId` na lista (200 vazio); `duplicadoId` (comporta-se como "sumiu"); `chave` (422 `ARQUIVO_INVALIDO` igual a "objeto ausente"). *Verificar:* um teste por item, com duas Casas.
- [x] A soma (`SOMAR`) atualiza `WHERE id = $1 AND casa_id = $2 AND quantidade + $3 <= 1000000`. *Verificar:* ler a consulta; teste com `duplicadoId` de produto de outra Casa.
- [x] Papel e Casa relidos do banco por requisição (rebaixar um EDITOR para LEITOR bloqueia o próximo `PATCH` com o mesmo token). *Verificar:* teste.

### 7.2 Upload e fotos

- [ ] `tipoPorMime` aceita só `image/jpeg` e `image/png`; `image/svg+xml`, `text/html`, `image/gif`, `image/webp`, `application/octet-stream`, `IMAGE/PNG ` e `image/png; charset=x` → `422 ARQUIVO_INVALIDO`. *Verificar:* teste do `upload-url` com cada valor.
- [ ] `tamanhoBytes`: `0`, `-1`, `5242881`, `1.5`, `"100"`, `null`, `1e9`, `NaN`: 422 (`ARQUIVO_INVALIDO` ou `DADOS_INVALIDOS`, conforme o contrato). Limite exato `5242880` aceito. *Verificar:* teste.
- [x] Confirmação confere pelos **bytes**: arquivo `.png` com conteúdo HTML, SVG, GIF ou texto é recusado e o objeto apagado; JPEG com `Content-Type` declarado PNG é recusado (FD7). *Verificar:* teste que envia o objeto direto ao S3 (`enviarObjetoDeTeste`) com cada corpo e chama `POST /produtos`.
- [x] **FD1 fechado** (reteste real em 2026-11-15, seção 10.1): depois da confirmação a chave servida nunca teve URL de escrita (cópia para chave definitiva), ou a regravação é bloqueada. *Verificar:* teste "confirmar e fazer um segundo PUT com a mesma URL" não altera a imagem servida nem o tamanho gravado.
- [x] **FD2 fechado:** chave de foto já gravada em `SOMAR` ou em cadastro inválido **não** é apagada do S3; `P2002` em `foto.chave` → 422, não 500. *Verificar:* dois testes (sequencial e concorrente com `Promise.all`).
- [x] Objeto no S3 ausente, vazio, de 5 MB + 1, de outra Casa, com `..`, com extensão diferente, fora do formato UUID: `422 ARQUIVO_INVALIDO` com a mesma mensagem. *Verificar:* teste parametrizado.
- [x] No máximo 3 fotos no resultado final (`LIMITE_FOTOS`), contando as `{id}` mantidas e as `{chave}` novas; mesma `chave` duas vezes no mesmo corpo é recusada. *Verificar:* teste.
- [x] Cota: duas confirmações simultâneas na mesma Casa com uma vaga só → uma `409 COTA_EXCEDIDA`, nenhuma estoura o limite (`Promise.all`); `PATCH` troca foto de 5 MB por foto de 1 MB (saldo negativo) com Casa já acima do limite passa; saldo positivo bloqueia. *Verificar:* testes de corrida e de saldo líquido.
- [x] `tamanhoBytes` gravado em `Foto` é o do **HEAD**, não o declarado. *Verificar:* teste que declara 1 000 e envia 2 000 (se o S3 aceitar) e confere.
- [x] Dimensões (código lido: `lib/imagem.ts`, `limitInputPixels` + lado 8000; não executei fixture forjada): PNG/JPEG com lado > 8000 px ou > 40 Mpx recusado (FD9). *Verificar:* fixture com IHDR forjado.
- [x] (código lido e leitura real: `Content-Type: image/jpeg`, `Content-Disposition: inline`, `Cache-Control: private, max-age=900`; falta `nosniff` na borda, é de produção) `assinarEnvio` assina `content-type` e `content-length`; `assinarLeitura` fixa `ResponseContentType`, `ResponseContentDisposition` e `ResponseCacheControl` (FD6). *Verificar:* ler `lib/s3.ts` e inspecionar a URL gerada (`X-Amz-SignedHeaders`, `response-content-type=`).
- [x] Respostas com URL assinada saem com `Cache-Control: no-store`, **inclusive** o 409 `PRODUTO_DUPLICADO` e o 201 de `POST /produtos`. *Verificar:* teste de cabeçalho em cada rota que devolve URL.
- [x] A URL assinada e a assinatura (`X-Amz-Signature`, `X-Amz-Credential`) **não aparecem** em log, em `detalhes` de auditoria nem em mensagem de erro. *Verificar:* `grep -rn "console\.\|logger\." backend/src/modules/produtos backend/src/lib/s3.ts`; teste que captura o logger durante um 409 e procura `X-Amz-`.
- [ ] Rate limits: `upload-url` e `POST /tags` 30/min por usuário; `POST/PATCH/DELETE /produtos` 60/min; `GET /produtos` com `busca` com limite próprio (FD4); o 31º `upload-url` do mesmo usuário recebe 429, e outro usuário da mesma Casa não é afetado (ou é, conforme decisão). *Verificar:* teste com 31 chamadas.
- [ ] Teto de **pendentes** por usuário/Casa (FD3), se aceito pelo Arquiteto. *Verificar:* teste.
- [ ] `limparFotosOrfas`: apaga objeto > 2 h sem `Foto`; **não** apaga objeto novo, nem objeto com `Foto`; varre todas as Casas (cria 11 000 objetos fictícios na Casa 1 e um órfão na Casa 2: o da Casa 2 é recolhido) (FD3); idempotente; falha num lote não impede os outros; confere `Foto` imediatamente antes de apagar. *Verificar:* testes do job com `limparObjetosDeTeste`.
- [ ] Exclusão de produto: grava, depois apaga do S3 sem lançar; se o S3 falhar, `204` mesmo assim e o job recolhe. *Verificar:* teste que força falha no `apagarObjetos`.
- [ ] Exclusão da Casa chama `apagarPrefixo`; objetos que falharem são recolhidos pelo job. *Verificar:* teste "excluir Casa → `listarObjetos('casas/<id>/')` vazio" no S3 local.
- [x] EXIF (FD5 fechado, seção 10.1): foto com GPS é servida **sem** GPS (FD5), ou o risco está assinado pelo PO. *Verificar:* fixture JPEG com EXIF GPS; baixar a URL de leitura e procurar `GPS` (`exiftool` ou busca do marcador APP1/`Exif`).

### 7.3 Produtos, tags, busca e histórico

- [ ] Zod **estrito** em todo corpo e query: sem `z.coerce` nos campos do corpo; campos desconhecidos descartados; `quantidade` `0`, `-1`, `1000001`, `1.5`, `"5"`, `true`, `null`, `[]`; `preco` `"-1"`, `"1e3"`, `" 1"`, `"1,5"`, `"10000000000.00"`, `"1.234"`, `""`, `1.005`; `dataCompra` `"2026-02-30"`, `"2999-01-01"`, `"0001-01-01"`, `"2026-3-5"` → 422. *Verificar:* testes de limite de cada campo (valor de borda aceito e valor seguinte recusado).
- [ ] `nome` e `tag`: 120/40 caracteres exatos aceitos; +1 recusado; contagem por **caracteres** (emoji com 2 unidades UTF-16), não por `.length` ingênuo (ou aceitar a diferença documentada); NUL e controles recusados (sem 500); `Cf` (U+202E, U+200B, U+FEFF) recusado; NFD normalizado para NFC. *Verificar:* testes com esses caracteres.
- [ ] Duplicidade: `"Café"`, `"café "`, `"CAFÉ"` colidem; NFD e NBSP colidem após normalização (FD13); `"Cafe"` **não** colide com `"Café"` (decisão do PO); a consulta usa `lower(nome) = lower($1)` e o índice (`EXPLAIN` mostra `produto_casa_id_lower_nome_idx`). *Verificar:* teste e `EXPLAIN` no Postgres do compose.
- [ ] Tag: criar `"Cozinha"` e `"cozinha"` → 409 `TAG_EXISTENTE` com `existente`; duas criações simultâneas (`Promise.all`) → uma 201 e uma 409 (nunca 500); caso `İ`/`ß` tratado pelo banco (P12). *Verificar:* testes.
- [ ] Busca: `busca=%` e `busca=_` e `busca=\` devolvem só nomes que contêm esse caractere (não a lista toda); aspas e `'; DROP TABLE produto; --` apenas não encontram nada; `ordem=nome; DROP` → 422. Sem `$queryRawUnsafe` e sem interpolação de string em SQL. *Verificar:* `grep -rn "queryRawUnsafe\|executeRawUnsafe\|\\$\\{" backend/src/modules/produtos`; testes.
- [ ] Paginação: `pagina=0`, `-1`, `2147483648`, `abc`, `limite=0`, `101` → 422; `pagina` acima de 10 000 → 422 (FD9); página além do fim → 200 vazio. *Verificar:* testes.
- [ ] `PATCH` sem mudança real: `200`, sem `atualizadoEm`, sem `log_auditoria`; com mudança: um evento `ALTERADO` na mesma transação (forçar falha após o `update` e conferir que não ficou log órfão). *Verificar:* testes.
- [ ] `SOMAR` repetido 2 vezes em paralelo soma as duas; soma que passa de 1 000 000 → 422 e nada muda. *Verificar:* testes.
- [ ] Histórico: sem e-mail, sem chave/URL de foto; `descricao` truncada (FD4); outra Casa → 404; autor ex-membro → `null`. *Verificar:* teste do `detalhes` e do formato de resposta.
- [ ] Auditoria: `PRODUTO_CRIADO`, `PRODUTO_ALTERADO`, `PRODUTO_QUANTIDADE_SOMADA`, `PRODUTO_EXCLUIDO`, `TAG_CRIADA` gravadas com `casaId` e `usuarioId` e sem dado desnecessário. *Verificar:* teste que lista `log_auditoria` após cada operação.
- [ ] `GET /tags`: só da Casa do token; teto de tags por Casa (FD4); `quantidadeProdutos` calculada com `casa_id` no `JOIN` (uma tag de outra Casa nunca soma). *Verificar:* teste.
- [ ] Erros no formato `{ error, message, details? }`, sem stack trace nem SQL; `details` do 409 só traz dados da própria Casa. *Verificar:* teste que força erro de banco e confere a resposta.

### 7.4 Front-end

- [x] Nenhum `dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML`, `document.write` nem `eval` nos componentes do M3. *Verificar:* `grep -rnE "dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|document\.write|eval\(" frontend/src`; regra `react/no-danger` no ESLint.
- [x] Nome, descrição, tag, autor e os textos `de`/`para` do histórico renderizados como texto; `href` e `src` nunca montados com dado do usuário (exceto a URL de foto que veio da API). *Verificar:* revisão dos componentes das telas 05, 06, 07, 08, 09, 17, 23; teste de componente com `<img src=x onerror=alert(1)>` como nome.
- [x] `urlDoS3` só reescreve a origem quando `VITE_S3_PROXY` existe e **só** para URLs que vieram da API; nunca para valor digitado. *Verificar:* ler `src/lib/s3.ts`.
- [x] URLs assinadas não vão para `localStorage`, `sessionStorage`, nem `console`; `staleTime` ≤ 30 min (≤ metade do TTL se o TTL cair, FD8); ao receber 403 na imagem, refaz a consulta. *Verificar:* `grep -rn "localStorage\|console\." frontend/src`.
- [ ] Antes do PUT, o front confere tipo e tamanho e **recodifica** a imagem removendo EXIF (se FD5 adotado); aviso de privacidade visível na tela 08. *Verificar:* teste de componente e revisão da tela.
- [x] CSP de produção libera o domínio do bucket **somente** em `connect-src` e `img-src` (não em `script-src`, `default-src` nem `frame-src`); `object-src 'none'` mantido. *Verificar:* ler `frontend/csp.ts` e o cabeçalho do build de produção.
- [ ] `Referrer-Policy` definido. *Verificar:* cabeçalho do HTML servido.
- [ ] Aviso da 3.5 aparece antes de confirmar "Sair da Casa". *Verificar:* teste e2e.

### 7.5 Infraestrutura e configuração (DevOps)

- [x] Bucket **sem acesso público** e sem listagem anônima; GET sem assinatura → 403. *Verificar:* `curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/s3/keepit-fotos/` e GET de objeto sem assinatura (esperado 403); em produção, painel do R2.
- [ ] CORS de produção com **uma** origem (a do front), `GET, PUT, HEAD`, `content-type`; sem `*`. *Verificar:* ler o `cors.json` de produção e fazer um pré-voo (`OPTIONS`) com `Origin` de terceiro (esperado sem `Access-Control-Allow-Origin`).
- [ ] R2 respeita `Content-Length` e `Content-Type` assinados (R-M3-1): `PUT` com corpo maior e com tipo diferente → 403. *Verificar:* os mesmos testes da tabela do ADR D3, contra o R2 de homologação.
- [ ] Chave de acesso do S3 limitada ao bucket; segredos fora do repositório; porta 9000 do SeaweedFS publicada só em `127.0.0.1` em dev. *Verificar:* `docker-compose.yml` (`ports: "127.0.0.1:9000:9000"`); `grep -rn "S3_SECRET" --include="*" . | grep -v ".env.example"`.
- [ ] Criptografia em repouso e **sem versionamento** (ou com expiração das versões antigas, para cumprir RNF16); regra de ciclo de vida do prefixo de envio pendente (FD1/FD3). *Verificar:* configuração do bucket.
- [ ] Domínio do bucket em produção separado do domínio do app e sem cookies; `nosniff` na borda (FD6). *Verificar:* `curl -sI <url assinada>`: `Content-Type: image/*`, `X-Content-Type-Options: nosniff`, `Cache-Control: private`.
- [ ] `VITE_S3_PROXY` e `VITE_S3_PROXY_TARGET` ausentes do build de produção. *Verificar:* `grep -rn "keepit-fotos\|/s3" frontend/dist` após o build de produção (esperado vazio).
- [ ] `JOBS_TOKEN` forte e a rotina horária monitorada (alerta se > 2 h sem rodar). *Verificar:* configuração do agendador; herda ACH-02 e FP10 do M5/M2.
- [ ] Logs do proxy/CDN não registram a query string das URLs assinadas. *Verificar:* configuração de logs.

### 7.6 LGPD

- [ ] Retenção e anonimização do `log_auditoria` definidas (FD15); logs de produto da Casa excluída tratados. *Verificar:* documento do PO e teste de exclusão de Casa.
- [ ] Política de privacidade (RF30) cita fotos, EXIF, permanência dos produtos na Casa quando o membro sai (R-M2-1) e o operador do bucket. *Verificar:* texto publicado.
- [ ] Exclusão de conta de ADMIN solo remove o prefixo da Casa em até 24 h. *Verificar:* teste de ponta a ponta com o job.

### 7.7 OWASP Top 10 (marcar no PR)

- [x] A01 Controle de acesso (7.1) · [ ] A02 Criptografia (URLs assinadas, TLS, repouso) · [ ] A03 Injeção (busca, ordem, XSS) · [ ] A04 Design inseguro (FD1 a FD16) · [ ] A05 Configuração (CORS, bucket, CSP, cabeçalhos) · [ ] A06 Componentes vulneráveis: `docker compose exec -T backend npm audit --omit=dev` e `docker compose exec -T frontend npm audit --omit=dev`, atenção especial à biblioteca de imagem, se houver · [x] A07 Autenticação (herdada) · [ ] A08 Integridade (FD1: objeto regravado) · [ ] A09 Logs (sem URL assinada, sem texto livre desnecessário) · [x] A10 SSRF (nenhuma URL vinda do usuário é buscada pelo servidor; só chaves geradas pelo servidor).

### 7.8 Dependências novas

- [ ] Qualquer biblioteca nova de imagem (leitura de dimensões, remoção de EXIF) é instalada só via `docker compose exec -T backend npm install <pkg>`, sem script de pós-instalação nativo não revisado, e passa por `npm audit`.

---

## 8. Riscos aceitos até decisão formal

| # | Risco | Motivo | Condição |
|---|---|---|---|
| RA1 | Homóglifos (cirílico `а` × latino `a`) burlam a duplicidade | Duplicidade é ajuda de UX, não controle de segurança | Aceite do PO |
| RA2 | Dois cadastros simultâneos do mesmo nome passam pela checagem | O índice de nome não é único porque "Cadastrar mesmo assim" é regra de negócio | Aceite do PO |
| RA3 | URL de leitura vale até o TTL e é compartilhável nesse período | Única forma de exibir sem proxy | Aceitável se o TTL cair para 10 a 15 min e o log for redigido (FD8) |
| RA4 | EXIF servido até a recodificação existir | Backlog (FD5) | **Só com assinatura do PO** e aviso na tela 08 |
| RA5 | `/s3` do Vite na mesma origem do app em dev | Só desenvolvimento e e2e | Token fora de `localStorage`; nunca em produção |
| RA6 | `adicionadoPor.id` sequencial visível | Herdado de FP6 (M5/M2) | Decisão do PO sobre expor só o nome |

## 9. Top 10 riscos (ordem de prioridade)

1. **U5/FD1 [BLOQUEANTE]:** a URL de envio de 5 min é repetível; depois de conferida, a foto pode ser trocada (outro conteúdo e, no R2 sem `Content-Length` imposto, outro tamanho). Quebra a confirmação de tipo e tamanho e a cota.
2. **U7/FD2 [BLOQUEANTE]:** a API apaga do S3 "objetos inválidos ou descartados" sem exigir que a chave seja só dela; um EDITOR destrói foto válida de outro produto (via `SOMAR` ou cadastro inválido) e deixa `Foto` sem objeto, com cota ocupada. `P2002` vira 500.
3. **U9, U10/FD3:** a limpeza de órfãos (500 por hora, 10 000 chaves lexicográficas) não acompanha 1 800 objetos/h por usuário e nunca alcança Casas de id alto: custo de bucket, cota "pendente" inexistente e RNF16 (apagar Casa em 24 h) em risco.
4. **U12/FD5 (LGPD):** EXIF com GPS preservado e servido a todos os membros e a quem tiver a URL; só no backlog.
5. **U13/FD8:** URL de leitura de 1 h sem revogação, também no corpo do 409 e em logs; ex-membro mantém acesso.
6. **U2, U3/FD6:** polyglot passa na checagem de 16 bytes; servir sem `nosniff`, sem `Content-Disposition` e (em dev) na mesma origem do app; produção sem domínio separado definido.
7. **P13/FD4:** sem tetos de tags, produtos e histórico; `GET /tags` sem paginação; busca "contém" sem índice sob limite global; `descricao` duplicada no log.
8. **P6, U16/FD9:** validação de entrada incompleta (número JSON em `preco`, `dataCompra` sem piso, `pagina` sem teto → 500, sem limite de dimensões da imagem).
9. **P8/FD12:** o contrato confia em lista negra de `<` e `>` na entrada; a proteção contra XSS precisa ser a saída escapada, com regras de lint e teste.
10. **P9, P10, P12/FD13:** caracteres de formato e Unicode em `nome` e `tag` (spoofing, duplicidade, 500 do índice de tag, NUL).

Menores a acompanhar: FD7 (tipo declarado × detectado), FD10 (regex da chave), FD11 (autor da foto), FD14 (janela de 2 h), FD15 e FD16.


---

## 10. Resultado da revisão de código (AppSec, Sprint 3)

Revisão de `backend/src/modules/produtos`, `tags`, `lib/s3.ts`, `lib/tipo-imagem.ts`, `jobs`, migrations e `frontend/src/features/produtos`. Testes reais contra o SeaweedFS (via `frontend:5173/s3`) com o usuário demo. **Veredito: REPROVADO** (1 alta confirmada em exploração real, mais 1 alta de LGPD sem assinatura do PO). **Atualização (Sprint 4): as duas altas (A1/FD1 e A2/FD5) foram reexecutadas e estão FECHADAS; ver 10.1.**

### Provas executadas

| Teste | Resultado |
|---|---|
| Corpo HTML enviado como `image/png` e `POST /produtos` com a chave | PUT 200 (o S3 não olha os bytes), API: **422 ARQUIVO_INVALIDO** (bom) |
| PUT com corpo maior que o `tamanhoBytes` assinado | 403 (bom) |
| PUT com `Content-Type` diferente do assinado | 403 (bom) |
| PUT válido, produto criado (201), **segundo PUT na mesma URL com outros bytes do mesmo tamanho** | **200; a URL de leitura passou a servir os bytes novos** (FD1 CONFIRMADO) |
| `SOMAR` com a chave de uma foto já gravada | 200 e a foto continua no S3 (FD2 fechado) |
| Chave de outra Casa, com `..` e fora do formato | 422 ARQUIVO_INVALIDO |
| GET sem assinatura, GET direto em `:9000`, listagem anônima do bucket | 403 nos três |
| Leitura assinada | `Content-Type: image/png`, **sem** `nosniff`, `Content-Disposition` e `Cache-Control`; TTL 3600 s |
| `GET /produtos?busca=%00` | **500** |
| `preco` número JSON, `dataCompra` `0001-01-01`, nome com U+202E/U+200B | aceitos (201) |
| `npm audit --omit=dev` | frontend: 0; backend: 3 altas (`deepmerge-ts` via `prisma`, ferramenta de CLI, sem entrada de usuário) |

### Achados que reprovam

- **A1 (alta, A08/A04, FD1):** objeto regravável depois da confirmação. Correção: chave de envio separada da chave servida (`CopyObject` na confirmação) ou `ResponseContentType` fixo mais cabeçalhos seguros na leitura, e recodificar a imagem.
- **A2 (alta, LGPD, FD5):** EXIF/GPS é preservado e servido. Sem recodificação e sem aviso na tela 08. Requer correção ou aceite formal do PO (RA4).

### Demais achados (não bloqueiam): FD3 (sem teto de pendentes por usuário), FD4, FD6, FD8, FD9, FD12, FD13, FD14 a FD16 seguem como no item 6. Novos: `busca` com NUL dá 500; portas 5432 e 9000 publicadas em todas as interfaces no `docker-compose.yml`; CSP sem `blob:` em `img-src` (a prévia da foto, `URL.createObjectURL`, será bloqueada em produção); sem `Referrer-Policy`; sem regra ESLint `react/no-danger` (hoje não há uso); `tipoPorMime` aceita `"IMAGE/PNG "` (inofensivo, o tipo assinado é normalizado).

### 10.1 Reteste formal de FD1 e FD5 (AppSec, Sprint 4, 2026-11-15)

**Veredito da parte A: FD1 FECHADO e FD5 FECHADO.** Reteste executado contra o SeaweedFS real (API em `localhost:3333`, S3 em `s3:9000`, usuário demo, produtos de teste excluídos ao final). Scripts descartáveis ficaram fora do repositório.

| Ataque repetido | Resultado |
|---|---|
| `upload-url` (JPEG, 626 B): a `chave` devolvida agora é `casas/1/pendentes/<uuid>.jpg` | OK: área de escrita separada da servida |
| PUT 1 com JPEG que tem EXIF (GPS -23,53/-46,63 e `Make`), `POST /produtos` com a chave | PUT 200, `201 CRIADO` |
| URL de leitura do produto | aponta para `casas/1/fotos/...` (nunca `pendentes/`); `Content-Type: image/jpeg`, `Content-Disposition: inline`, `Cache-Control: private, max-age=900` (TTL de 15 min, antes 1 h) |
| **FD1:** PUT 2 na MESMA URL assinada depois da confirmação (azul, mesmos 626 bytes e mesmo `Content-Type`) | PUT 200 (grava só em `pendentes/`), mas a leitura seguinte devolve os **mesmos 294 bytes**, idênticos byte a byte aos de antes, pixel `[254,0,0]` (vermelho). A imagem servida não mudou |
| Reuso da `chave` de envio em outro produto | `422 ARQUIVO_INVALIDO` |
| **FD5:** arquivo original com marcadores `Exif`, `GPS` e `ApareloSecreto` (626 B); arquivo servido (294 B) | nenhum desses marcadores no servido; `sharp().metadata().exif` vazio. Recodificação feita por `lib/imagem.ts` (sem `withMetadata`) |
| Corrida: mesma chave pendente em dois `POST /produtos` simultâneos, com regravação no meio (5 tentativas, imagem pequena x imagem grande de mesmo tamanho de bytes) para divergir o tamanho gravado do servido | 1 x 201 e 1 x 422 em todas; tamanho gravado = tamanho servido em todas. Não consegui reproduzir o desvio de cota (hipótese teórica, sem prova) |

Resíduo aceitável: o segundo PUT recria um objeto em `pendentes/` que nunca é servido; é órfão e a rotina de conciliação o recolhe em 2 h. FD2, FD3 (teto de pendentes 10 por usuário e 30 por Casa, no contrato) e FD8 (TTL 15 min) também aparecem endereçados no contrato e no código; não os reexecutei nesta rodada. Ainda abertos e fora do escopo do reteste: `nosniff`/domínio separado do bucket em produção (FD6), aviso de privacidade na tela 08, retenção do `log_auditoria` (FD15).
