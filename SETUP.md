# KeepIT — Guia de configuração do ambiente (para agentes de código)

Este guia ensina um agente de código (ou uma pessoa) a configurar e verificar o ambiente do KeepIT em **qualquer máquina** (macOS, Linux ou Windows com WSL2).
Siga as seções na ordem. Cada passo tem um **comando de verificação** e o **resultado esperado**. Não avance se a verificação falhar: vá para a seção [Solução de problemas](#7-solução-de-problemas).

> Leia também o [AGENTS.md](AGENTS.md), que define os papéis da equipe e as regras de código.

---

## 1. Princípios (leia antes de executar qualquer coisa)

1. **Tudo roda em Docker.** Node, npm, PostgreSQL, S3 e e-mail rodam em containers. **Não instale Node nem dependências npm no host.** O host precisa apenas de Docker, Make e Git.
2. **Os `package-lock.json` são a fonte da verdade das versões.** As imagens usam `npm ci`, que falha se `package.json` e `package-lock.json` estiverem fora de sincronia.
3. **Para adicionar ou remover dependência, faça dentro do container** (ver a [seção 6](#6-tarefas-do-dia-a-dia)). Assim o lockfile é atualizado no host pelo bind mount e continua consistente.
4. **Não faça commit do `.env`.** Ele é criado a partir do `.env.example`.
5. **Comandos não interativos:** agentes devem usar `docker compose exec -T` (com `-T`) e `prisma migrate deploy` em vez de `migrate dev`, que pede confirmação no terminal.

---

## 2. Pré-requisitos do host

| Ferramenta | Versão mínima | Verificação | Esperado |
|---|---|---|---|
| Docker Engine | 24+ | `docker info --format '{{.ServerVersion}}'` | imprime uma versão (ex.: `29.9.3`) e **não** dá erro de conexão |
| Docker Compose v2 | 2.20+ | `docker compose version` | `Docker Compose version v2.x` ou superior |
| GNU Make | 3.81+ | `make --version` | imprime a versão |
| Git | 2.x | `git --version` | imprime a versão |

### Instalação do Docker por sistema

- **macOS:** `brew install --cask docker` (Docker Desktop) **ou** `brew install --cask orbstack`. A instalação pede a senha do usuário; um agente **não** deve digitá-la, mas pedir que a pessoa conclua. Depois, abra o app uma vez (`open -a Docker`) para aceitar os termos e iniciar o daemon.
- **Linux (Debian/Ubuntu):** siga https://docs.docker.com/engine/install/ e adicione o usuário ao grupo `docker` (`sudo usermod -aG docker $USER`, depois faça logout e login).
- **Windows:** instale o Docker Desktop com backend WSL2 e rode todos os comandos **dentro do WSL2**, com o repositório clonado no sistema de arquivos do Linux (ex.: `~/projetos`), não em `/mnt/c`, que é muito lento para bind mounts.

### Atenção agentes no macOS: `docker: command not found`

Logo após instalar o Docker Desktop, shells não interativos (como o de um agente) podem não ter o binário no `PATH`. Antes dos comandos, use:

```bash
export PATH="/usr/local/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"
```

O daemon também leva de 10 a 60 segundos para subir depois de `open -a Docker`. Aguarde em loop:

```bash
until docker info >/dev/null 2>&1; do sleep 3; done
```

---

## 3. Configuração em uma máquina nova

### Caminho rápido (um comando)

```bash
git clone <url-do-repositorio> keepit-app
cd keepit-app
make setup
```

`make setup` é idempotente (pode ser rodado de novo sem estragar nada). Ele:

1. cria o `.env` a partir do `.env.example` (se ainda não existir);
2. constrói as imagens `keepit-backend` e `keepit-frontend`, instalando as dependências com `npm ci`;
3. sobe todos os serviços (`docker compose up -d`);
4. sincroniza o `node_modules` dos volumes com o lockfile (`npm ci` no backend e no frontend);
5. aplica as migrations do Prisma (`prisma migrate deploy`) e gera o Prisma Client;
6. reinicia backend e frontend para carregarem tudo.

Depois, vá para a [seção 4](#4-verificação).

### Caminho manual (passo a passo, útil para depurar)

```bash
cp .env.example .env                                          # 1. variáveis de ambiente
docker compose build                                          # 2. imagens + dependências
docker compose up -d                                          # 3. sobe os serviços
docker compose exec -T backend npx prisma migrate deploy      # 4. cria as tabelas
```

Na primeira vez, o build leva de 1 a 3 minutos (download de imagens e pacotes). Os builds seguintes usam cache e levam segundos.

---

## 4. Verificação

Rode todos e compare com o esperado:

| O que verificar | Comando | Esperado |
|---|---|---|
| Containers | `docker compose ps -a --format '{{.Service}}\t{{.Status}}'` | `backend`, `frontend`, `s3` **Up**; `db` e `mailpit` **Up (healthy)**; `s3-init` **Exited (0)** (é normal: ele só cria o bucket e encerra) |
| API | `curl -s localhost:3333/health` | `{"status":"ok"}` |
| Front-end | `curl -s -o /dev/null -w '%{http_code}' localhost:5173` | `200` |
| Mailpit | `curl -s -o /dev/null -w '%{http_code}' localhost:8025` | `200` |
| Bucket S3 | `docker compose logs s3-init` | contém `keepit-fotos` |
| Tabelas | `docker compose exec -T db psql -U keepit -c '\dt'` | 12 linhas: `_prisma_migrations`, `assinatura`, `casa`, `codigo_verificacao`, `foto`, `log_auditoria`, `membro`, `plano`, `produto`, `produto_tag`, `tag`, `usuario` |
| Qualidade | `make check` | lint sem erros, typecheck sem erros, testes `passed` no backend e no frontend |

Se todos baterem, o ambiente está pronto.

---

## 5. Mapa do ambiente

### Serviços e portas

| Serviço (compose) | Imagem | Porta no host | Para quê | Equivalente em produção |
|---|---|---|---|---|
| `frontend` | build de `frontend/Dockerfile` (alvo `dev`) | 5173 | SPA React (Vite com hot reload) | Vercel |
| `backend` | build de `backend/Dockerfile` (alvo `dev`) | 3333 | API Express (`tsx watch`) | Render |
| `db` | `postgres:17-alpine` | 5432 | Banco (usuário/senha/banco: `keepit`) | Neon |
| `s3` | `chrislusf/seaweedfs:4.53` | 9000 | Object storage com API S3 (chave `keepit` / `keepit-secret`) | Cloudflare R2 |
| `s3-init` | `amazon/aws-cli:2.40.3` | — | Cria o bucket `keepit-fotos` e encerra | — |
| `mailpit` | `axllent/mailpit:v1.27` | 1025 (SMTP), 8025 (UI) | Caixa de e-mail local | Resend |

### Volumes

| Volume | Conteúdo | Observação |
|---|---|---|
| `pgdata` | dados do PostgreSQL | apagado por `make reset` |
| `s3data` | fotos enviadas | apagado por `make reset` |
| `backend_node_modules`, `frontend_node_modules` | dependências npm | **não** são atualizados automaticamente quando a imagem é reconstruída; use `make deps` |

O código (`./backend` e `./frontend`) é montado no container por bind mount: editar um arquivo no host recarrega o serviço sozinho.

### Variáveis de ambiente

- O backend lê o `.env` (`env_file`) e o `docker-compose.yml` **sobrescreve** `DATABASE_URL`, `S3_ENDPOINT`, `SMTP_HOST` e `SMTP_PORT` para apontar aos nomes dos serviços na rede do Docker (`db`, `s3`, `mailpit`).
- O backend valida as variáveis com Zod em `backend/src/config/env.ts`. Se faltar alguma, ele **não sobe** e o log mostra qual (`docker compose logs backend`).
- `PAGAMENTO_SIMULADO` (M5): `true` em dev (o compose já define), com os cartões de teste `4242 4242 4242 4242` (aprovado) e `4111 1100 0005 0000` (recusa). Em produção precisa ser `false`, ou o backend **não inicia**; sem um gateway real, contratar plano responde `503 PAGAMENTO_INDISPONIVEL`.
- `RATE_LIMIT_DESLIGADO`: `true` em dev pelo compose, porque todo o tráfego chega pelo proxy do Vite com o mesmo IP. É recusado em produção.
- O frontend usa `VITE_API_URL` (padrão `http://localhost:3333`).
- **Fotos (M3, [ADR 0003](docs/adr/0003-m3.md) D3):** a URL assinada do S3 carrega o host na assinatura. O backend assina para `s3:9000`; o front troca a origem da URL por `VITE_S3_PROXY` (`/s3` em dev) e o Vite repassa ao `s3:9000` reescrevendo o `Host` (`VITE_S3_PROXY_TARGET`). Assim o mesmo link funciona no navegador do host e no do container e2e. `S3_PUBLIC_ENDPOINT` (opcional) só muda o endereço usado para assinar (produção/R2). O CORS do bucket local vem de `infra/s3/cors.json`, aplicado pelo `s3-init`.

### Estrutura do repositório

```
keepit-app/
├── AGENTS.md            equipe de agentes e regras de código
├── SETUP.md             este guia
├── Makefile             atalhos (ver seção 6)
├── docker-compose.yml   ambiente local completo
├── .env.example         modelo de variáveis (copiar para .env)
├── infra/seaweedfs/     credenciais do S3 local
├── backend/             API (Express + Prisma) — Dockerfile com alvos dev/build/prod
│   ├── prisma/          schema.prisma e migrations
│   └── src/             app.ts, server.ts, modules/<modulo>, middlewares, jobs, lib, config
├── frontend/            SPA (React + Vite + Tailwind) — Dockerfile com alvos dev/build/prod
│   └── src/             pages, components, features/<modulo>, lib, routes.tsx
├── docs/                documentação do produto (requisitos, arquitetura, diagramas)
├── e2e/                 testes ponta a ponta (Playwright)
└── .github/workflows/   CI (lint, typecheck, testes, build) e rotinas agendadas
```

---

## 6. Tarefas do dia a dia

| Tarefa | Comando |
|---|---|
| Subir / derrubar o ambiente | `make up` / `make down` |
| Ver logs da API e do front | `make logs` |
| Rodar lint, typecheck e testes | `make check` (ou `make test`, `make lint`, `make typecheck`) |
| Popular o banco de dev (3 planos + usuário demo `demo@keepit.local`; idempotente) | `make seed` |
| Rodar os testes E2E (Playwright em container) | `make e2e` |
| Popular a Casa de carga (~2.000 produtos) e medir as estatísticas (RNF06) | `make carga` |
| Volume do ADR 0004 (10.000 produtos, 200 tags) para a medição da QA | `make seed-volume` |
| Depois de um `git pull` que mudou dependências | `make deps` |
| Depois de um `git pull` que trouxe migrations | `make migrate-deploy` |
| Criar uma migration após editar `schema.prisma` | `docker compose exec -T backend npx prisma migrate dev --name <nome_curto>` |
| Adicionar dependência no backend | `docker compose exec -T backend npm install <pacote>` (use `-D` para dev) |
| Adicionar dependência no frontend | `docker compose exec -T frontend npm install <pacote>` |
| Abrir um shell no container | `make sh-back` / `make sh-front` |
| Interface do banco (Prisma Studio) | `make studio` (abre na porta 5555 dentro do container) |
| Recomeçar do zero (**apaga dados**) | `make reset` e depois `make setup` |

### Seed e testes E2E

- `make seed` roda `npm run seed` (`prisma db seed`) no backend. É idempotente; a senha do usuário demo está em `backend/prisma/seed.ts`.
- `make e2e` sobe `db`, `backend` e `frontend` (se preciso) e roda o serviço `e2e` (profile `e2e`), que usa a imagem oficial `mcr.microsoft.com/playwright` e alcança o app pela rede do compose (`http://frontend:5173`, API em `http://backend:3333`). Relatório em `e2e/playwright-report/`, falhas em `e2e/test-results/`.
- A versão da imagem Playwright em `docker-compose.yml` deve ser **igual** à de `@playwright/test` em `e2e/package.json`. Para atualizar: altere os dois e regenere o lock com `docker run --rm -v "$PWD/e2e":/work -w /work mcr.microsoft.com/playwright:v<versão>-noble npm install --package-lock-only`.
- **Projetos Playwright:** `chromium` (desktop) roda todos os specs, exceto `*.mobile.spec.ts`; `mobile` (viewport 360x800, Pixel 7) roda **só** os `*.mobile.spec.ts`. Para um só: `docker compose --profile e2e run --rm e2e npx playwright test --project=mobile`. Para testar responsividade em um spec de fluxo, o QA cria um `<nome>.mobile.spec.ts` (ou usa `test.use({ viewport })` como no M1).
- **Helpers da Sprint 2** (`e2e/tests/helpers.ts`, montam cenários pela API): `criarUsuario`, `salvarMetodoPagamento`, `contratarPlano`, `adicionarMembro`, `montarCasa` (Casa FAMILIA com ADMIN, EDITOR e LEITOR), `dispararJobs` (POST /internal/jobs), `obterPerfil`, `bearer` e os cartões `CARTAO.aprovado` / `CARTAO.recusado` (final 0000). Cada chamada cria usuários novos (e-mails únicos); a UI só deve ser usada para o que o teste valida.
- O serviço `e2e` recebe `JOBS_TOKEN` do `.env` (o compose falha com mensagem clara se faltar). Fora do compose, exporte `JOBS_TOKEN` para usar `dispararJobs`.
- Para rodar contra outra URL: `E2E_BASE_URL=... docker compose --profile e2e run --rm e2e`.
- **Helpers da Sprint 3** (M3, `e2e/tests/helpers.ts`): `criarTag`, `criarProduto` (aceita `fotos: [FOTOS.png, ...]`, que são enviadas antes de salvar), `criarProdutos` (vários, para busca/filtro/paginação), `enviarFotoPelaApi` (URL assinada + PUT + devolve a `chave`), `urlDoS3` (mesma regra do front), `limparFotosOrfas` e as constantes `FOTOS` / `FIXTURES_DIR`. Não existe rota "confirmar foto": a confirmação acontece ao salvar o produto (`fotos: [{ chave }]`; contrato em `docs/api/m3-produtos.md`).
- **Imagens de teste** (`e2e/fixtures/`, versionadas; não precisam ser regeradas): `foto-valida.jpg`, `foto-valida.png`, `foto-maior-que-5mb.jpg` (JPEG válido com 5 MB + 1 KB), `texto.jpg` (texto com extensão .jpg) e `png-renomeado.jpg` (PNG verdadeiro com extensão .jpg: vale o tipo real, então é aceito como PNG). Para regerar, sem baixar nada (usa o Chromium da imagem do Playwright): `docker compose --profile e2e run --rm --no-deps e2e sh -c "npm ci && node fixtures/gerar.mjs"`. Em testes de UI use `page.setInputFiles('input[type=file]', FOTOS.png.arquivo)`.

### Pagamento simulado e M4 Estatísticas (Sprint 4)

- **Decisão do produto: o pagamento continua SIMULADO no MVP.** Não há gateway real. `PAGAMENTO_SIMULADO=true` em dev (o compose já define); em produção precisa ser `false` e, sem gateway real, contratar plano responde `503 PAGAMENTO_INDISPONIVEL` (ver variáveis acima). Pagamento real está no `docs/backlog.md`.
- **M4 (telas 05, 10 e 17):** `GET /estatisticas/resumo` e `GET /estatisticas`, só leitura, todos os papéis, sempre da Casa do token. Contrato em `docs/api/m4-estatisticas.md`, decisões em `docs/adr/0004-m4.md`. Sem migration e sem índice novo.
- **Dados de exemplo:** `make seed` (idempotente por produto) agora inclui produtos antigos, tag com sobreposição, produto sem tag, preço R$ 0,00 e a tag `Jardim` sem produtos, para exercitar todos os indicadores na Casa demo.
- **Carga e desempenho (RNF06):** `make carga` cria (ou reaproveita) a Casa `carga@keepit.local`, **separada da demo**, recria nela ~2.000 produtos e 200 tags (preços de 0,00 ao teto, alguns com quantidade 1.000.000, ~20% sem tag, ~20% com duas tags) e mede 5 vezes cada rota de estatísticas pela API, imprimindo mínimo, mediana e máximo (meta: menos de 500 ms por rota). Enquanto a rota não existir, a medição mostra HTTP 404. Ajustes: `make carga CARGA_PRODUTOS=5000 CARGA_TAGS=100`. `make seed-volume` é o mesmo script com 10.000 produtos e 200 tags (volume do ADR 0004, para a QA). Código: `backend/scripts/carga.ts`; usa SQL em lote, termina em segundos, não roda com `NODE_ENV=production` e **não faz parte do CI**. Para refazer a medição à mão: faça login como `carga@keepit.local` (senha em `backend/scripts/carga.ts`, só local) e use `curl -w '%{time_total}\n'`.
- **Helpers E2E do M4** (`e2e/tests/helpers.ts`): `montarCasaComProdutos` (Casa com papéis, tags e produtos conhecidos; padrão `PRODUTOS_CONHECIDOS`, ou `produtos: []` para Casa vazia), `calcularEstatisticas` (números esperados em centavos com BigInt, regras do ADR 0004, sem depender do backend) e `centavos` / `dinheiro`. A Casa devolvida traz `esperado` para comparar com a API e com a tela.

### Fotos, S3 e URLs assinadas (M3)

- **Fluxo:** o navegador pede `POST /produtos/fotos/upload-url`, recebe uma URL assinada (válida por 5 min) e faz o `PUT` do arquivo direto no S3; a foto só passa a existir ao salvar o produto (`POST`/`PATCH /produtos` com a `chave`). Leitura: URLs assinadas de 1 h; o bucket nunca é público.
- **Por que `/s3`:** a assinatura cobre o `Host`. O backend assina para `s3:9000` (nome interno); o front reescreve só a origem para `/s3` e o Vite repassa a `http://s3:9000` com `changeOrigin`, o que preserva a assinatura. Funciona igual no navegador do host (`localhost:5173/s3/...`) e no container e2e (`frontend:5173/s3/...`). Usar `localhost:9000` direto com URL assinada para `s3:9000` dá `403`.
- **CORS:** `infra/s3/cors.json` é aplicado ao bucket pelo `s3-init` (origens `localhost:5173` e `frontend:5173`; métodos GET, PUT, HEAD). Para reaplicar sem recriar: `docker compose run --rm s3-init`. Pelo proxy `/s3` o navegador usa a mesma origem, então o CORS só importa se algum cliente falar direto com a porta 9000.
- **Verificar à mão** (com uma URL de `upload-url`; troque a origem por `http://localhost:5173/s3`): `curl -X PUT -H "Content-Type: image/png" --data-binary @e2e/fixtures/foto-valida.png "<url>"` deve dar `200`; corpo de tamanho diferente do declarado, `Content-Type` diferente ou URL vencida dão `403`.
- **Limpeza de fotos órfãs:** fotos enviadas e não salvas (ou que falharam ao apagar) são apagadas pela rotina `POST /internal/jobs` (header `x-jobs-token`, valor de `JOBS_TOKEN`), que remove objetos do prefixo `casas/` sem registro de `Foto` e com mais de 2 h. Em dev rode `curl -X POST -H "x-jobs-token: $JOBS_TOKEN" http://localhost:3333/internal/jobs`; a resposta traz `fotosOrfasApagadas` (quando o backend do M3 implementar a rotina). Em produção deve rodar de hora em hora (cron do Render ou GitHub Actions). Apagar a Casa apaga o prefixo dela no S3 (LGPD).
- **Produção (R2):** não definir `VITE_S3_PROXY`; definir `S3_PUBLIC_ENDPOINT` com o domínio do bucket, aplicar o CORS de `infra/s3/cors.json` (com as origens de produção) e liberar o domínio na CSP (`connect-src` e `img-src`). Pendente de validar no R2: se o `PUT` assinado respeita o `Content-Length` (risco R-M3-1; a conferência por HEAD na confirmação cobre mesmo assim).
- O serviço `frontend` define `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=frontend` porque o Vite 6+ bloqueia Hosts desconhecidos.
- Testes do backend usam o schema `test` do mesmo PostgreSQL (migrations aplicadas pelo `global-setup`); não é preciso `make seed` para eles.

Depois de adicionar uma dependência, faça commit do `package.json` **e** do `package-lock.json` juntos e confirme que `docker compose build` ainda passa.

---

## 7. Solução de problemas

| Sintoma | Causa | Solução |
|---|---|---|
| `docker: command not found` ou `No such file or directory` no `make` | Docker não instalado ou fora do `PATH` | Instale (seção 2). No macOS, exporte o `PATH` indicado na seção 2 |
| `Cannot connect to the Docker daemon` | Daemon não iniciado | Abra o Docker Desktop/OrbStack (ou `sudo systemctl start docker`) e espere com o loop `until docker info …` |
| Build falha com `npm ci can only install packages when your package.json and package-lock.json … are in sync` | Lockfile desatualizado em relação ao `package.json` | Regere dentro do container: `docker compose run --rm --no-deps <servico> npm install`, confira o diff do lockfile, faça commit e rode `docker compose build` de novo |
| `pull access denied for minio/minio` | A MinIO deixou de publicar imagens públicas | O projeto já usa SeaweedFS. Se você vir isso, está com um `docker-compose.yml` antigo: atualize o repositório |
| `Bind for 0.0.0.0:5432 failed: port is already allocated` (ou 3333, 5173, 9000, 8025) | Outro processo usa a porta (ex.: um PostgreSQL local) | Pare o processo (`lsof -i :5432`) ou mude só a porta do lado do host no `docker-compose.yml` (ex.: `"127.0.0.1:5433:5432"`) |
| Backend reinicia em loop e o log mostra erro do Zod | Variável faltando ou inválida no `.env` | Compare o `.env` com o `.env.example`; `JWT_SECRET` e `JOBS_TOKEN` precisam de 16+ caracteres |
| `Cannot find module '@prisma/client'` ou tipos do Prisma desatualizados | Prisma Client não gerado após mudança no schema | `docker compose exec -T backend npx prisma generate` |
| Erro de módulo não encontrado logo após um `git pull` | Volume `node_modules` com dependências antigas | `make deps` |
| Migration pede confirmação e trava o agente | `migrate dev` é interativo | Use `make migrate-deploy`, ou passe `--name` para o `migrate dev` |
| `s3-init` aparece como `Exited (0)` | Comportamento esperado | Nenhuma ação: ele cria o bucket e encerra |
| Hot reload não funciona (comum no Windows e no Docker com VM) | Eventos de arquivo não chegam ao container | O Vite já usa polling (`frontend/vite.config.ts`). Para o backend, reinicie com `docker compose restart backend` |
| Tudo muito lento no Windows | Repositório em `/mnt/c` | Clone dentro do sistema de arquivos do WSL2 |
| Apple Silicon (arm64) ou x86 | — | Todas as imagens usadas são multiarquitetura; não é preciso `--platform` |

Para depurar qualquer serviço: `docker compose logs --tail=100 <servico>`.

---

## 8. Checklist final para o agente

- [ ] `docker info` funciona
- [ ] `.env` existe e **não** está no Git (`git check-ignore .env` imprime `.env`)
- [ ] `make setup` terminou sem erro
- [ ] Todas as verificações da [seção 4](#4-verificação) bateram
- [ ] `make check` passou
- [ ] Você leu o [AGENTS.md](AGENTS.md) antes de começar a codificar

## 9. Produção do M3 (DevOps)

O que ficou pronto no repositório e o que só dá para fazer no provedor (não é verificável no ambiente local).

**Pronto e testado (`e2e/tests/m3-infra-producao.spec.ts`)**
- **`nosniff` no objeto:** em dev, o proxy `/s3` do Vite força `X-Content-Type-Options: nosniff`. Em produção o cabeçalho tem de vir do domínio do bucket: no R2, regra de Transform Rules (Modify Response Header) ou Worker no domínio personalizado do bucket que defina `X-Content-Type-Options: nosniff`.
- **Cron horário:** `.github/workflows/jobs.yml` (`0 * * * *`) chama `POST /internal/jobs`, que já executa `limparFotosOrfas` (resposta com `fotosOrfasApagadas` e `fotosOrfasPendentes`). O workflow emite aviso se sobrarem órfãs pendentes. Segredos do repositório: `API_URL` e `JOBS_TOKEN`.
- **CORS de produção com uma única origem:** `ORIGEM_APP=https://app... S3_ENDPOINT=https://<conta>.r2.cloudflarestorage.com sh infra/s3/aplicar-cors-producao.sh` (modelo em `infra/s3/cors.prod.json`; recusa http, localhost e curinga; `DRY_RUN=1` só imprime).
- **R-M3-1 (Content-Length assinado):** `URL_ASSINADA=<upload-url do R2> TAMANHO=<bytes assinados> node infra/s3/validar-content-length.mjs` envia corpo maior que o assinado e diz se o R2 rejeitou. Rode uma vez contra o R2 real; no SeaweedFS local já é rejeitado (403). Se o R2 aceitar, a conferência por HEAD na API segue valendo.
- **Ciclo de vida:** `infra/s3/lifecycle.json` só aborta multipart incompleto. **Não** existe regra para `pendentes/`: o ADR 0003 não usa esse prefixo (foto pendente e gravada vivem em `casas/<casaId>/fotos/`), e expirar por idade apagaria fotos salvas. Quem limpa as pendentes é o job de órfãs.

**Pendente (fora do alcance do DevOps ou do ambiente local)**
- Aplicar CORS, `lifecycle.json` e a regra de `nosniff` no R2 de produção e definir `S3_PUBLIC_ENDPOINT` com um domínio de bucket **separado** do app (origem distinta).
- Redigir `X-Amz-Signature` nos logs do proxy/CDN de produção (configuração do provedor de logs).
- O cursor de `limparFotosOrfas` vive em memória (`backend/src/jobs/index.ts`) e recomeça do início a cada reinício. Não causa dano (a rotina é idempotente), só repete varredura; persistir é tarefa do Back-end.
- **Build do front:** `VITE_S3_PROXY` e `VITE_S3_PROXY_TARGET` não podem ir no build de produção (a URL assinada vale como veio).
- **Portas em dev:** Postgres (`5432`) e S3 (`9000`) só em `127.0.0.1`; `e2e/tests/infra-compose.spec.ts` confere.

## Auditoria de dependências (npm audit)

O backend tem 3 altas conhecidas (GHSA-ggr8-5vv4-36mx, `deepmerge-ts` via `prisma`). A CLI do Prisma só lê a config do projeto no deploy, sem entrada de usuário; o conserto exige Prisma 7 (quebra) e fica para sprint própria. O CI usa `infra/audit/auditar-prod.mjs`: tolera só esse advisory (exceção vence em 2027-03-31) e reprova qualquer outra vulnerabilidade alta ou crítica. A imagem de produção instala sem devDependencies (`npm prune --omit=dev`) e roda `npx --no-install prisma migrate deploy`, sem baixar nada em tempo de execução.
