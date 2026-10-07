# Stack e convenções

> Status: **Aprovado** · Versões: fixar a última estável/LTS de cada pacote no momento do scaffold (tarefa FND) e registrar no `package.json`. Não use versões beta.

## Visão geral

```
financeiro/
├─ apps/
│  ├─ api/            NestJS (REST /api/v1, filas, webhooks)
│  └─ web/            React + Vite (SPA)
├─ packages/
│  └─ shared/         zod schemas, enums, tipos, money.ts, date.ts, document.ts
├─ docs/              specs, arquitetura, integrações
├─ docker-compose.yml postgres + redis (+ mailpit em dev)
├─ .claude/skills/    skills do fluxo SDD
└─ CLAUDE.md
```

## Backend — `apps/api`

| Camada | Escolha | Observação |
| --- | --- | --- |
| Runtime | Node.js LTS ativo | `engines` no package.json; `.nvmrc` |
| Framework | NestJS + TypeScript (`strict: true`) | Módulos por domínio |
| Banco | PostgreSQL | `timestamptz` para instantes, `date` para vencimentos |
| ORM | Prisma (versão atual — a partir da 7 a URL fica em `prisma.config.ts` e o client usa driver adapter `@prisma/adapter-pg`) | Migrations versionadas; `prisma/schema.prisma` espelha `data-model.md`; client gerado em `src/generated/prisma` |
| Validação | zod (de `packages/shared`) + `ZodValidationPipe` | Mesmos schemas no front |
| Filas / jobs | BullMQ + Redis via `@nestjs/bullmq` | Webhooks, geração de cobrança pós-contrato, lembretes, reconciliação, recorrência de despesas |
| Agendamento | Jobs repetíveis do BullMQ (cron) | Fuso `America/Sao_Paulo` |
| HTTP externo | `fetch` nativo encapsulado em clients com timeout, retry exponencial e log | `integrations/asaas`, `integrations/contracts`, `integrations/mail` |
| Auth | JWT access (15 min) + refresh (7 dias, rotativo, hash no banco); senha com argon2 | Guard global; `@Public()` para login e webhooks; `@Roles()` |
| Segurança | helmet, CORS restrito a `WEB_ORIGIN`, `@nestjs/throttler` | Limite mais baixo em `/auth/login` |
| Config | `@nestjs/config` + schema zod das variáveis de ambiente | A app não sobe com env inválido |
| Logs | `nestjs-pino` (JSON), `requestId` por requisição | Redação de campos sensíveis |
| Docs da API | `@nestjs/swagger` em `/api/docs` (só fora de produção) | |
| Armazenamento de arquivos | `StorageService` com driver `local` (dev) e `s3` (S3-compatível) | PDFs de contrato assinado |
| E-mail | Nodemailer (SMTP) atrás de `MailProvider`; Mailpit em dev | Provedor de produção pendente |
| Testes | Jest + Supertest; Testcontainers (Postgres, Redis) para integração; HTTP externo mockado com `nock` | `test/fixtures/asaas/*.json` com payloads reais do sandbox |

### Estrutura de módulo (padrão)

```
apps/api/src/modules/charges/
├─ charges.module.ts
├─ charges.controller.ts      # só HTTP: valida, chama service, mapeia resposta
├─ charges.service.ts         # regras de negócio, transações
├─ charges.repository.ts      # acesso Prisma (opcional quando simples)
├─ charges.mapper.ts          # entidade ↔ DTO de resposta
├─ charges.errors.ts          # erros de domínio com código estável
└─ __tests__/
```

Integrações ficam em `apps/api/src/integrations/<nome>/` e expõem interfaces (`AsaasClient`, `ContractProvider`, `MailProvider`). Os módulos de domínio dependem da interface, nunca da implementação.

### Respostas e erros HTTP

- Sucesso: o recurso (ou `{ data, meta: { page, pageSize, total } }` em listas).
- Erro: `{ error: { code: 'CHARGE_ALREADY_PAID', message: 'texto em pt-BR', details? } }` com status HTTP adequado (400 validação, 401, 403, 404, 409 conflito de estado, 422 regra de negócio, 502 integração externa falhou).
- Paginação: `?page=1&pageSize=20` (máx. 100). Ordenação: `?sort=dueDate:desc`.

## Frontend — `apps/web`

| Camada | Escolha |
| --- | --- |
| Build | Vite + React + TypeScript (`strict`) |
| Rotas | React Router (data router) |
| Dados | TanStack Query; client HTTP fino tipado com os schemas de `shared` |
| Formulários | react-hook-form + `@hookform/resolvers/zod` |
| UI | Tailwind CSS + shadcn/ui (Radix); ícones lucide-react |
| Gráficos | Recharts |
| Datas | date-fns com locale pt-BR |
| Testes | Vitest + Testing Library; MSW para mockar a API; Playwright para e2e |

Tokens visuais iniciais (do protótipo): fundo `#F2F3EF`, superfície `#FFFFFF`, texto `#15171A`, texto secundário `#5B6068`, primária/entradas `#0E6B4E`, saídas `#B4471C`, borda `#E1E3DD`; fontes Geist e Geist Mono.

## Shared — `packages/shared`

- `money.ts`: `toCents('1.234,56')`, `fromCents(123456) → 1234.56`, `formatBRL(cents)`, `splitInstallments(totalCents, n)` (resto na última parcela).
- `date.ts`: `todayInSaoPaulo()`, `addMonthsClamped()`, `isOverdue(dueDate)`.
- `document.ts`: validação de CPF/CNPJ (dígitos verificadores), `onlyDigits`, `maskDocument`.
- `enums.ts`: `ChargeStatus`, `ChargeType`, `BillingType`, `Cycle`, `ContractStatus`, `ExpenseStatus`, `Role`…
- `schemas/*.ts`: um arquivo por módulo (`customer.ts`, `charge-plan.ts`, `contract.ts`…).
- `plan.ts`: `calculatePlan()` (spec 03) e `nextChargeStatus()` (spec 04) — funções puras usadas por API e web.
- Testes com Vitest.

## Qualidade e fluxo de trabalho

- ESLint + Prettier compartilhados; `typecheck` em todos os workspaces.
- Commits no padrão Conventional Commits com IDs de requisitos.
- CI (GitHub Actions): install → lint → typecheck → test (unit + integração com serviços postgres/redis) → build.
- Husky + lint-staged opcional (decidir na FND).

## Variáveis de ambiente (`apps/api/.env.example`)

| Variável | Exemplo | Uso |
| --- | --- | --- |
| `NODE_ENV` | `development` | |
| `PORT` | `3000` | |
| `WEB_ORIGIN` | `http://localhost:5173` | CORS |
| `APP_TIMEZONE` | `America/Sao_Paulo` | Cálculo de "hoje" e crons |
| `DATABASE_URL` | `postgresql://…` | |
| `REDIS_URL` | `redis://localhost:6379` | |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | 32+ caracteres | |
| `ASAAS_ENV` | `sandbox` \| `production` | Define a base URL |
| `ASAAS_API_KEY` | `$aact_…` | Nunca no banco nem no front (ADR-003) |
| `ASAAS_WEBHOOK_TOKEN` | string aleatória 32+ | Comparado ao header `asaas-access-token` |
| `ASAAS_MIN_CHARGE_CENTS` | `500` | Valor mínimo por cobrança (confirmar no sandbox) |
| `CONTRACT_PROVIDER` | `fake` \| `clicksign` | `fake` em dev/testes automatizados |
| `CLICKSIGN_ENV` | `sandbox` \| `production` | Define a base URL (ADR-009) |
| `CLICKSIGN_ACCESS_TOKEN` | | Token da conta Clicksign (só env) |
| `CLICKSIGN_HMAC_SECRET` | | Segredo HMAC SHA256 do webhook (`Content-Hmac`) |
| `FAKE_CONTRACT_WEBHOOK_SECRET` | | Só dev: assina os webhooks do FakeProvider |
| `STORAGE_DRIVER` | `local` \| `s3` | |
| `STORAGE_LOCAL_DIR` / `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` | | |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | Mailpit em dev | |
