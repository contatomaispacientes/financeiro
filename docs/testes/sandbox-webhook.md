# Teste ponta a ponta do webhook do Asaas (sandbox)

> Spec 04, tarefa 6 · Requisitos WHK-01 e WHK-02 · Só **sandbox** (`ASAAS_ENV=sandbox`).

Objetivo: uma cobrança criada pelo sistema e paga no painel do sandbox muda de status sozinha, sem duplicar eventos.

## 1. Preparar a API

1. `docker compose up -d`, `pnpm --filter api prisma migrate dev`, `pnpm db:seed`.
2. Em `apps/api/.env`:
   - `ASAAS_ENV=sandbox` e `ASAAS_API_KEY` com a chave do sandbox (`$aact_…`, menu Integrações › Chave de API).
   - `ASAAS_WEBHOOK_TOKEN` novo: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
3. `pnpm dev` (API em `http://localhost:3000`).

## 2. Expor a API com um túnel

Escolha um:

```bash
cloudflared tunnel --url http://localhost:3000   # → https://<nome>.trycloudflare.com
ngrok http 3000                                  # → https://<nome>.ngrok-free.app
```

Confira antes de cadastrar (troque `<túnel>` e `<token>`):

```bash
curl -i -X POST https://<túnel>/api/v1/webhooks/asaas                                   # 401 WEBHOOK_UNAUTHORIZED
curl -i -X POST https://<túnel>/api/v1/webhooks/asaas -H "asaas-access-token: <token>" \
     -H "Content-Type: application/json" -d '{}'                                         # 400 WEBHOOK_INVALID_BODY
```

O endereço do túnel rápido muda a cada execução: atualize a URL no Asaas sempre que reiniciar o túnel.

## 3. Cadastrar o webhook no painel do sandbox

Painel do sandbox (`https://sandbox.asaas.com`) › Integrações › Webhooks › Adicionar:

| Campo | Valor |
| --- | --- |
| URL | `https://<túnel>/api/v1/webhooks/asaas` |
| Versão da API | v3 |
| Token de autenticação | o mesmo `ASAAS_WEBHOOK_TOKEN` do `.env` |
| E-mail | seu e-mail (avisos de falha) |
| Webhook ativo / fila de sincronização | Sim / Sim |
| Tipo de envio | **Sequencial** |

Eventos de **cobrança** a habilitar:

- `PAYMENT_CREATED`, `PAYMENT_UPDATED`, `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`
- `PAYMENT_DELETED`, `PAYMENT_RESTORED`
- `PAYMENT_REFUNDED`, `PAYMENT_PARTIALLY_REFUNDED`, `PAYMENT_REFUND_IN_PROGRESS`
- `PAYMENT_CHARGEBACK_REQUESTED`, `PAYMENT_CHARGEBACK_DISPUTE`, `PAYMENT_AWAITING_CHARGEBACK_REVERSAL`
- `PAYMENT_CHECKOUT_VIEWED`, `PAYMENT_BANK_SLIP_VIEWED` (só aparecem no histórico)

> O Asaas pausa a fila depois de 15 falhas seguidas. Se o túnel cair, desative o webhook ou corrija a URL e reative a fila no painel.

## 4. Como conferir

A tela de log de eventos é a tarefa 8 (M3); até lá, consulte o banco:

```sql
SELECT received_at, event, resource_id, result, attempts, error, processed_at
FROM webhook_events WHERE source = 'ASAAS' ORDER BY received_at DESC LIMIT 20;

SELECT status, paid_at, net_value_cents, refunded_cents, last_event_at, invoice_url
FROM charges WHERE asaas_payment_id = 'pay_…';

SELECT kind, value_cents, refunded_at FROM charge_refunds
WHERE charge_id = (SELECT id FROM charges WHERE asaas_payment_id = 'pay_…');
```

`result`: `APPLIED` (aplicado), `IGNORED` (evento só registrado), `IGNORED_TRANSITION` (fora do mapa de status), `UNKNOWN_RESOURCE` (cobrança não existe aqui).

## 5. Roteiro

| # | Ação | Esperado |
| --- | --- | --- |
| 1 | Nova Cobrança no sistema (Pix, vencimento em 3 dias) | `PAYMENT_CREATED` → `APPLIED`; cobrança `PENDING` |
| 2 | Painel do sandbox › cobrança › "Confirmar recebimento em dinheiro" (ou pagar pelo guia de testes do sandbox) | `PAYMENT_RECEIVED` → `PAID`, `paid_at` e `net_value_cents` preenchidos — **critério de pronto** |
| 3 | Painel › Webhooks › log › reenviar o evento do passo 2 | 200; continua uma linha em `webhook_events` com `attempts = 1` (WHK-01.4) |
| 4 | Nova cobrança; excluir no painel; depois restaurar | `CANCELED` → `PENDING` (ou `OVERDUE` se já venceu) |
| 5 | Cobrança no cartão com cartão de teste do sandbox | `PAYMENT_CONFIRMED` → `CONFIRMED`, `paid_at` = data da confirmação |
| 6 | Estornar parte do valor no painel; depois outra parte; depois o restante | `PARTIALLY_REFUNDED` duas vezes e `REFUNDED`; três linhas `REFUND` em `charge_refunds` somando o valor |
| 7 | (D+1) Cobrança com vencimento hoje, sem pagar | `PAYMENT_OVERDUE` → `OVERDUE` no dia seguinte |
| 8 | Trocar o token no painel por um errado e gerar um evento | 401 no log do Asaas, nada novo em `webhook_events`; voltar o token certo |
| 9 | `docker compose stop redis`, pagar uma cobrança, `docker compose start redis` | evento salvo sem `processed_at`; processado quando o Redis volta ou pelo sweeper (até 10 min) |

## 6. Guardar payloads reais

As fixtures em `apps/api/test/fixtures/asaas/webhooks/` foram montadas a partir da documentação. Depois do roteiro, troque-as pelos payloads reais (o `payment` não traz CPF/CNPJ; confira mesmo assim):

```sql
SELECT payload FROM webhook_events WHERE event = 'PAYMENT_PARTIALLY_REFUNDED' ORDER BY received_at DESC LIMIT 1;
```

Pontos a confirmar no sandbox e registrar no Changelog da spec 04:

- estorno parcial: a lista `payment.refunds` (valor e `status` de cada estorno) vem no evento;
- reversão de chargeback: qual evento chega quando a disputa é ganha (hoje: `PAYMENT_RECEIVED` a partir de `CHARGEBACK`);
- parcelamento: `installment` e `installmentNumber` presentes em cada parcela;
- `dateCreated` do evento em horário de Brasília (`YYYY-MM-DD HH:mm:ss`).
