# 03 — Cobranças · Design

> Status: **Em revisão** · Implementa: `COB-01` … `COB-12` · Ler junto: `docs/integrations/asaas.md`

## Visão geral

```
ChargesController ──► ChargesService.createFromPlan(customerId, plan, ctx)
                          ├─ ChargePlanCalculator (puro: totais, parcelas, vencimento)   [shared]
                          ├─ CustomersService.ensureAsaasCustomer
                          ├─ AsaasClient (payments / subscriptions)
                          └─ ChargesRepository (Prisma, transações)
ContractsService (spec 07) ─► mesmo createFromPlan com origin = CONTRACT
```

## ChargePlan (shared/schemas/charge-plan.ts)

```ts
export const ChargeItemInputSchema = z.object({
  serviceId: z.string().uuid().optional(),
  description: z.string().trim().min(1).max(120),
  quantity: z.number().int().min(1).max(999),
  unitPriceCents: z.number().int().min(0),
});

export const DueDateRuleSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('FIXED_DATE'), date: IsoDateSchema }),            // 'YYYY-MM-DD'
  z.object({ mode: z.literal('DAYS_AFTER_SIGNATURE'), days: z.number().int().min(0).max(60) }), // só contratos
]);

export const ChargePlanSchema = z.object({
  items: z.array(ChargeItemInputSchema).min(1).max(30),
  type: z.enum(['SINGLE', 'INSTALLMENT', 'RECURRING']),
  billingType: z.enum(['PIX', 'BOLETO', 'CREDIT_CARD', 'UNDEFINED']),
  installmentCount: z.number().int().min(2).max(12).optional(),
  cycle: CycleEnum.optional(),
  endDate: IsoDateSchema.optional(),                       // só RECURRING
  dueDate: DueDateRuleSchema,
  discountCents: z.number().int().min(0).default(0),
  finePct: z.number().min(0).max(10),
  interestPct: z.number().min(0).max(10),
}).superRefine((p, ctx) => {
  if (p.type === 'INSTALLMENT' && !p.installmentCount) ctx.addIssue({ path: ['installmentCount'], code: 'custom', message: 'Informe o número de parcelas' });
  if (p.type === 'RECURRING' && !p.cycle) ctx.addIssue({ path: ['cycle'], code: 'custom', message: 'Informe o ciclo' });
  if (p.type !== 'INSTALLMENT' && p.installmentCount) ctx.addIssue({ path: ['installmentCount'], code: 'custom', message: 'Parcelas só em cobrança parcelada' });
});
export type ChargePlan = z.infer<typeof ChargePlanSchema>;
```

### `calculatePlan(plan, { today, signedAt?, minChargeCents }) → PlanCalculation` (puro, em shared)

1. `subtotal = Σ quantity × unitPriceCents`.
2. `discount ≤ subtotal` senão `DISCOUNT_EXCEEDS_SUBTOTAL`; `total = subtotal − discount`; `total > 0` senão `CHARGE_TOTAL_ZERO`.
3. `firstDue`: `FIXED_DATE` → a data; `DAYS_AFTER_SIGNATURE` → exige `signedAt` (senão `DUE_RULE_REQUIRES_SIGNATURE`) e vale `date(signedAt em SP) + days`.
4. `firstDue < today` → `DUE_DATE_IN_PAST`.
5. Parcelas: `splitInstallments(total, n)`, vencimentos `addMonthsClamped(firstDue, i)`; cada parcela ≥ `minChargeCents` senão `CHARGE_BELOW_MINIMUM`. Avulsa/recorrente: `total ≥ minChargeCents`.
6. `description` = itens "Nome (qtdx)" unidos por " · ", truncado em 500.
7. Retorna `{ subtotalCents, discountCents, totalCents, firstDueDate, installments: [{ number, dueDate, valueCents }], description }`.

O front usa a mesma função para o resumo em tempo real; a API recalcula sempre (nunca confia no total enviado).

## Algoritmo `createFromPlan(customerId, plan, ctx: { origin, contractId?, userId?, signedAt?, idempotencyKey? })`

0. **Idempotência opcional** (usada pelos contratos): se `ctx.idempotencyKey` vier, ela substitui os prefixos gerados abaixo (`SINGLE`: `external_reference = key`; `INSTALLMENT`: `group_key = key` e `"<key>:<n>"`; `RECURRING`: assinatura com `external_reference = key`). Se já existirem registros locais com essa chave, pula a Tx 1 e segue do passo 3 (mesmo caminho do retry); se já estiverem fora de `DRAFT`, devolve os existentes.
1. Carrega cliente; arquivado → `CUSTOMER_ARCHIVED`. `calculatePlan` com `today = todayInSaoPaulo()`.
2. **Tx 1 (local, DRAFT):**
   - `SINGLE`: 1 `charge` (`external_reference = "chg_<uuid>"`) + itens.
   - `INSTALLMENT`: `groupKey = "grp_<uuid>"`; N `charges` com `installment_number`, `installment_count`, `external_reference = "<groupKey>:<n>"`, `group_key`; itens replicados em cada parcela (composição da venda).
   - `RECURRING`: 1 `subscription` (`external_reference = "sub_<uuid>"`, `status = ACTIVE` só após o Asaas) + `subscription_items`.
3. `ensureAsaasCustomer(customerId)`.
4. **Asaas** (fora de transação):
   - `SINGLE`: `listPayments({ externalReference })` → se existir, reutiliza; senão `createPayment({ customer, billingType, value, dueDate, description, externalReference, fine, interest })`.
   - `INSTALLMENT`: `listPayments({ externalReference: groupKey })` → se existir, pega o `installment`; senão `createPayment({ …, installmentCount: n, totalValue: total, dueDate: firstDue, externalReference: groupKey })`. Depois `listPayments({ installment })` e casa por `installmentNumber` (fallback: ordem de `dueDate`). Se os valores do Asaas diferirem do cálculo local, **o Asaas vence** e grava-se o valor dele.
   - `RECURRING`: `createSubscription({ customer, billingType, value: total, nextDueDate: firstDue, cycle, endDate, description, externalReference, fine, interest })`; depois `listPayments({ subscription })` e importa as cobranças retornadas (`origin = SUBSCRIPTION`).
5. **Tx 2:** grava ids Asaas, `status` mapeado (`PENDING|RECEIVED→PAID|CONFIRMED|OVERDUE`), `invoice_url`, `bank_slip_url`, `asaas_installment_id`, `last_error = null`. Origem CONTRACT: `contract_id` em todas as cobranças/assinatura.
6. Best-effort: `getPixQrCode` (PIX/UNDEFINED) e `getIdentificationField` (BOLETO/UNDEFINED) → grava `pix_payload`, `identification_field`. Falha só gera log.
7. Auditoria `charge.create` com ids e total.
8. **Falha no passo 3 ou 4:** grava `last_error`, mantém `DRAFT`, lança `ASAAS_*` com `details.chargeIds`/`subscriptionId`. `POST /charges/:id/retry` reexecuta a partir do passo 3 para o grupo inteiro.

## API

| Método | Rota | Papel | Corpo / query | Resposta | Requisitos |
| --- | --- | --- | --- | --- | --- |
| POST | `/charges/preview` | ADMIN, FIN | `{ customerId, plan }` | `PlanCalculation` + `asaasRequests[]` + `customerWillBeCreated` | COB-01.4 |
| POST | `/charges` | ADMIN, FIN | `{ customerId, plan }` | `{ charges: ChargeDetail[], subscription?: SubscriptionDetail }` 201 | COB-02, 03, 04 |
| GET | `/charges` | todos | `status` (múltiplo), `customerId`, `type`, `billingType`, `dueFrom`, `dueTo`, `search`, `page`, `pageSize`, `sort` | `{ data, meta, summary: { countByStatus, totalCents } }` | COB-06 |
| GET | `/charges/:id` | todos | — | `ChargeDetail` (itens, cliente, irmãs, assinatura, eventos, lembretes) | COB-07.1 |
| GET | `/charges/:id/payment-info` | todos | — | `{ invoiceUrl, bankSlipUrl, pixPayload, pixQrCodeBase64, identificationField }` (busca no Asaas se faltar) | COB-05 |
| POST | `/charges/:id/sync` | ADMIN, FIN | — | `ChargeDetail` | COB-07.2 |
| POST | `/charges/:id/retry` · `/discard` | ADMIN, FIN | — | `ChargeDetail` | COB-12 |
| POST | `/charges/:id/cancel` | ADMIN, FIN | `{ scope: 'SINGLE' \| 'REMAINING_INSTALLMENTS' }` | `ChargeDetail[]` | COB-08 |
| POST | `/charges/:id/refund` | ADMIN | `{ valueCents?, description? }` | `ChargeDetail` | COB-09 |
| POST | `/charges/:id/send` | ADMIN, FIN | `{ channel: 'EMAIL' }` | `{ sentAt }` | COB-10 |
| GET | `/subscriptions` | todos | `status`, `customerId`, `page` | `{ data, meta }` | COB-04.4 |
| GET | `/subscriptions/:id` | todos | — | `SubscriptionDetail` (itens, cobranças) | COB-04.4 |
| POST | `/subscriptions/:id/cancel` | ADMIN, FIN | — | `SubscriptionDetail` | COB-11 |

## Regras das ações

- **Cancelar** (`PENDING|OVERDUE`): `deletePayment` → local `CANCELED` na hora (o webhook `PAYMENT_DELETED` depois é idempotente). `REMAINING_INSTALLMENTS`: itera parcelas abertas do mesmo `group_key`, em sequência, parando no primeiro erro e reportando quais foram canceladas.
- **Estornar** (`PAID|CONFIRMED`, ADMIN): saldo estornável = `value_cents − refunded_cents`; `refundPayment(id, valueCents)`; grava `refund_requested_at`; status muda só pelo webhook.
- **Enviar** (`PENDING|OVERDUE`): delega a `RemindersService.sendManual(chargeId, 'EMAIL')` (spec 08). Enquanto a spec 08 não existir, `MailProvider` + modelo simples, registrando `reminder_logs` com `kind = MANUAL`.
- **Sync**: `getPayment` → passa pelo mesmo `PaymentEventProcessor` (spec 04) como evento `RECONCILE`.
- **Cancelar assinatura**: `deleteSubscription` → `subscriptions.status = CANCELED`; em seguida `listPayments({ subscription })` e aplica status via processador.

## Erros

| Código | HTTP | Quando |
| --- | --- | --- |
| `CHARGE_PLAN_INVALID` | 400 | zod do plano (`details` = issues) |
| `CUSTOMER_ARCHIVED` | 422 | COB-01.6 |
| `CHARGE_TOTAL_ZERO` · `DISCOUNT_EXCEEDS_SUBTOTAL` · `DUE_DATE_IN_PAST` · `CHARGE_BELOW_MINIMUM` · `DUE_RULE_REQUIRES_SIGNATURE` | 422 | COB-01.5, COB-03.4 |
| `CHARGE_NOT_DRAFT` | 409 | retry/discard fora de DRAFT |
| `CHARGE_NOT_CANCELABLE` | 409 | COB-08.3 |
| `CHARGE_NOT_REFUNDABLE` · `REFUND_EXCEEDS_VALUE` | 409 / 422 | COB-09 |
| `CUSTOMER_WITHOUT_EMAIL` | 422 | COB-10.2 |
| `ASAAS_VALIDATION` · `ASAAS_UNAVAILABLE` · `ASAAS_AUTH` · `ASAAS_RATE_LIMITED` | 422 / 502 / 502 / 503 | integração |

## Front

**`/cobrancas/nova`** (protótipo como referência):
- Seção 1 Cliente: combobox com busca (`/customers?search`), "Cadastrar cliente" abre o formulário da spec 01 e seleciona o criado; aviso verde "já existe no Asaas (cus_…)" ou âmbar "será criado no Asaas ao gerar".
- Seção 2 Serviços: chips do catálogo ativo; tabela de itens (descrição, qtd, preço, total, remover); "item livre".
- Seção 3 Condições: segmentado Avulsa/Parcelada/Recorrente; parcelas com stepper 2–12 e lista das parcelas; ciclo e data final; forma de pagamento; vencimento (DatePicker, mínimo hoje); desconto, multa, juros.
- Lateral: resumo calculado com `calculatePlan` no cliente; bloco "Chamada à API" com o retorno de `/charges/preview` (debounce 500 ms); botão "Gerar cobrança no Asaas" (desabilitado enquanto inválido).
- Resultado: tela de sucesso com IDs, parcelas, link da fatura, Pix e "Ver em Cobranças"/"Criar outra". Em erro do Asaas: mensagem + "Tentar de novo" / "Descartar".
- Query param `?customerId=` pré-seleciona (vindo da ficha).

**`/cobrancas`**: chips de status com contagem (do `summary`), busca, filtros em popover (tipo, forma, período), tabela paginada, rodapé com soma; estado da URL reflete filtros.

**Detalhe** (`Sheet` lateral, rota `/cobrancas/:id` também acessível direto): blocos do COB-07.1; botões conforme estado e papel; confirmações com cliente e valor; timeline de eventos.

**`/assinaturas`**: lista e detalhe com cobranças geradas; "Cancelar recorrência".

Invalidações: criar/cancelar/estornar invalidam `['charges']`, `['charge', id]`, `['customer', customerId]`, `['dashboard']`.

## Testes

| Nível | O que cobre | Requisitos |
| --- | --- | --- |
| Unit (shared) | `calculatePlan`: totais, desconto, mínimo, vencimento no passado, `DAYS_AFTER_SIGNATURE`, parcelas somando o total, fim de mês | COB-01, COB-03.2 |
| Unit (api) | mapeamento plano → payload Asaas (fixtures de saída esperada) | COB-02.2, 02.3, COB-03.3, COB-04.2 |
| Integração (nock) | avulsa feliz; cliente criado no meio; falha → DRAFT → retry sem duplicar; parcelada casa N parcelas (COB-03.1, 03.3); recorrente com ciclo e data final, importa 1ª cobrança (COB-04.1, 04.2) | COB-02, COB-03, COB-04, COB-12 |
| Integração (com spec 04) | `PAYMENT_CREATED` de assinatura importado com itens da assinatura | COB-04.3 |
| Integração | cancelar (estados válidos/ inválidos, restantes do parcelamento), estorno (papel, saldo), envio sem e-mail | COB-08, 09, 10 |
| Integração | lista: filtros combinados, contagem por status, soma | COB-06 |
| Componente | Nova Cobrança: catálogo soma quantidade, troca de tipo, parcelas exibidas, botão desabilitado | COB-01 |
| E2E sandbox (manual, M3) | criar avulsa Pix, pagar no painel sandbox, ver Pago; parcelada 3×; recorrente mensal; cancelar; estornar | todos |

## Changelog

| Data | Mudança |
| --- | --- |
| 07/10/2026 | Versão inicial |
