.PHONY: up down build install logs migrate studio test lint sh-back sh-front

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
sh-back:
	docker compose exec backend sh
sh-front:
	docker compose exec frontend sh
