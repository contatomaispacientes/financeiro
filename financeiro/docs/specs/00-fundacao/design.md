# 00 — Fundação · Design

> Status: **Aprovado** · Implementa: `FND-01` … `FND-08`

## Estrutura do repositório

```
.
├─ apps/api/
│  ├─ prisma/{schema.prisma, migrations/, seed.ts}
│  ├─ src/
│  │  ├─ main.ts, app.module.ts
│  │  ├─ config/env.schema.ts           # zod das variáveis (FND-01.4)
│  │  ├─ common/{guards, decorators, pipes, filters, interceptors}
│  │  │   ├─ decorators/public.decorator.ts, roles.decorator.ts, current-user.decorator.ts
│  │  │   ├─ pipes/zod-validation.pipe.ts
│  │  │   └─ filters/domain-exception.filter.ts   # { error: { code, message, details } }
│  │  ├─ prisma/prisma.service.ts
│  │  ├─ queues/queues.module.ts         # registra filas BullMQ
│  │  ├─ integrations/{asaas, contracts, mail, storage}/
│  │  └─ modules/{auth, users, settings, audit, health, ...}
│  └─ test/{e2e/, fixtures/, setup-containers.ts}
├─ apps/web/
│  └─ src/{main.tsx, router.tsx, lib/{api.ts, auth.ts, query.ts}, components/ui/, layouts/AppLayout.tsx, pages/, features/<módulo>/}
├─ packages/shared/src/{money.ts, date.ts, document.ts, enums.ts, schemas/, index.ts}
├─ docker-compose.yml, .github/workflows/ci.yml, .nvmrc, pnpm-workspace.yaml
```

## Autenticação

- `POST /api/v1/auth/login` `{ email, password }` → `{ accessToken, user: { id, name, email, role } }` + cookie `refresh_token` (path `/api/v1/auth`).
- `POST /api/v1/auth/refresh` (cookie) → novo `accessToken` + cookie novo. Refresh guardado como `sha256` em `refresh_tokens`.
- `POST /api/v1/auth/logout` → revoga o refresh atual.
- `GET /api/v1/auth/me`.
- Guard global `JwtAuthGuard` + `RolesGuard`; `@Public()` libera rota.
- Access token no front fica **em memória** (não em localStorage); refresh só no cookie.

## Matriz de permissões

| Ação | ADMIN | FINANCEIRO | LEITURA |
| --- | --- | --- | --- |
| Ver dashboard, listas, relatórios | ✔ | ✔ | ✔ (documento mascarado) |
| CRUD clientes, serviços, despesas | ✔ | ✔ | — |
| Criar, cancelar, reenviar cobrança | ✔ | ✔ | — |
| Estornar cobrança | ✔ | — | — |
| Cancelar assinatura (recorrência) | ✔ | ✔ | — |
| Contratos: criar, enviar, cancelar | ✔ | ✔ | — |
| Modelos de contrato | ✔ | — | — |
| Configurações, usuários, auditoria, reprocessar webhook, reconciliar | ✔ | — | — |

## API desta spec

| Método | Rota | Papel | Requisitos |
| --- | --- | --- | --- |
| POST | `/auth/login`, `/auth/refresh`, `/auth/logout` | público / autenticado | FND-02 |
| GET | `/auth/me` | todos | FND-02 |
| GET/POST/PATCH | `/users`, `/users/:id` | ADMIN | FND-03 |
| POST | `/users/:id/reset-password` `{ newPassword }` | ADMIN | FND-03.1 |
| GET/PATCH | `/settings` | GET todos, PATCH ADMIN | FND-04.1 |
| GET | `/settings/integrations` | ADMIN | FND-04.2 |
| POST | `/settings/integrations/asaas/test` | ADMIN | FND-04.3 |
| GET | `/audit-logs?entity&userId&from&to&page` | ADMIN | FND-05.2 |
| GET | `/health` | público | FND-07.2 |

## Schemas (shared)

```ts
export const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
export const UserCreateSchema = z.object({ name: z.string().min(2), email: z.string().email(), role: RoleEnum, password: z.string().min(10) });
export const SettingsUpdateSchema = z.object({
  companyName: z.string().max(120).optional(),
  companyDocument: z.string().refine(isValidCpfOrCnpj).optional(),
  companyCity: z.string().max(80).optional(),
  defaultDueDays: z.number().int().min(0).max(60),
  defaultFinePct: z.number().min(0).max(10),
  defaultInterestPct: z.number().min(0).max(10),
  contractChargeDueDays: z.number().int().min(0).max(60),
  reminderDaysBefore: z.number().int().min(0).max(30),
  reminderOnDueDate: z.boolean(),
  reminderDaysAfter: z.array(z.number().int().min(1).max(60)).max(5),
  reminderChannels: z.array(z.enum(['ASAAS', 'EMAIL', 'WHATSAPP'])).min(1),
  reminderMessage: z.string().min(10).max(1000),
}).partial();
```

## Utilitários de `shared` (contratos testáveis)

| Função | Comportamento |
| --- | --- |
| `toCents("1.234,56") → 123456`; `toCents(12.5) → 1250` | Aceita string BR ou número; arredonda half-up |
| `fromCents(123456) → 1234.56` | Para payload do Asaas |
| `formatBRL(123456) → "R$ 1.234,56"` | `Intl.NumberFormat('pt-BR')` |
| `splitInstallments(10000, 3) → [3333, 3333, 3334]` | Soma sempre igual ao total |
| `todayInSaoPaulo() → "2026-10-07"` | String `YYYY-MM-DD` |
| `addMonthsClamped("2026-01-31", 1) → "2026-02-28"` | Fim de mês preservado |
| `isValidCpf`, `isValidCnpj`, `onlyDigits`, `maskDocument("12345678909") → "***.456.789-**"` | |

## Erros comuns

| Código | HTTP | Quando |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | zod falhou (`details` = issues) |
| `INVALID_CREDENTIALS` | 401 | FND-02.2 |
| `UNAUTHORIZED` | 401 | sem token / token inválido |
| `FORBIDDEN` | 403 | FND-03.3 |
| `NOT_FOUND` | 404 | |
| `LAST_ADMIN` | 409 | FND-03.4 |
| `RATE_LIMITED` | 429 | FND-02.5 |

## Front

- `AppLayout` com menu lateral e `Outlet`; `RequireAuth` e `RequireRole`.
- `lib/api.ts`: `fetch` com base `/api/v1`, injeta Bearer, tenta refresh uma vez em 401, converte `{ error }` em `ApiError { code, message, details }`.
- Componentes base (shadcn): Button, Input, Select, Dialog, Sheet (painel lateral), Table, Badge, Tabs, Toast, Skeleton, DatePicker, MoneyInput (máscara BRL → centavos).
- `StatusBadge` único que recebe enum e devolve texto + cor (telas.md).
- Páginas desta spec: Login, Configurações (abas Geral, Integrações, Régua — conteúdo da régua chega na spec 08), Usuários, Auditoria.

## Logs (FND-07.3)

`nestjs-pino` com `redact` para `req.headers.authorization`, `req.headers["asaas-access-token"]`, `*.password`, `*.cpfCnpj`, `*.document`, `*.apiKey`; `requestId` gerado por requisição e devolvido no header `x-request-id`.

## CI (`.github/workflows/ci.yml`) — FND-07.1

Serviços postgres e redis; passos: `pnpm install --frozen-lockfile` → `pnpm lint` → `pnpm typecheck` → `pnpm test` → `pnpm --filter api test:e2e` → `pnpm build`.

## Testes

| Nível | O que cobre | Requisitos |
| --- | --- | --- |
| Unit (shared) | money, date, document — inclusive casos de borda | base de todos |
| Unit (api) | env schema; guards; filtro de erro | FND-01.4, FND-03.3 |
| Integração (api) | login, refresh com rotação e reuso, rate limit, last admin, settings + auditoria | FND-02, FND-03, FND-04, FND-05 |
| Componente (web) | Login, refresh transparente, menu por papel | FND-06 |

## Produção (M8)

- Imagens: `apps/api/Dockerfile` (multi-stage, `prisma migrate deploy` no start), `apps/web/Dockerfile` (build estático servido por Nginx/Caddy) ou web servido por CDN.
- Proxy com HTTPS (Caddy recomendado), API em `/api`, web em `/`.
- Backups: `pg_dump` diário para storage S3-compatível, retenção 30 dias.
- Checklist de virada: ver FND-08.3 e `docs/integrations/asaas.md` (runbook).

## Changelog

| Data | Mudança |
| --- | --- |
| 07/10/2026 | Versão inicial |
