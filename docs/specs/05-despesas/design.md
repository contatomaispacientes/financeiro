# 05 — Contas a pagar · Design

> Status: **Aprovado** · Implementa: `DSP-01` … `DSP-05`

## Dados

Tabelas `expenses`, `expense_categories`, `expense_recurrences` (data-model.md). Estado "atrasada" é derivado: `status = OPEN AND due_date < todayInSaoPaulo()`.

## API

| Método | Rota | Papel | Corpo / query | Resposta | Requisitos |
| --- | --- | --- | --- | --- | --- |
| GET | `/expenses` | todos | `state=open\|late\|paid\|canceled` (múltiplo), `categoryId`, `dueFrom`, `dueTo`, `search`, `page` | `{ data, meta, summary }` | DSP-05 |
| POST | `/expenses` | ADMIN, FIN | `ExpenseCreate` (+ `repeatMonthly?: boolean`) | `Expense` 201 | DSP-01.1, DSP-03.6 |
| PATCH | `/expenses/:id` | ADMIN, FIN | `ExpenseUpdate` | `Expense` | DSP-01.2 |
| POST | `/expenses/:id/pay` | ADMIN, FIN | `{ paidAt?, paidValueCents?, paymentMethod }` | `Expense` | DSP-02.1 |
| POST | `/expenses/:id/unpay` | ADMIN, FIN | — | `Expense` | DSP-02.2 |
| POST | `/expenses/:id/cancel` | ADMIN, FIN | — | `Expense` | DSP-01.3 |
| POST | `/expenses/:id/attachment` | ADMIN, FIN | multipart `file` | `Expense` | DSP-01.1 |
| GET | `/expenses/:id/attachment` | todos | — | 302 para URL assinada | DSP-NF1 |
| GET/POST/PATCH | `/expense-recurrences`, `/expense-recurrences/:id` | GET todos; escrita ADMIN, FIN | `RecurrenceCreate/Update` | | DSP-03 |
| GET/POST/PATCH | `/expense-categories`, `/expense-categories/:id` | GET todos; escrita ADMIN | `{ name, active }` | | DSP-04 |
| DELETE | `/expense-categories/:id` | ADMIN | — | 204; `CATEGORY_IN_USE` se houver despesa ou recorrência com a categoria (sugerir desativar) | DSP-04.1 |

`summary` = `{ openCents, lateCents, paidThisMonthCents, monthTotalCents, countByState }` calculado para o mês corrente, independente do filtro de página.

## Schemas (shared/schemas/expense.ts)

```ts
export const PaymentMethodEnum = z.enum(['PIX', 'BOLETO', 'CARTAO', 'TRANSFERENCIA', 'DINHEIRO', 'DEBITO_AUTOMATICO']);
export const ExpenseCreateSchema = z.object({
  description: z.string().trim().min(2).max(120),
  categoryId: z.string().uuid(),
  supplier: z.string().max(120).optional(),
  valueCents: z.number().int().positive(),
  dueDate: IsoDateSchema,
  notes: z.string().max(2000).optional(),
  repeatMonthly: z.boolean().default(false),
});
export const ExpensePaySchema = z.object({
  paidAt: IsoDateSchema.optional(),
  paidValueCents: z.number().int().positive().optional(),
  paymentMethod: PaymentMethodEnum,
});
export const RecurrenceCreateSchema = z.object({
  description: z.string().trim().min(2).max(120), categoryId: z.string().uuid(), supplier: z.string().max(120).optional(),
  valueCents: z.number().int().positive(), dayOfMonth: z.number().int().min(1).max(31),
  startMonth: YearMonthSchema, endMonth: YearMonthSchema.optional(),
});
```

## Regras

**Geração de recorrências** — `ExpenseRecurrenceService.generateFor(month: 'YYYY-MM')`:
1. Seleciona recorrências `active` com `start_month ≤ month` e (`end_month` nulo ou `≥ month`).
2. Para cada uma: `dueDate = clampDay(month, dayOfMonth)`; `INSERT … ON CONFLICT (recurrence_id, reference_month) DO NOTHING` copiando descrição, categoria, fornecedor, valor.
3. Atualiza `last_generated_for = month`.
- Cron diário 05:00 (`expense-recurrence`) chama `generateFor(mês corrente)` — diário para cobrir falhas; a unicidade garante "uma vez por mês".
- Criação de recorrência chama `generateFor(mês corrente)` só para ela (DSP-03.3).
- `repeatMonthly` no POST /expenses: transação cria a recorrência (dia = dia do vencimento, início = mês do vencimento) e a despesa com `recurrence_id` e `reference_month`.

**Pagamento**: só de `OPEN`; `unpay` só de `PAID`; `cancel` só de `OPEN`. Fora disso → `EXPENSE_INVALID_STATE`.

## Erros

| Código | HTTP | Quando |
| --- | --- | --- |
| `EXPENSE_NOT_EDITABLE` | 409 | DSP-01.2 |
| `EXPENSE_INVALID_STATE` | 409 | pagar/desfazer/cancelar fora do estado |
| `CATEGORY_INACTIVE` | 422 | lançar com categoria desativada |
| `CATEGORY_IN_USE` | 409 | excluir categoria usada |
| `ATTACHMENT_TOO_LARGE` · `ATTACHMENT_TYPE` | 422 | anexo inválido |

## Front

- `/despesas`: KPIs (4 cards), chips de situação com contagem, filtros, tabela com ação inline "Marcar paga" (abre popover com data, valor, forma) e "Desfazer".
- Sheet "Nova despesa": categoria em chips/select, `MoneyInput`, vencimento, "Repetir todo mês".
- Aba "Recorrentes" na mesma tela: lista, editar, pausar, encerrar.
- Configurações › Categorias (ADMIN).

## Testes

| Nível | O que cobre | Requisitos |
| --- | --- | --- |
| Unit | `clampDay` (31 → 28/29/30), estado derivado "atrasada" com fuso | DSP-02.3, DSP-03.2 |
| Integração | CRUD, estados de pagamento, cancelamento, auditoria | DSP-01, DSP-02 |
| Integração | geração idempotente (rodar 2× no mesmo mês), mês inicial/final, `repeatMonthly`, alteração não afeta gerada | DSP-03 |
| Integração | summary do mês | DSP-05.2 |

## Changelog

| Data | Mudança |
| --- | --- |
| 07/10/2026 | Versão inicial |
| 07/10/2026 | Revisão: rota de exclusão de categoria (o erro `CATEGORY_IN_USE` não tinha rota) |
