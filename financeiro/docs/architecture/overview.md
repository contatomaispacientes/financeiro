# Arquitetura

> Status: **Aprovado**

## Contexto

```mermaid
flowchart LR
  U[Usuário interno<br/>ADMIN / FINANCEIRO / LEITURA] --> WEB[apps/web<br/>React SPA]
  WEB -->|REST /api/v1| API[apps/api<br/>NestJS]
  API --> PG[(PostgreSQL)]
  API --> RD[(Redis<br/>BullMQ)]
  API -->|REST access_token| ASAAS[Asaas API v3]
  ASAAS -->|webhook asaas-access-token| API
  API -->|REST JSON:API v3| CP[Clicksign<br/>via ContractProvider]
  CP -->|webhook| API
  API -->|SMTP| MAIL[E-mail]
  API --> ST[(Storage<br/>local / S3)]
  CLI[Cliente final] -->|link da fatura| ASAAS
  CLI -->|link de assinatura| CP
```

## Módulos da API

| Módulo | Responsabilidade | Depende de |
| --- | --- | --- |
| `auth`, `users` | Login, refresh, papéis | — |
| `settings` | Padrões financeiros, régua, status das integrações | — |
| `audit` | Registro de ações sensíveis | — |
| `customers` | Cadastro e garantia do cliente no Asaas (`ensureAsaasCustomer`) | `integrations/asaas` |
| `services` | Catálogo | — |
| `charges` | Plano de cobrança → cobrança/parcelamento/assinatura no Asaas; ações | `customers`, `integrations/asaas` |
| `subscriptions` | Espelho das recorrências | `integrations/asaas` |
| `webhooks` | Recebe, persiste e enfileira eventos (Asaas e contratos) | filas |
| `payment-events` | Processa eventos do Asaas → status de cobrança | `charges`, `subscriptions` |
| `contracts` | Modelos, contratos, signatários; ao assinar → `charges.createFromPlan` | `customers`, `charges`, `integrations/contracts`, `storage` |
| `expenses` | Despesas, categorias, recorrência | — |
| `reports` | Dashboard, fluxo de caixa, extrato (somente leitura) | `charges`, `expenses` |
| `reminders` | Régua de cobrança | `charges`, `integrations/mail`, `settings` |

## Filas (BullMQ)

| Fila | Produzida por | Job | Retry |
| --- | --- | --- | --- |
| `asaas-events` | `POST /webhooks/asaas` | processa 1 `webhook_event` | 5×, backoff exponencial |
| `asaas-events-sweeper` | cron a cada 10 min | reenfileira eventos persistidos e não processados | — |
| `asaas-customer-sync` | edição de cliente ou da chave de lembretes (specs 01, 08) | `PUT /customers/{id}` no Asaas com o estado atual do cliente (sem `jobId` fixo — ADR-010) | 5× |
| `asaas-notification-sync` | ligar/desligar canal ASAAS da régua (spec 08) | atualiza `notificationDisabled` dos clientes em lote | 3× |
| `contract-events` | `POST /webhooks/contracts/:provider` | processa 1 evento de contrato | 5× |
| `contract-charge` | contrato assinado | `charges.createFromPlan(origin=CONTRACT, idempotencyKey)` | 5×; idempotente por `charge_generated_at` + chave |
| `contract-file` | contrato assinado | baixa o PDF assinado para o storage | 5× |
| `contract-expiration` | cron diário 07:00 | expira contratos com validade vencida | 3× |
| `asaas-reconcile` | cron diário 06:00 | busca no Asaas cobranças locais não finais e corrige divergências | 3× |
| `reminders` | cron diário 09:00 + eventos `charge.paid`/`charge.created_from_contract` | gera e envia lembretes do dia e mensagens de evento | 3× por lembrete |
| `expense-recurrence` | cron diário 05:00 | cria despesas das recorrências do mês corrente | 3× |
| `maintenance` | cron mensal | retenção de `webhook_events` (18 meses) | — |

## Fluxo 1 — Cobrança direta

```mermaid
sequenceDiagram
  actor U as Usuário
  participant W as Web
  participant A as API
  participant AS as Asaas
  U->>W: Nova cobrança (cliente, itens, condições)
  W->>A: POST /charges/preview
  A-->>W: totais + payload que será enviado
  U->>W: Gerar
  W->>A: POST /charges (ChargePlan)
  A->>A: valida plano, cria charges DRAFT + itens (transação)
  A->>AS: GET /customers?cpfCnpj (se cliente sem asaas id)
  A->>AS: POST /customers (se não existir)
  A->>AS: POST /payments ou /subscriptions
  AS-->>A: id pay_/sub_/installment, invoiceUrl, status
  A->>A: atualiza espelho (PENDING), busca Pix/linha digitável
  A-->>W: cobrança(s) criada(s)
  AS-)A: webhook PAYMENT_CREATED / RECEIVED / OVERDUE...
  A->>A: persiste evento → 200 → fila → atualiza status
```

Falha no Asaas após criar o rascunho: a cobrança fica `DRAFT` com `last_error`; o usuário pode "tentar de novo" (reusa o mesmo `externalReference`, sem duplicar) ou descartar.

## Fluxo 2 — Contrato → cobrança

```mermaid
sequenceDiagram
  actor U as Usuário
  participant A as API
  participant CP as Clicksign
  participant AS as Asaas
  U->>A: POST /contracts (cliente, modelo, ChargePlan, signatários)
  A->>A: contrato DRAFT + snapshot das variáveis
  U->>A: POST /contracts/:id/send
  A->>CP: envelope → documento (modelo + variáveis) → signatários → requisitos → ativar
  CP-->>A: ids (gravados a cada passo para retomada)
  A->>A: status SENT
  CP-)A: webhook sign (cada signatário, Content-Hmac)
  A->>A: PARTIALLY_SIGNED
  CP-)A: webhook auto_close / document_closed
  A->>A: SIGNED, baixa PDF assinado → storage
  A->>A: enfileira contract-charge
  A->>AS: charges.createFromPlan(origin=CONTRACT)
  A->>A: contract.charge_generated_at, vínculo charge.contract_id
```

Regra de vencimento na geração pós-assinatura (CTR-05.2): calcula a data pelo plano — "N dias após a assinatura" → `signed_at + N`; "data fixa" → a data. Se a data resultante for anterior a hoje (data fixa já passou, ou a geração foi refeita dias depois da assinatura), usa `hoje + contract_charge_due_days`.

## Fluxo 3 — Webhook (qualquer origem)

1. Validar autenticação (token/assinatura). Inválido → 401, nada persistido.
2. `INSERT webhook_events … ON CONFLICT (source, external_event_id) DO NOTHING`.
3. Responder **200** imediatamente (mesmo se duplicado).
4. Se inseriu, enfileirar o processamento com `jobId = "evt_" + webhook_event.id` (ADR-010: sem `:`; "Reprocessar" remove o job falho antes de reenfileirar).
5. Worker aplica a regra; grava `processed_at` ou `error` + `attempts`.
6. Evento que falhar 5× fica visível no log com botão "Reprocessar".

## Fluxo 4 — Reconciliação diária

Para toda cobrança local com `asaas_payment_id` em `PENDING`, `OVERDUE` ou `CONFIRMED`, e também `PAID`, `PARTIALLY_REFUNDED` e `CHARGEBACK` pagas nos últimos 120 dias e `CANCELED` nos últimos 30 dias (para pegar estorno, chargeback e restauração feitos direto no painel do Asaas): `GET /payments/{id}`, comparar status, valor, vencimento e data de pagamento; divergência → registra `webhook_events` sintético com `source = RECONCILE` e aplica pelo mesmo processador (mudança só de valor/vencimento é tratada como `PAYMENT_UPDATED`). Também importa cobranças de assinaturas que o webhook não trouxe (`GET /payments?subscription=…`).

## Mapa de status de cobrança

```mermaid
stateDiagram-v2
  [*] --> DRAFT
  DRAFT --> PENDING: Asaas aceitou
  DRAFT --> CANCELED: descartar
  PENDING --> CONFIRMED: PAYMENT_CONFIRMED (cartão)
  PENDING --> PAID: PAYMENT_RECEIVED
  PENDING --> OVERDUE: PAYMENT_OVERDUE
  OVERDUE --> PAID: PAYMENT_RECEIVED
  OVERDUE --> CONFIRMED: PAYMENT_CONFIRMED
  CONFIRMED --> PAID: PAYMENT_RECEIVED
  PENDING --> CANCELED: PAYMENT_DELETED
  OVERDUE --> CANCELED: PAYMENT_DELETED
  CANCELED --> PENDING: PAYMENT_RESTORED
  PAID --> REFUNDED: PAYMENT_REFUNDED
  CONFIRMED --> REFUNDED: PAYMENT_REFUNDED
  PAID --> PARTIALLY_REFUNDED: PAYMENT_PARTIALLY_REFUNDED
  PARTIALLY_REFUNDED --> PARTIALLY_REFUNDED: PAYMENT_PARTIALLY_REFUNDED (novo estorno parcial)
  PARTIALLY_REFUNDED --> REFUNDED: PAYMENT_REFUNDED
  PAID --> CHARGEBACK: PAYMENT_CHARGEBACK_REQUESTED
  CONFIRMED --> CHARGEBACK: PAYMENT_CHARGEBACK_REQUESTED
  CHARGEBACK --> PAID: disputa ganha (ADR-011)
```

`PARTIALLY_REFUNDED → PARTIALLY_REFUNDED` é uma auto-transição válida: o status não muda, mas o evento é aplicado (grava `charge_refunds` e soma `refunded_cents`). `PAYMENT_UPDATED` sem mudança de status também é aplicado (valor, vencimento, URLs).

Transições fora do mapa são ignoradas (evento marcado como processado com nota `IGNORED_TRANSITION`) — por exemplo, `PAYMENT_OVERDUE` chegando depois de `PAYMENT_RECEIVED` por reordenação.

## Segurança e LGPD

- Dados pessoais: nome, CPF/CNPJ, e-mail, telefone, endereço. Acesso só autenticado; `LEITURA` vê documento mascarado.
- Segredos só em variáveis de ambiente; nunca no banco, no front ou em logs.
- Auditoria (`audit_logs`) para: login, criação/cancelamento/estorno de cobrança, envio/cancelamento de contrato, alteração de configurações, alteração de usuários.
- Backups diários do Postgres em produção (definir na M8).
