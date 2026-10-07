# 01 — Clientes · Design

> Status: **Em revisão** · Implementa: `CLI-01` … `CLI-05`

## Dados

Tabela `customers` (data-model.md). Índices extras via migration SQL:
- `CREATE EXTENSION IF NOT EXISTS unaccent; CREATE EXTENSION IF NOT EXISTS pg_trgm;`
- índice GIN trigram em `unaccent(lower(name))` (função imutável wrapper `f_unaccent`).

## API

| Método | Rota | Papel | Corpo / query | Resposta | Requisitos |
| --- | --- | --- | --- | --- | --- |
| GET | `/customers` | todos | `search`, `archived=false`, `page`, `pageSize`, `sort=name:asc` | `{ data: CustomerListItem[], meta }` | CLI-02 |
| POST | `/customers` | ADMIN, FIN | `CustomerCreate` | `Customer` 201 | CLI-01 |
| GET | `/customers/:id` | todos | — | `CustomerDetail` | CLI-03 |
| PATCH | `/customers/:id` | ADMIN, FIN | `CustomerUpdate` | `Customer` | CLI-04.1–04.3 |
| POST | `/customers/:id/archive` · `/unarchive` | ADMIN, FIN | — | `Customer` | CLI-04.4, CLI-04.5 |
| GET | `/customers/lookup?document=` | ADMIN, FIN | — | `{ exists, customerId? }` | CLI-01.3 (checagem ao digitar) |

`CustomerListItem` inclui agregados (`chargesCount`, `paidCents`, `openCents`, `overdueCents`) calculados por uma única query com `GROUP BY` (sem N+1).

`CustomerDetail` = cliente + agregados + `recentCharges` (20) + `subscriptions` ativas + `contracts` (20).

## Schemas (shared/schemas/customer.ts)

```ts
export const AddressSchema = z.object({
  postalCode: z.string().regex(/^\d{8}$/), street: z.string().min(2), number: z.string().min(1),
  complement: z.string().optional(), district: z.string().min(2), city: z.string().min(2), state: z.string().length(2),
});
export const CustomerCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  document: z.string().transform(onlyDigits).refine(isValidCpfOrCnpj, 'CPF ou CNPJ inválido'),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().transform(onlyDigits).refine((v) => v === '' || /^\d{10,11}$/.test(v)).optional(),
  address: AddressSchema.optional(),
  notes: z.string().max(2000).optional(),
  remindersEnabled: z.boolean().default(true), // usado pela régua (spec 08, REG-05.1)
});
export const CustomerUpdateSchema = CustomerCreateSchema.partial();
```

## Regras

**`CustomersService.ensureAsaasCustomer(customerId, tx?)`** (CLI-05), usado por cobranças e contratos:
1. Dentro de transação, `SELECT pg_advisory_xact_lock(hashtext(customerId))`.
2. Relê o cliente; se tem `asaasCustomerId`, retorna.
3. `asaas.findCustomerByDocument(document)`; se achou um não removido → grava e retorna.
4. `asaas.createCustomer({ name, cpfCnpj, email, mobilePhone, address…, externalReference: id, notificationDisabled })` → grava e retorna.
5. Erro do Asaas sobe como `ASAAS_*` (ver asaas.md).

`notificationDisabled` segue a régua: `false` se `ASAAS` estiver nos canais de lembrete, `true` caso contrário (spec 08).

**Sincronização na edição** (CLI-04.2): após commit local, enfileira `asaas-customer-sync` (jobId = `customerId`, substitui pendente) que faz `PUT /customers/{id}`. Falha final → grava a mensagem em `customers.asaas_sync_error` e a ficha mostra o aviso "dados não sincronizados com o Asaas" com botão "Tentar de novo"; sucesso limpa o campo.

## Erros

| Código | HTTP | Quando |
| --- | --- | --- |
| `CUSTOMER_DUPLICATE` | 409 | CLI-01.3 (`details.customerId`) |
| `CUSTOMER_DOCUMENT_LOCKED` | 409 | CLI-04.3 |
| `CUSTOMER_HAS_OPEN_ITEMS` | 409 | CLI-04.4 (`details` com contagens) |
| `CUSTOMER_ARCHIVED` | 422 | usado por cobranças/contratos |
| `ASAAS_SYNC_PENDING` | 200 com aviso | CLI-04.2 (campo `warnings` na resposta) |

## Front

- `/clientes`: busca com debounce 300 ms, tabela, toggle "mostrar arquivados", botão "Novo cliente".
- Modal/Sheet `CustomerForm`: máscara de CPF/CNPJ dinâmica, checagem de duplicado ao sair do campo (`/customers/lookup`), CEP com preenchimento opcional (ViaCEP fica para v1.1 — campo manual na v1).
- `/clientes/:id`: cabeçalho com nome e ações (Editar, Arquivar, Nova cobrança, Novo contrato); cards de totais; abas Cobranças, Assinaturas, Contratos.
- Invalidação: criar/editar invalida `['customers']` e `['customer', id]`.

## Testes

| Nível | O que cobre | Requisitos |
| --- | --- | --- |
| Unit (shared) | CustomerCreateSchema: CPF/CNPJ válido/inválido, telefone | CLI-01.1 |
| Integração | criar, duplicado (inclusive arquivado), busca sem acento e por documento mascarado, agregados corretos | CLI-01, CLI-02 |
| Integração | editar documento travado; arquivar com itens abertos; LEITURA vê mascarado | CLI-04, CLI-02.4 |
| Integração (nock) | ensureAsaasCustomer: já tem id / acha por documento / cria / 2 chamadas concorrentes criam 1 | CLI-05 |
| Componente | formulário com validação e duplicado | CLI-01 |

## Changelog

| Data | Mudança |
| --- | --- |
| 07/10/2026 | Versão inicial |
