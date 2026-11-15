.PHONY: setup check up down build install deps logs migrate migrate-deploy studio test lint typecheck reset sh-back sh-front

setup:     ## Configuração completa em uma máquina nova (idempotente)
	@test -f .env || cp .env.example .env
	docker compose build
	docker compose up -d
	docker compose run --rm --no-deps backend npm ci
	docker compose run --rm --no-deps frontend npm ci
	docker compose exec -T backend npx prisma migrate deploy
	docker compose exec -T backend npx prisma generate
	docker compose restart backend frontend
check:     ## Lint, typecheck e testes de backend e frontend
	$(MAKE) lint typecheck test
up:        ## Sobe todo o ambiente
	docker compose up -d
down:      ## Derruba o ambiente
	docker compose down
build:     ## (Re)constrói as imagens, instalando as dependências no container
	docker compose build
install:   ## Reinstala dependências e copia os package-lock.json para o host
	docker compose run --rm --no-deps backend npm install
	docker compose run --rm --no-deps frontend npm install
logs:
	docker compose logs -f backend frontend
deps:      ## Sincroniza node_modules dos volumes com os package-lock.json (após git pull)
	docker compose run --rm --no-deps backend npm ci
	docker compose run --rm --no-deps frontend npm ci
	docker compose exec -T backend npx prisma generate
migrate-deploy: ## Aplica migrations existentes sem interação
	docker compose exec -T backend npx prisma migrate deploy
migrate:   ## Cria/aplica migrations do Prisma
	docker compose exec backend npx prisma migrate dev
studio:
	docker compose exec backend npx prisma studio
test:
	docker compose run --rm --no-deps backend npm test
	docker compose run --rm --no-deps frontend npm test
lint:
	docker compose run --rm --no-deps backend npm run lint
	docker compose run --rm --no-deps frontend npm run lint
typecheck:
	docker compose run --rm --no-deps backend npm run typecheck
	docker compose run --rm --no-deps frontend npm run typecheck
reset:     ## APAGA banco, arquivos S3 e node_modules dos volumes
	docker compose down -v
sh-back:
	docker compose exec backend sh
sh-front:
	docker compose exec frontend sh
