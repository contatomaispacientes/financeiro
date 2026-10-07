# 04 — Webhook e reconciliação Asaas · Design

> Status: **Em revisão** · Implementa: `WHK-01` … `WHK-04`

## Componentes

```
WebhooksController (público)
  ├─ POST /webhooks/asaas            → AsaasWebhookGuard → WebhookInbox.store('ASAAS', …) → 200
  └─ POST /webhooks/contracts/:prov  → (spec 07)
WebhookInbox            persiste com ON CONFLICT DO NOTHING; enfileira se inseriu
AsaasEventsProcessor    (BullMQ, fila asaas-events) → PaymentEventProcessor.apply(event)
PaymentEventProcessor   localiza/importa cobrança, valida transição, aplica, marca resultado
ReconcileService        cron 06:00 + sob demanda → gera eventos RECONCILE → PaymentEventProcessor
WebhookEventsController GET/POST /webhook-events (ADMIN)
```

## Recepção

```ts
// AsaasWebhookGuard
const token = req.headers['asaas-access-token'];
if (!token || !timingSafeEqual(Buffer.from(token), Buffer.from(env.ASAAS_WEBHOOK_TOKEN))) throw new UnauthorizedException();

// WebhookInbox.store
const parsed = AsaasWebhookBodySchema.safeParse(body); // { id: string, event: string, dateCreated?, payment?: { id, ... } }
if (!parsed.success) → 400
INSERT INTO webhook_events (source, external_event_id, event, resource_id, payload)
VALUES ('ASAAS', body.id, body.event, body.payment?.id, body)
ON CONFLICT (source, external_event_id) DO NOTHING RETURNING id;
if (inserted) queue.add('apply', { webhookEventId }, { jobId: webhookEventId, attempts: 5, backoff: { type: 'exponential', delay: 10_000 } });
return 200 { received: true };
```

Se o Redis estiver fora do ar no momento do enfileiramento, o evento fica persistido sem `processed_at`; um job de varredura a cada 10 min (`asaas-events-sweeper`) reenfileira eventos com `processed_at IS NULL AND attempts < 5 AND received_at < now() - 2 min`.

## Processamento — `PaymentEventProcessor.apply(webhookEventId)`

1. Carrega o evento; se `processed_at` já existe → retorna (idempotência extra).
2. `attempts += 1`.
3. `payment = payload.payment`. Eventos sem `payment` → `result = IGNORED`.
4. **Localiza** (WHK-02.2): `asaas_payment_id` → `external_reference` → (`payment.installment` + `installmentNumber`) → se `payment.subscription` existir em `subscriptions` → **importa**: cria `charge` com `origin = SUBSCRIPTION`, `type = RECURRING`, itens copiados de `subscription_items`, `contract_id` da assinatura, `external_reference = "<sub ext ref>:<pay id>"`. Não achou → `result = UNKNOWN_RESOURCE`, `processed_at = now()`.
5. **Transição** (tabela de `asaas.md` + mapa de `overview.md`): calcula `nextStatus`. Se não permitida a partir do status atual → `result = IGNORED_TRANSITION`.
6. **Aplica** em transação com `SELECT … FOR UPDATE` na cobrança: status, `paid_at` (`paymentDate` ou `clientPaymentDate`), `net_value_cents` (`netValue`), `value_cents` e `due_date` (em `PAYMENT_UPDATED`), `invoice_url`, `bank_slip_url`, `billing_type`, `refunded_cents`, `last_event_at = dateCreated`. Assinatura: atualiza `next_due_date` com a maior data de vencimento em aberto.
   Em `PAYMENT_REFUNDED`/`PAYMENT_PARTIALLY_REFUNDED`: insere `charge_refunds` (`value_cents` = valor estornado deste evento — campo exato confirmado nas fixtures do sandbox; fallback: `value − refunded_cents` anterior no estorno total; `refunded_at` = data do evento em SP; único por `webhook_event_id`) e soma em `charges.refunded_cents`.
7. `result = APPLIED | IMPORTED`, `processed_at = now()`, `error = null`.
8. Exceção → grava `error` (mensagem curta) e relança para o BullMQ tentar de novo.
9. Ganchos pós-aplicação (eventos de domínio internos via `EventEmitter2`): `charge.paid`, `charge.overdue` — consumidos pela régua (spec 08) e pelo dashboard (invalidação).

`PAYMENT_UPDATED` com status no payload diferente do local também atualiza o status, respeitando o mapa.

## Reconciliação — `ReconcileService.run({ trigger: 'CRON' | 'MANUAL', userId? })`

1. Busca cobranças locais `status IN (PENDING, OVERDUE, CONFIRMED)` com `asaas_payment_id`, em lotes de 50.
2. Para cada uma (concorrência 3, `p-limit`): `getPayment(id)`. Se `status`/`value`/`dueDate`/`paymentDate` divergem do espelho → cria `webhook_events` com `source = RECONCILE`, `external_event_id = "rec:<pay>:<status>:<yyyy-mm-dd>"`, `event = "RECONCILE_<STATUS_ASAAS>"`, payload `{ payment }` e processa direto (sem fila) mapeando `RECONCILE_RECEIVED → PAYMENT_RECEIVED` etc.
3. Para cada `subscriptions.status = ACTIVE`: `listPayments({ subscription })`, importa as ausentes (via o mesmo processador).
4. Cobranças `DRAFT` com mais de 24 h → relatório (não altera).
5. Retorna e grava em log de auditoria `reconcile.run` o resumo `{ checked, fixed, imported, errors }`.

Cron via BullMQ repeatable `{ pattern: '0 6 * * *', tz: 'America/Sao_Paulo' }`.

## API

| Método | Rota | Papel | Corpo / query | Resposta | Requisitos |
| --- | --- | --- | --- | --- | --- |
| POST | `/webhooks/asaas` | público + token | corpo do Asaas | `{ received: true }` | WHK-01 |
| GET | `/webhook-events` | ADMIN | `source`, `event`, `state=processed\|pending\|error\|ignored`, `resourceId`, `from`, `to`, `page` | `{ data, meta }` | WHK-03.1 |
| GET | `/webhook-events/:id` | ADMIN | — | evento com payload | WHK-03.1 |
| POST | `/webhook-events/:id/reprocess` | ADMIN | — | evento atualizado | WHK-03.2 |
| GET | `/webhook-events/health` | ADMIN | — | `{ oldestPendingMinutes, lastReceivedAt, errorsLast24h }` | WHK-03.3 |
| POST | `/reconcile` | ADMIN | — | resumo | WHK-04.4 |

`GET /charges/:id` (spec 03) inclui `events` = `webhook_events` com `resource_id = asaas_payment_id`, ordem decrescente (WHK-03.4).

## Erros

| Código | HTTP | Quando |
| --- | --- | --- |
| `WEBHOOK_UNAUTHORIZED` | 401 | WHK-01.2 |
| `WEBHOOK_INVALID_BODY` | 400 | WHK-01.5 |
| `EVENT_ALREADY_PROCESSED` | 409 | reprocessar evento já aplicado sem erro |

## Front

- `/configuracoes/webhooks`: tabela com data, origem, evento, recurso (link para cobrança/contrato), situação (badge), tentativas, erro; filtro; "Reprocessar"; drawer com payload formatado.
- Card de saúde em Configurações › Integrações (WHK-03.3) e botão "Reconciliar agora" com resumo em toast/modal.
- Detalhe da cobrança: timeline de eventos com rótulo em português (ex.: "Pagamento recebido") e o tipo técnico em cinza.

## Testes

| Nível | O que cobre | Requisitos |
| --- | --- | --- |
| Integração | token ausente/errado → 401 sem gravar; corpo inválido → 400; duplicado → 200 sem 2º job | WHK-01 |
| Unit | tabela de transições: todas as permitidas e exemplos de ignoradas (OVERDUE após RECEIVED) | WHK-02.3 |
| Integração | cada evento da tabela aplica o efeito certo (fixtures reais); localização por externalReference e por parcela; importação de assinatura; UNKNOWN_RESOURCE | WHK-02.1–02.4, 02.6 |
| Integração | falha simulada → retries → erro visível → reprocessar | WHK-02.5, WHK-03.2 |
| Integração (nock) | reconciliação corrige divergência, importa cobrança de assinatura, respeita concorrência | WHK-04 |
| E2E sandbox | pagar cobrança no painel do sandbox e ver o status mudar sozinho | WHK-01–02 |

## Changelog

| Data | Mudança |
| --- | --- |
| 07/10/2026 | Versão inicial |
