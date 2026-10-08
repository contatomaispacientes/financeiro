# 01 — Clientes · Design

> Status: **Aprovado** · Implementa: `CLI-01` … `CLI-05`

## Dados

Tabela `customers` (data-model.md). Índices extras via migration SQL (`20261008120000_customers_name_search`):
- `CREATE EXTENSION IF NOT EXISTS unaccent; CREATE EXTENSION IF NOT EXISTS pg_trgm;`
- função imutável `public.f_unaccent(text)` (`BEGIN ATOMIC`, dicionário `public.unaccent` fixo);
- índice GIN trigram `customers_name_search_idx` em `public.f_unaccent(lower(name))`.

A busca por nome **precisa** usar exatamente `public.f_unaccent(lower(name)) LIKE '%' || public.f_unaccent(lower($termo)) || '%'` para aproveitar o índice.

## API

| Método | Rota | Papel | Corpo / query | Resposta | Requisitos |
| --- | --- | --- | --- | --- | --- |
| GET | `/customers` | todos | `search`, `archived=false`, `page`, `pageSize`, `sort=name:asc` | `{ data: CustomerListItem[], meta }` | CLI-02 |
| POST | `/customers` | ADMIN, FIN | `CustomerCreate` | `Customer` 201 | CLI-01 |
| GET | `/customers/:id` | todos | — | `CustomerDetail` | CLI-03 |
| PATCH | `/customers/:id` | ADMIN, FIN | `CustomerUpdate` | `Customer` | CLI-04.1–04.3 |
| POST | `/customers/:id/archive` · `/unarchive` | ADMIN, FIN | — | `Customer` | CLI-04.4, CLI-04.5 |
| GET | `/customers/lookup?document=` | ADMIN, FIN | — | `{ exists: false }` ou `{ exists: true, customerId, name, archived }` | CLI-01.3 (checagem ao digitar) |

`CustomerListItem` inclui agregados (`chargesCount`, `paidCents`, `openCents`, `overdueCents`) calculados por uma única query com `GROUP BY` (sem N+1).

`CustomerDetail` = cliente + agregados (`totals`) + `recentCharges` (20, `created_at` desc) + `subscriptions` ativas (`next_due_date` asc) + `contracts` (20, `created_at` desc).

**Agregados** (mesma base de status do dashboard, spec 06; função `computeTotals`):

| Total | Regra |
| --- | --- |
| `paidCents` | `PAID`, `CONFIRMED`, `PARTIALLY_REFUNDED`: `value_cents − refunded_cents` |
| `openCents` | `PENDING` + `OVERDUE` (inclui o vencido) |
| `overdueCents` | `OVERDUE` |
| `chargesCount` | todas exceto `DRAFT` e `CANCELED` |

**Trava do documento** (CLI-04.3): `details.reasons` com `ASAAS_CUSTOMER` (tem `asaas_customer_id`), `CHARGES` (cobrança com status diferente de `DRAFT`) e/ou `CONTRACTS` (contrato com status diferente de `DRAFT`). Reenviar o mesmo documento não conta como troca.

## Schemas (shared/schemas/customer.ts)

Implementado em `packages/shared/src/schemas/customer.ts` (zod 4). Resumo:

| Campo | Regra | Saída |
| --- | --- | --- |
| `name` | trim, 2–120 | texto |
| `document` | aceita máscara; CPF ou CNPJ com dígitos verificadores | só dígitos (CLI-01.4) |
| `email` | trim + minúsculas; `''` → `null` | `string \| null` |
| `phone` | aceita máscara; 10 ou 11 dígitos com DDD; `''` → `null` | só dígitos |
| `address` | `AddressSchema` ou `null`: CEP 8 dígitos (aceita máscara), logradouro, número, bairro, cidade, UF entre as 27 siglas (maiúscula); `complement` opcional | objeto normalizado |
| `notes` | trim, até 2000; `''` → `null` | texto |
| `remindersEnabled` | `CustomerCreateSchema`: padrão `true`; `CustomerUpdateSchema = base.partial()` **sem** default (PATCH não reaplica) | boolean |

Em PATCH, campo ausente = não altera; `null` = apaga. Helpers: `isAddressComplete(address)` (CLI-01.5 / CTR-02.9), `personTypeFromDocument(document)` (CLI-01.1), e em `document.ts` `formatDocument`, `formatPhone`, `formatPostalCode` para exibição.

## Regras

**`CustomersService.ensureAsaasCustomer(customerId, tx?)`** (CLI-05), usado por cobranças e contratos:
1. Dentro de transação, `SELECT pg_advisory_xact_lock(hashtext(customerId))`.
2. Relê o cliente; se tem `asaasCustomerId`, retorna.
3. `asaas.findCustomerByDocument(document)`; se achou um não removido → grava e retorna.
4. `asaas.createCustomer({ name, cpfCnpj, email, mobilePhone, address…, externalReference: id, notificationDisabled })` → grava e retorna.
5. Erro do Asaas sobe como `ASAAS_*` (ver asaas.md).

`notificationDisabled = !(settings.reminderChannels.includes('ASAAS') && customer.remindersEnabled)` (spec 08, REG-02.1 e REG-05.1).

**Sincronização na edição** (CLI-04.2): após commit local, enfileira `asaas-customer-sync` com `{ customerId }` **sem `jobId` fixo** (ADR-010: o BullMQ ignoraria silenciosamente um segundo job com o mesmo id, perdendo a edição feita enquanto o anterior roda). O processor relê o cliente no momento da execução e faz `PUT /customers/{id}` com o estado atual (nome, e-mail, celular, endereço, `notificationDisabled`); execuções repetidas são inofensivas. Falha final → grava a mensagem em `customers.asaas_sync_error` e a ficha mostra o aviso "dados não sincronizados com o Asaas" com botão "Tentar de novo"; sucesso limpa o campo.

## Erros

| Código | HTTP | Quando |
| --- | --- | --- |
| `CUSTOMER_DUPLICATE` | 409 | CLI-01.3 (`details: { customerId, name, archived }`) |
| `NOT_FOUND` | 404 | cliente inexistente |
| `CUSTOMER_DOCUMENT_LOCKED` | 409 | CLI-04.3 (cobrança emitida, contrato enviado ou `asaas_customer_id`) |
| `CUSTOMER_HAS_OPEN_ITEMS` | 409 | CLI-04.4 (`details` com contagens) |
| `CUSTOMER_ARCHIVED` | 422 | usado por cobranças/contratos |
| `ASAAS_SYNC_PENDING` | 200 com aviso | CLI-04.2 (campo `warnings` na resposta) |

## Front

- `/clientes`: busca com debounce 300 ms, tabela, toggle "mostrar arquivados", botão "Novo cliente".
- Modal/Sheet `CustomerForm`: máscara de CPF/CNPJ dinâmica, checagem de duplicado ao sair do campo (`/customers/lookup`), CEP com preenchimento opcional (ViaCEP fica para v1.1 — campo manual na v1).
- `/clientes/:id`: cabeçalho com nome e ações (Editar, Arquivar, Nova cobrança, Novo contrato); aviso âmbar "Endereço de cobrança incompleto — obrigatório para contrato" quando `isAddressComplete` for falso (CLI-01.5); cards de totais; abas Cobranças, Assinaturas, Contratos.
- Invalidação: criar/editar invalida `['customers']` e `['customer', id]`.

## Testes

| Nível | O que cobre | Requisitos |
| --- | --- | --- |
| Unit (shared) | CustomerCreateSchema: CPF/CNPJ válido/inválido, telefone; `CustomerUpdateSchema.parse({ name })` não devolve `remindersEnabled` | CLI-01.1, CLI-04.1 |
| Integração | criar, duplicado (inclusive arquivado), busca sem acento e por documento mascarado, agregados corretos | CLI-01, CLI-02 |
| Integração | editar documento travado (cobrança / contrato / asaas id); arquivar com itens abertos (DRAFT, contrato PARTIALLY_SIGNED); LEITURA vê mascarado; duas edições seguidas → o Asaas recebe o estado da última | CLI-04, CLI-02.4 |
| Integração (nock) | ensureAsaasCustomer: já tem id / acha por documento / cria / 2 chamadas concorrentes criam 1 | CLI-05 |
| Componente | formulário com validação e duplicado | CLI-01 |

## Changelog

| Data | Mudança |
| --- | --- |
| 07/10/2026 | Versão inicial |
| 07/10/2026 | Revisão: schema de update sem defaults, sync sem jobId fixo (ADR-010), `notificationDisabled` considera o cliente, aviso de endereço |
| 08/10/2026 | Tarefa 1: schema em sintaxe do zod 4 (ADR-014); campos opcionais vazios viram `null` (PATCH: ausente = mantém, `null` = apaga); CEP aceita máscara; UF validada contra as 27 siglas; mensagens em pt-BR; helpers de formatação para exibição |
| 08/10/2026 | Tarefa 2: migration de busca com `f_unaccent` em `BEGIN ATOMIC` e índice `customers_name_search_idx`; expressão de consulta obrigatória documentada acima |
| 08/10/2026 | Tarefa 3: definição dos agregados (alinhada à spec 06), ordenação das listas da ficha, `lookup` devolve também `name` e `archived`, `details.reasons` na trava de documento, LEITURA vê documento mascarado também na ficha; auditoria `customer.create`/`customer.update` com documento mascarado; edição trava a linha (`FOR UPDATE`) |
