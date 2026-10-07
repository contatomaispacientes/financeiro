# 02 — Serviços · Design

> Status: **Em revisão** · Implementa: `SRV-01` … `SRV-03`

## Dados

Tabela `services`. Índice único parcial: `CREATE UNIQUE INDEX services_name_active_uq ON services (lower(name)) WHERE active;` (migration SQL).

## API

| Método | Rota | Papel | Corpo / query | Resposta | Requisitos |
| --- | --- | --- | --- | --- | --- |
| GET | `/services` | todos | `status=active\|inactive\|all` (padrão `active`), `search` | `{ data: ServiceListItem[] }` (com `usageCount`) | SRV-03.1 |
| POST | `/services` | ADMIN, FIN | `ServiceCreate` | `Service` 201 | SRV-01.1, 01.2 |
| PATCH | `/services/:id` | ADMIN, FIN | `ServiceUpdate` (inclui `active`) | `Service` | SRV-01, SRV-02.1 |
| DELETE | `/services/:id` | ADMIN, FIN | — | 204 | SRV-02.2 |

## Schemas (shared/schemas/service.ts)

```ts
export const ServiceCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().max(500).optional(),
  defaultPriceCents: z.number().int().positive(),
  active: z.boolean().default(true),
});
export const ServiceUpdateSchema = ServiceCreateSchema.partial();
```

## Regras

- `usageCount` = `COUNT(DISTINCT charge_id)` em `charge_items` + `subscription_items` com `service_id`.
- SRV-01.3 é garantido por desenho: itens guardam `description` e `unit_price_cents` próprios; nenhuma FK propaga preço.
- Exclusão: se `usageCount > 0` ou serviço presente em `contracts.charge_plan` (busca JSON `@>`), responde `SERVICE_IN_USE` — sugerir desativar.

## Erros

| Código | HTTP | Quando |
| --- | --- | --- |
| `SERVICE_DUPLICATE` | 409 | SRV-01.2 |
| `SERVICE_IN_USE` | 409 | SRV-02.2 |

## Front

- `/servicos`: tabela, filtro, toggle ativo inline (otimista com rollback), Sheet "Novo/Editar serviço" com `MoneyInput`.
- Catálogo usado na Nova Cobrança: `GET /services?status=active` com cache de 5 min.

## Testes

| Nível | O que cobre | Requisitos |
| --- | --- | --- |
| Integração | criar, duplicado entre ativos, duplicado permitido se o outro está inativo, editar preço não altera itens existentes, excluir usado/não usado | SRV-01, SRV-02 |
| Componente | formulário, toggle | SRV-02.1 |

## Changelog

| Data | Mudança |
| --- | --- |
| 07/10/2026 | Versão inicial |
