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
| GET | `/settings/environment` → `{ asaasEnv }` | todos | FND-06.1 (selo do ambiente) |
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
  companySignerName: z.string().min(2).max(120).optional(),   // spec 07
  companySignerEmail: z.string().email().optional(),
  companySignerPhone: z.string().regex(/^\d{10,11}$/).optional(),
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
| `LAST_ADMIN` | 409 | FND-03.4 (desativar ou rebaixar o último ADMIN ativo) |
| `EMAIL_IN_USE` | 409 | e-mail já usado por outro usuário (FND-03.1) |
| `INTERNAL_ERROR` | 500 | erro inesperado; detalhes só no log |
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
| 07/10/2026 | Revisão das specs 01–08: `reminderMessage` sai de Settings (mensagens passam para `reminder_templates`, spec 08); entram `companySigner*` (signatário padrão da empresa, spec 07). Sem impacto nas tarefas já planejadas além do schema de Settings |
| 07/10/2026 | Tarefa 6: e-mail do admin do seed passa de `admin@local` para `admin@financeiro.local` (o `LoginSchema` rejeita domínio sem ponto). Refresh token é opaco (32 bytes aleatórios) e o hash guardado é HMAC-SHA256 com `JWT_REFRESH_SECRET`. E-mail normalizado em minúsculas no login e no cadastro. Testes da API em Vitest (ADR-012) |
| 07/10/2026 | Tarefa 7: matriz de permissões vira código em `packages/shared/permissions.ts` (`Permission`, `can()`), usado por `@Roles` na API e pelo menu no web. Novo erro `EMAIL_IN_USE`. Desativar, trocar o papel ou redefinir a senha de um usuário revoga os refresh tokens dele. Auditoria: `auth.login`, `auth.login_failed` (`{ email, reason }`), `user.create`, `user.update` (só campos alterados), `user.reset_password` (sem dados). Filtro de período da auditoria usa o dia de São Paulo, datas inclusivas |
| 07/10/2026 | Tarefa 8: campos de texto opcionais do `SettingsUpdateSchema` aceitam `null` (para limpar); `companyDocument` gravado só com dígitos; PATCH vazio → 400. O resultado do "Testar conexão" é guardado como auditoria `integration.asaas_test` (sem coluna nova) e `GET /settings/integrations` mostra o mais recente. `AsaasClient.ping()` não faz retry (diagnóstico) e devolve 200 com `{ ok, latencyMs, error }` também em falha, com os códigos da tabela de erros de `asaas.md` |
| 07/10/2026 | Tarefa 9: nova rota `GET /settings/environment` (todos os papéis) para o selo do ambiente, já que `/settings/integrations` é só ADMIN. Renovação do token serializada entre abas com Web Locks e deduplicada na aba (evita disparar a detecção de reuso de FND-02.4 com duas abas ou com o StrictMode). Menu filtrado por `can()` do `shared`; rotas sem tela ainda mostram "Em construção" com a spec responsável. `DatePicker` = `<input type="date">` nativo. Auditoria em `/configuracoes/auditoria`. Dependências do web no ADR-013 |
