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
- O frontend usa `VITE_API_URL` (padrão `http://localhost:3333`).

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
| Depois de um `git pull` que mudou dependências | `make deps` |
| Depois de um `git pull` que trouxe migrations | `make migrate-deploy` |
| Criar uma migration após editar `schema.prisma` | `docker compose exec -T backend npx prisma migrate dev --name <nome_curto>` |
| Adicionar dependência no backend | `docker compose exec -T backend npm install <pacote>` (use `-D` para dev) |
| Adicionar dependência no frontend | `docker compose exec -T frontend npm install <pacote>` |
| Abrir um shell no container | `make sh-back` / `make sh-front` |
| Interface do banco (Prisma Studio) | `make studio` (abre na porta 5555 dentro do container) |
| Recomeçar do zero (**apaga dados**) | `make reset` e depois `make setup` |

Depois de adicionar uma dependência, faça commit do `package.json` **e** do `package-lock.json` juntos e confirme que `docker compose build` ainda passa.

---

## 7. Solução de problemas

| Sintoma | Causa | Solução |
|---|---|---|
| `docker: command not found` ou `No such file or directory` no `make` | Docker não instalado ou fora do `PATH` | Instale (seção 2). No macOS, exporte o `PATH` indicado na seção 2 |
| `Cannot connect to the Docker daemon` | Daemon não iniciado | Abra o Docker Desktop/OrbStack (ou `sudo systemctl start docker`) e espere com o loop `until docker info …` |
| Build falha com `npm ci can only install packages when your package.json and package-lock.json … are in sync` | Lockfile desatualizado em relação ao `package.json` | Regere dentro do container: `docker compose run --rm --no-deps <servico> npm install`, confira o diff do lockfile, faça commit e rode `docker compose build` de novo |
| `pull access denied for minio/minio` | A MinIO deixou de publicar imagens públicas | O projeto já usa SeaweedFS. Se você vir isso, está com um `docker-compose.yml` antigo: atualize o repositório |
| `Bind for 0.0.0.0:5432 failed: port is already allocated` (ou 3333, 5173, 9000, 8025) | Outro processo usa a porta (ex.: um PostgreSQL local) | Pare o processo (`lsof -i :5432`) ou mude só a porta do lado do host no `docker-compose.yml` (ex.: `"5433:5432"`) |
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
