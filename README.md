# KeepIT

Inventário doméstico compartilhado. Cada pessoa tem uma **Casa** onde cadastra seus bens (produtos com preço,
quantidade, data da compra, tags e fotos), convida membros com papéis diferentes e acompanha estatísticas do patrimônio.

Web app responsivo (SPA), pensado primeiro para o celular.

> Documentação do produto em [`docs/`](docs/) · equipe de agentes e regras de trabalho em [AGENTS.md](AGENTS.md) ·
> ambiente em outra máquina em [SETUP.md](SETUP.md) · publicação em produção em [DEPLOY.md](DEPLOY.md).

---

## Funcionalidades

| Módulo | O que faz |
|---|---|
| **M1 · Conta** | Cadastro, login, recuperação de senha por código no e-mail, troca de e-mail e senha, exclusão da conta (dados pessoais apagados em até 24 h) |
| **M2 · Casa e membros** | Casa Individual criada no cadastro, membros com papéis, troca de papel, remoção e saída da Casa |
| **M3 · Produtos e tags** | Cadastro, edição e exclusão de produtos; busca por nome e filtro por tag; até 3 fotos por produto; aviso de produto duplicado (somar, cadastrar mesmo assim ou cancelar); histórico de alterações |
| **M4 · Estatísticas** | Valor total, maior gasto, valor médio, valor por tag, tag mais comprada, produtos mais antigos e uso de armazenamento |
| **M5 · Planos** | Planos com limites de membros e de armazenamento, contratação, cancelamento e expiração |

### Papéis

| Papel | Pode |
|---|---|
| **ADMIN** | Tudo: gerenciar membros, papéis e plano da Casa, além de produtos e tags |
| **EDITOR** | Cadastrar, editar e excluir produtos e tags |
| **LEITOR** | Só consultar produtos e estatísticas |

As permissões são conferidas na API, não só escondidas na interface.

---

## Planos de assinatura

| Plano | Preço | Membros | Armazenamento de fotos | Destaque |
|---|---|---|---|---|
| **Individual** | Grátis | 1 | 1 GB | Estatísticas básicas |
| **Família** | R$ 19,90/mês | até 6 | 20 GB | Papéis Editor e Leitor |
| **Business** | R$ 49,90/mês | até 15 | 100 GB | Suporte prioritário |

- Assinatura mensal com renovação automática. Ao cancelar, os benefícios continuam até a data da renovação.
- Quando a assinatura expira, a Casa volta ao Individual: os membros extras são desvinculados e os produtos são mantidos.
- **Pagamento simulado no MVP.** Em desenvolvimento, o fluxo funciona com cartões de teste
  (`4242 4242 4242 4242` aprova, `4111 1100 0005 0000` recusa). **Em produção os planos pagos estão desativados:** a
  tela de planos aparece com os botões cinza e todas as Casas usam o Individual.

---

## Ferramentas

| Camada | Tecnologias |
|---|---|
| **Front-end** | React 19, TypeScript, Vite 7, Tailwind CSS 4, React Router 7, TanStack Query 5, React Hook Form + Zod 4 |
| **API** | Node.js 22, Express 5, TypeScript, Prisma 6, Zod 4, JWT (jsonwebtoken), bcryptjs, sharp (recodifica as fotos e remove EXIF/GPS) |
| **Banco** | PostgreSQL 17 |
| **Fotos** | Object storage S3 com URL assinada (AWS SDK v3): SeaweedFS em dev, Cloudflare R2 em produção |
| **E-mail** | Mailpit em dev, Resend em produção |
| **Testes** | Vitest, Supertest, Testing Library e Playwright (E2E em desktop e celular de 360 px) |
| **Infra** | Docker Compose, GitHub Actions (CI e rotina de hora em hora), Vercel (front) e Render (API) |

Arquitetura MVC: telas em `frontend/src/pages`, rotas e controllers em `backend/src/modules/*/*.routes.ts` e
`*.controller.ts`, regras de negócio em `*.service.ts`. Os contratos da API ficam em [`docs/api/`](docs/api/).

---

## Como rodar localmente

Tudo roda em Docker. Não é preciso instalar Node, PostgreSQL nem nada além do Docker no computador.

### Pré-requisitos

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (ou Docker Engine com Compose v2), aberto e rodando
- `git` e `make` (no macOS, vêm com as *Command Line Tools*: `xcode-select --install`)

### Primeira vez

```bash
git clone https://github.com/harryzuh/KeepIt-app.git
```

```bash
cd KeepIt-app
```

```bash
make setup
```

O `make setup` cria o `.env` a partir do `.env.example`, constrói as imagens, instala as dependências dentro dos
containers, sobe os serviços e aplica as migrations (que já criam os três planos).

Para ter um usuário de demonstração com produtos de exemplo:

```bash
make seed
```

Entre com `demo@keepit.local` e a senha `keepit-demo-123` (só existe em desenvolvimento).

### Endereços

| Serviço | Endereço |
|---|---|
| App (front-end) | http://localhost:5173 |
| API | http://localhost:3333/health |
| E-mails enviados (Mailpit) | http://localhost:8025 |
| S3 local (SeaweedFS) | http://localhost:9000 (keepit / keepit-secret, bucket `keepit-fotos`) |
| PostgreSQL | localhost:5432 (keepit / keepit) |

Os códigos de recuperação de senha e de troca de e-mail não saem para a internet em dev: aparecem no Mailpit.

### Comandos do dia a dia

| Comando | O que faz |
|---|---|
| `make up` / `make down` | Sobe ou derruba o ambiente |
| `make logs` | Acompanha os logs dos serviços |
| `make check` | Lint, typecheck e testes do back-end e do front-end |
| `make e2e` | Testes E2E com Playwright (o ambiente precisa estar de pé) |
| `make deps` | Sincroniza as dependências depois de um `git pull` |
| `make migrate` | Cria ou aplica migrations do Prisma |
| `make studio` | Abre o Prisma Studio para ver o banco |
| `make seed` | Planos e usuário demo (idempotente) |
| `make reset` | **Apaga** banco, fotos e dependências dos volumes |

Problemas comuns e detalhes de cada serviço estão no [SETUP.md](SETUP.md).

---

## Estrutura

```
backend/    API (Express + Prisma): src/modules/<módulo>, prisma/schema.prisma e migrations
frontend/   SPA (React + Vite): src/pages, src/components, src/features/<módulo>
e2e/        Testes Playwright
infra/      Configuração do S3 local, CORS e scripts de produção
docs/       Requisitos, arquitetura, contratos da API, ADRs, histórias, QA e segurança
```
