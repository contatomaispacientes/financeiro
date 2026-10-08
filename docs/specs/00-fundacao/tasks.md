# 00 — Fundação · Tarefas

> Status: **Aprovado** · Uma tarefa por vez, na ordem; cada uma termina com testes passando e commit.

- [x] 1. Criar o monorepo
  - `pnpm-workspace.yaml`, `package.json` raiz com scripts (`dev`, `build`, `lint`, `typecheck`, `test`), `.nvmrc`, `.editorconfig`, `.gitignore`, ESLint + Prettier compartilhados, `tsconfig.base.json` com `strict`.
  - Fixar versões estáveis atuais de cada dependência.
  - _Requisitos: FND-01.1_

- [x] 2. Pacote `shared` com utilitários de dinheiro, data e documento
  - `money.ts`, `date.ts`, `document.ts`, `enums.ts` (todos os enums do data-model), `index.ts`.
  - Testes Vitest cobrindo a tabela de utilitários do design, incluindo `splitInstallments` com propriedade "soma = total" e virada de dia em São Paulo.
  - _Requisitos: base (ADR-002)_

- [x] 3. Docker Compose e scaffold da API NestJS
  - `docker-compose.yml` (postgres, redis, mailpit), `apps/api` com `ConfigModule` + `env.schema.ts` (zod), `nestjs-pino`, helmet, CORS, prefixo `/api/v1`, `GET /health`, Swagger fora de produção.
  - Teste: API não sobe com env inválido e lista as variáveis.
  - _Requisitos: FND-01.2, FND-01.4, FND-07.2, FND-07.3_

- [x] 4. Prisma com o schema completo do data-model
  - `schema.prisma` igual a `docs/architecture/data-model.md` (já validado sintaticamente), `prisma.config.ts` com `DATABASE_URL`, `PrismaService` com `@prisma/adapter-pg`, primeira migration + migration SQL dos índices parciais e extensões.
  - Conferir na documentação da versão instalada do Prisma se algo mudou em relação ao que está em `stack.md`.
  - Seed: admin, settings, categorias, serviços e clientes fictícios, modelo de contrato `fake`.
  - _Requisitos: FND-01.5_

- [x] 5. Infra comum da API
  - `ZodValidationPipe`, `DomainException` + filtro (`{ error: { code, message, details } }`), decorators `@Public`, `@Roles`, `@CurrentUser`, paginação padrão, `QueuesModule` (BullMQ) com conexão Redis.
  - Testes unitários do filtro e do pipe.
  - _Requisitos: FND-03.3_

- [x] 6. Autenticação
  - Login, refresh rotativo com detecção de reuso, logout, `me`, argon2id, throttler no login, guard global.
  - Testes de integração (Testcontainers): login ok/inválido/inativo, refresh, reuso revoga tudo, rate limit.
  - _Requisitos: FND-02.1–FND-02.6_

- [x] 7. Usuários, papéis e auditoria
  - CRUD de usuários (ADMIN), reset de senha, regra do último admin, `AuditService.record()`, `GET /audit-logs`.
  - Testes: matriz de permissões (um teste por linha relevante), `LAST_ADMIN`, auditoria de login.
  - _Requisitos: FND-03.1–FND-03.4, FND-05.1, FND-05.2_

- [x] 8. Configurações e status das integrações
  - `GET/PATCH /settings` com auditoria antes/depois; `GET /settings/integrations`; `POST /settings/integrations/asaas/test` usando `AsaasClient.ping()` (implementar só `ping` agora, com `nock` nos testes).
  - _Requisitos: FND-04.1–FND-04.4_

- [x] 9. Scaffold do web
  - Vite + React + TS, Tailwind, shadcn/ui, React Router, TanStack Query, tokens visuais de `stack.md`, fontes Geist.
  - `lib/api.ts` com refresh transparente; `RequireAuth`, `RequireRole`; `AppLayout` com menu responsivo e selo do ambiente.
  - Componentes base, `MoneyInput`, `StatusBadge`.
  - _Requisitos: FND-06.1, FND-06.3_

- [x] 10. Telas de Login, Usuários, Configurações (Geral e Integrações) e Auditoria
  - Testes de componente: login, expiração do token → refresh → repetição da chamada; logout ao falhar refresh com retorno à rota.
  - _Requisitos: FND-06.2, FND-03.1, FND-04, FND-05.2_

- [x] 11. CI
  - Workflow do GitHub Actions conforme design; badge no README.
  - _Requisitos: FND-07.1_

- [ ] 12. (M8) Produção
  - [x] Dockerfile, `docker-compose.prod.yml`, guia `docs/deploy.md`, backup diário com teste de restauração (validado localmente em 08/10/2026).
  - [ ] Primeiro deploy na VPS e checklist de virada executado e registrado.
  - _Requisitos: FND-08.1–FND-08.3_
