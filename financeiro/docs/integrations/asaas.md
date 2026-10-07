# Integração Asaas (API v3)

> Referência oficial: https://docs.asaas.com · Sempre conferir campos no sandbox antes de implementar; registrar payloads reais em `apps/api/test/fixtures/asaas/`.

## Ambiente e autenticação

| | Sandbox | Produção |
| --- | --- | --- |
| Base URL | `https://api-sandbox.asaas.com/v3` | `https://api.asaas.com/v3` |
| Header | `access_token: <ASAAS_API_KEY>` | idem |

Headers adicionais: `Content-Type: application/json`, `User-Agent: financeiro/<versão>`. Timeout 15 s; retry só em erro de rede/5xx/429 (3×, backoff 1s/3s/9s); **nunca** repetir `POST /payments` sem antes buscar por `externalReference` (evita duplicar).

## `AsaasClient` (interface interna)

```ts
interface AsaasClient {
  findCustomerByDocument(cpfCnpj: string): Promise<AsaasCustomer | null>;  // GET /customers?cpfCnpj=
  createCustomer(input: AsaasCustomerInput): Promise<AsaasCustomer>;        // POST /customers
  updateCustomer(id: string, input: Partial<AsaasCustomerInput>): Promise<AsaasCustomer>; // PUT /customers/{id}

  createPayment(input: AsaasPaymentInput): Promise<AsaasPayment>;           // POST /payments (avulsa ou parcelada)
  getPayment(id: string): Promise<AsaasPayment>;                            // GET /payments/{id}
  listPayments(filter: { externalReference?: string; installment?: string; subscription?: string; offset?: number; limit?: number }): Promise<Page<AsaasPayment>>;
  deletePayment(id: string): Promise<void>;                                 // DELETE /payments/{id}
  refundPayment(id: string, valueCents?: number, description?: string): Promise<AsaasPayment>; // POST /payments/{id}/refund
  getPixQrCode(id: string): Promise<{ encodedImage: string; payload: string; expirationDate?: string }>; // GET /payments/{id}/pixQrCode
  getIdentificationField(id: string): Promise<{ identificationField: string; barCode: string }>;       // GET /payments/{id}/identificationField

  createSubscription(input: AsaasSubscriptionInput): Promise<AsaasSubscription>; // POST /subscriptions
  getSubscription(id: string): Promise<AsaasSubscription>;
  deleteSubscription(id: string): Promise<void>;                                  // DELETE /subscriptions/{id}

  ping(): Promise<{ ok: boolean; latencyMs: number }>;                     // GET /finance/balance (só verifica 200)
}
```

Valores na interface interna são **centavos**; a implementação converte para decimal na borda.

## Mapeamento ChargePlan → Asaas

| ChargePlan | Asaas | Observação |
| --- | --- | --- |
| `type: SINGLE` | `POST /payments` com `value`, `dueDate` | |
| `type: INSTALLMENT`, `installmentCount: n` | `POST /payments` com `installmentCount: n` e `totalValue` | Depois `GET /payments?installment=<id>` para obter as N cobranças e casar por `installmentNumber`/`dueDate` |
| `type: RECURRING`, `cycle` | `POST /subscriptions` com `value`, `nextDueDate`, `cycle` | As cobranças de cada ciclo chegam por webhook com o campo `subscription` |
| `billingType` | `PIX` \| `BOLETO` \| `CREDIT_CARD` \| `UNDEFINED` | `UNDEFINED` = cliente escolhe na fatura |
| `discountCents` | **abatido do valor** antes de enviar | O campo `discount` do Asaas é desconto por pagamento antecipado — não usar na v1 |
| `finePct` | `fine: { value, type: 'PERCENTAGE' }` | |
| `interestPct` | `interest: { value }` (% ao mês) | |
| itens | `description` (até 500 caracteres): "Serviço A (2x) · Serviço B (1x)" | Truncar com "…" |
| id local | `externalReference` | `charges.external_reference` ou `subscriptions.external_reference` |

Validar no sandbox na tarefa COB: `totalValue` vs `installmentValue` no parcelamento e o valor mínimo por cobrança (`ASAAS_MIN_CHARGE_CENTS`, padrão R$ 5,00).

## Garantir cliente no Asaas (`ensureAsaasCustomer`)

1. Se `customers.asaas_customer_id` existe → usa.
2. Senão `GET /customers?cpfCnpj=<dígitos>`; achou (não removido) → grava o id e usa.
3. Senão `POST /customers` com `name`, `cpfCnpj`, `email`, `mobilePhone`, `externalReference = customers.id`, `notificationDisabled` conforme régua (ver spec 08) → grava o id.
4. Executar com lock por cliente (`pg_advisory_xact_lock(hash(customer_id))`) para não criar dois em paralelo.

## Webhook

- URL: `POST /api/v1/webhooks/asaas` (pública).
- Autenticação: header `asaas-access-token` deve ser igual a `ASAAS_WEBHOOK_TOKEN` (comparação em tempo constante). Diferente → 401 sem persistir.
- Corpo: `{ id, event, dateCreated, payment: {…} }`. `id` é a chave de idempotência.
- Entrega "pelo menos uma vez"; após 15 falhas consecutivas a fila do Asaas é pausada; eventos com mais de 14 dias na fila são descartados → responder 200 rápido sempre que o evento for persistido.
- Habilitar no painel do Asaas (sandbox e produção) os eventos de **cobrança** abaixo, envio **sequencial**.

| Evento | Ação local |
| --- | --- |
| `PAYMENT_CREATED` | Se a cobrança não existe localmente e tem `subscription` conhecido → importa (`origin = SUBSCRIPTION`, itens copiados da assinatura). Se existe → garante `PENDING`, atualiza URLs |
| `PAYMENT_UPDATED` | Atualiza valor, vencimento, forma, URLs |
| `PAYMENT_CONFIRMED` | → `CONFIRMED`, `paid_at = confirmedDate/paymentDate` |
| `PAYMENT_RECEIVED` | → `PAID`, `paid_at = paymentDate`, `net_value_cents` |
| `PAYMENT_OVERDUE` | → `OVERDUE` |
| `PAYMENT_DELETED` | → `CANCELED` |
| `PAYMENT_RESTORED` | → `PENDING` (ou `OVERDUE` se vencida) |
| `PAYMENT_REFUNDED` | → `REFUNDED`, `refunded_cents = value` |
| `PAYMENT_PARTIALLY_REFUNDED` | → `PARTIALLY_REFUNDED`, soma `refunded_cents` |
| `PAYMENT_CHARGEBACK_REQUESTED` / `PAYMENT_CHARGEBACK_DISPUTE` | → `CHARGEBACK` |
| `PAYMENT_CHECKOUT_VIEWED`, `PAYMENT_BANK_SLIP_VIEWED` | Só registra (aparece no histórico) |
| `PAYMENT_REFUND_IN_PROGRESS`, `PAYMENT_AWAITING_RISK_ANALYSIS`, demais | Só registra |

Localização da cobrança local, nesta ordem: `asaas_payment_id = payment.id` → `external_reference = payment.externalReference` → (se `payment.installment`) grupo do parcelamento por `installmentNumber` → (se `payment.subscription`) importação. Não encontrada → `result = UNKNOWN_RESOURCE` (não é erro; aparece no log).

## Erros do Asaas → erros de domínio

| HTTP Asaas | Código interno | HTTP para o front |
| --- | --- | --- |
| 400 com `errors[]` | `ASAAS_VALIDATION` (mensagens do Asaas em `details`) | 422 |
| 401/403 | `ASAAS_AUTH` | 502 |
| 404 | `ASAAS_NOT_FOUND` | 404/409 conforme o caso |
| 429 | `ASAAS_RATE_LIMITED` (após retries) | 503 |
| 5xx / timeout | `ASAAS_UNAVAILABLE` | 502 |

## Runbook

- **Trocar token do webhook**: gerar valor novo → atualizar no painel do Asaas → atualizar `ASAAS_WEBHOOK_TOKEN` → reiniciar API → conferir evento de teste no log. Entre os passos 2 e 3 os eventos falham com 401; o Asaas reenvia (ou a reconciliação corrige).
- **Fila do Asaas pausada**: corrigir causa → reativar a fila no painel do Asaas → rodar "Reconciliar agora".
- **Ir para produção**: ver tarefa final do roadmap (spec 00, seção Produção).
