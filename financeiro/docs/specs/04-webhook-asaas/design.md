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
if (inserted) enqueueUnique(queue, 'apply', { webhookEventId }, `evt_${webhookEventId}`, { attempts: 5, backoff: { type: 'exponential', delay: 10_000 } }); // ADR-010
return 200 { received: true };
```

Se o Redis estiver fora do ar no momento do enfileiramento, o evento fica persistido sem `processed_at`; um job de varredura a cada 10 min (`asaas-events-sweeper`) reenfileira eventos com `processed_at IS NULL AND attempts < 5 AND received_at < now() - 2 min`.

## Processamento — `PaymentEventProcessor.apply(webhookEventId)`

1. Carrega o evento; se `processed_at` já existe → retorna (idempotência extra).
2. `attempts += 1`.
3. `payment = payload.payment`. Eventos sem `payment` → `result = IGNORED`.
4. **Localiza** (WHK-02.2): `asaas_payment_id` → `external_reference = payment.externalReference` → parcela: (`group_key = payment.externalReference` **ou** `asaas_installment_id = payment.installment`) e `installment_number = payment.installmentNumber` (o Asaas recebe `grp_x`, mas o espelho local guarda `grp_x:n`; o id do parcelamento pode ainda não estar gravado) → se `payment.subscription` existir em `subscriptions` → **importa**: cria `charge` com `origin = SUBSCRIPTION`, `type = RECURRING`, itens copiados de `subscription_items`, `contract_id` da assinatura, `external_reference = "<sub ext ref>:<pay id>"`; violação de unicidade em `asaas_payment_id` (a criação da assinatura importou a mesma cobrança em paralelo) → relocaliza e segue como cobrança existente. Não achou: se `now() − received_at < 5 min` → lança `RESOURCE_NOT_YET_KNOWN` (o BullMQ tenta de novo em 10 s, 20 s, 40 s… — cobre o webhook chegando antes da Tx 2 da criação); senão `result = UNKNOWN_RESOURCE`, `processed_at = now()`.
5. **Transição** (tabela de `asaas.md` + mapa de `overview.md`): calcula `nextStatus`. Se não permitida a partir do status atual → `result = IGNORED_TRANSITION`. Auto-transições aplicadas: `PARTIALLY_REFUNDED → PARTIALLY_REFUNDED` (novo estorno parcial) e `PAYMENT_UPDATED` sem mudança de status.
6. **Aplica** em transação com `SELECT … FOR UPDATE` na cobrança: status, `paid_at` (`paymentDate` ou `clientPaymentDate`), `net_value_cents` (`netValue`), `value_cents` e `due_date` (em `PAYMENT_UPDATED`), `invoice_url`, `bank_slip_url`, `billing_type`, `refunded_cents`, `last_event_at = dateCreated`. Assinatura: atualiza `next_due_date` com a maior data de vencimento em aberto.
   Em `PAYMENT_REFUNDED`/`PAYMENT_PARTIALLY_REFUNDED`: insere `charge_refunds` com `kind = REFUND` (`value_cents` = valor estornado deste evento — campo exato confirmado nas fixtures do sandbox; fallback: `value − refunded_cents` anterior no estorno total; `refunded_at` = data do evento em SP; único por `webhook_event_id`) e soma em `charges.refunded_cents`.
   Em `PAYMENT_CHARGEBACK_REQUESTED`: insere `charge_refunds` com `kind = CHARGEBACK`, valor `value_cents − refunded_cents`. Na reversão confirmada (evento a validar no sandbox): `kind = CHARGEBACK_REVERSAL` com o mesmo valor e status volta a `PAID` (ADR-011, WHK-02.7).
7. `result = APPLIED | IMPORTED`, `processed_at = now()`, `error = null`.
8. Exceção → grava `error` (mensagem curta) e relança para o BullMQ tentar de novo.
9. Ganchos pós-aplicação (eventos de domínio internos via `EventEmitter2`), só quando o status mudou: `charge.paid`, `charge.overdue`, `charge.refunded`, `charge.canceled`; e `charge.created` na importação de cobrança de assinatura — consumidos pela régua (spec 08) e pelo dashboard (invalidação).

`PAYMENT_UPDATED` com status no payload diferente do local também atualiza o status, respeitando o mapa.

## Reconciliação — `ReconcileService.run({ trigger: 'CRON' | 'MANUAL', userId? })`

1. Busca cobranças locais com `asaas_payment_id`, em lotes de 50: `status IN (PENDING, OVERDUE, CONFIRMED)`; `status IN (PAID, PARTIALLY_REFUNDED, CHARGEBACK)` com `paid_at ≥ hoje − 120 dias`; `status = CANCELED` com `updated_at ≥ hoje − 30 dias` (WHK-04.1).
2. Para cada uma (concorrência 3, `p-limit`): `getPayment(id)`. Se `status`/`value`/`dueDate`/`paymentDate`/`refundedValue` divergem do espelho → cria `webhook_events` com `source = RECONCILE`, `external_event_id = "rec:<pay>:<status>:<value>:<dueDate>:<yyyy-mm-dd>"` (é chave do banco, não `jobId` — `:` permitido), `event = "RECONCILE_<STATUS_ASAAS>"`, payload `{ payment }` e processa direto (sem fila). Mapeamento: status do Asaas diferente do local → evento equivalente (`RECEIVED → PAYMENT_RECEIVED`, `REFUNDED → PAYMENT_REFUNDED`, `CHARGEBACK_REQUESTED → PAYMENT_CHARGEBACK_REQUESTED`, `PENDING` vindo de `CANCELED` → `PAYMENT_RESTORED`…); mesmo status, só valor/vencimento/URLs diferentes → `PAYMENT_UPDATED` (nunca vira `IGNORED_TRANSITION`).
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
| POST | `/webhook-events/:id/reprocess` | ADMIN | — | evento atualizado (zera `attempts`, chama `requeue` do ADR-010: remove o job `evt_<id>` falho/concluído e enfileira de novo) | WHK-03.2 |
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
| Unit | tabela de transições: todas as permitidas (inclui 2 estornos parciais seguidos e parcial → total, chargeback → reversão) e exemplos de ignoradas (OVERDUE após RECEIVED) | WHK-02.3 |
| Integração | cada evento da tabela aplica o efeito certo (fixtures reais); localização por externalReference e por parcela (`grp_x` → `grp_x:n` sem `asaas_installment_id`); importação de assinatura e importação concorrente; evento recente sem recurso → retry, antigo → UNKNOWN_RESOURCE; `charge_refunds` com REFUND/CHARGEBACK | WHK-02.1–02.4, 02.6, 02.7 |
| Integração | falha simulada → 5 retries esgotados → erro visível → reprocessar executa de novo (job falho removido) | WHK-02.5, WHK-03.2 |
| Integração (nock) | reconciliação corrige divergência de status e só de valor/vencimento (`PAYMENT_UPDATED`), pega estorno feito no painel em cobrança `PAID`, importa cobrança de assinatura, respeita concorrência | WHK-04 |
| E2E sandbox | pagar cobrança no painel do sandbox e ver o status mudar sozinho | WHK-01–02 |

## Changelog

| Data | Mudança |
| --- | --- |
| 07/10/2026 | Versão inicial |
| 07/10/2026 | Revisão: jobId `evt_` + reprocessar com `requeue` (ADR-010), localização de parcela por `group_key`, retry para evento antes da criação terminar, upsert na importação, estornos parciais sucessivos, chargeback em `charge_refunds` (ADR-011), reconciliação ampliada e `PAYMENT_UPDATED` para divergência sem mudança de status |
