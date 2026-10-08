# Imagens de produção (FND-08.1). Contexto = raiz do monorepo.
#   docker build --target api .   → API NestJS (aplica migrations ao subir)
#   docker build --target web .   → Caddy: SPA + proxy /api + HTTPS automático
FROM node:24.13.0-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV CI=true
RUN npm install -g pnpm@12.10.1
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile --offline
RUN pnpm --filter @financeiro/api build && pnpm --filter @financeiro/web build

FROM build AS api
ENV NODE_ENV=production
WORKDIR /app/apps/api
RUN mkdir -p storage && chown node:node storage
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD node -e "fetch('http://localhost:3000/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node dist/main"]

FROM caddy:2.10.2-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
