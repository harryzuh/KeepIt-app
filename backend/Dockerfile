# ---------- base ----------
FROM node:22-alpine AS base
RUN apk add --no-cache openssl
WORKDIR /app

# ---------- dev: dependências instaladas no container ----------
FROM base AS dev
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
EXPOSE 3333
CMD ["npm", "run", "dev"]

# ---------- build ----------
FROM dev AS build
RUN npm run build && npm prune --omit=dev

# ---------- produção ----------
FROM base AS prod
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./
EXPOSE 3333
CMD ["sh", "-c", "npx --no-install prisma migrate deploy && node dist/server.js"]
