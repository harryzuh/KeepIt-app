# KeepIT

Inventário doméstico compartilhado por Casa. Monorepo com `frontend/` (React + Vite), `backend/` (Express + Prisma) e `docs/`.
A equipe de agentes e as regras de trabalho estão em [AGENTS.md](AGENTS.md).

## Rodando (tudo em Docker)

```bash
make build   # instala as dependências dentro das imagens
make up      # sobe db, s3, mailpit, backend e frontend
make migrate # cria as tabelas a partir de backend/prisma/schema.prisma
```

| Serviço | URL |
|---|---|
| Front-end | http://localhost:5173 |
| API | http://localhost:3333/health |
| S3 local (SeaweedFS) | http://localhost:9000 (keepit / keepit-secret, bucket keepit-fotos) |
| Mailpit (e-mails) | http://localhost:8025 |
| PostgreSQL | localhost:5432 (keepit / keepit) |
