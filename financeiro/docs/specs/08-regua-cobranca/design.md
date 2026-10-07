# 08 — Régua de cobrança · Design

> Status: **Em revisão** · Implementa: `REG-01` … `REG-07`

## Componentes

```
SettingsService (régua)              campos reminder_* em settings
RemindersService
  ├─ planForDay(today)               quais (cobrança, tipo, offset) vencem hoje
  ├─ sendAutomatic(item)             aplica salto/unicidade e envia
  ├─ sendManual(chargeId, channel)   COB-10
  └─ sendCreated(chargeId)           REG-04.2 (ouvinte de contract.charge_generated)
MessageRenderer                      substitui variáveis; prévia
MailProvider (integrations/mail)     Nodemailer/SMTP; Mailpit em dev
WhatsAppProvider (v1.1)              interface + implementação escolhida
AsaasNotificationSync                REG-02 (fila asaas-customer-sync em lote)
```

## Planejamento diário — `planForDay(today)`

Para cobranças `status IN (PENDING, OVERDUE)` de clientes com `reminders_enabled = true`, para cada canal ativo em `EMAIL`/`WHATSAPP`:

| Tipo | Condição | `offset_days` |
| --- | --- | --- |
| `BEFORE_DUE` | `reminder_days_before > 0` e `due_date − today = reminder_days_before` e status `PENDING` | `−reminder_days_before` |
| `ON_DUE` | `reminder_on_due_date` e `due_date = today` | `0` |
| `AFTER_DUE` | `today − due_date = d` para `d ∈ reminder_days_after` e status `OVERDUE` | `d` |

Como `AFTER_DUE` só casa offsets exatos da lista, cobranças vencidas há mais que o maior offset nunca entram no plano (REG-03.6). Uma consulta SQL por tipo; resultado enfileirado na fila `reminders` com `jobId = "<chargeId>:<kind>:<channel>:<offset>"`.

## Envio — `sendAutomatic`

1. Relê a cobrança; se não está mais `PENDING/OVERDUE` → sai sem registrar (REG-03.3).
2. **Reserva**: `INSERT reminder_logs (…, status = 'SKIPPED', error = 'IN_PROGRESS') ON CONFLICT DO NOTHING`. Conflito com registro `SENT`/`SKIPPED` definitivo → sai (já tratado). Conflito com `IN_PROGRESS`/`FAILED` vindo de tentativa anterior deste mesmo job → segue (é um retry).
3. Cliente sem e-mail (ou sem celular para WhatsApp) ou `reminders_enabled = false` → atualiza a reserva para `SKIPPED` com o motivo e sai.
4. Garante dados de pagamento (`payment-info` da spec 03) para `{pix}`/`{linha_digitavel}`.
5. Renderiza assunto + corpo e envia.
6. Sucesso → `status = SENT`, `error = null`, `sent_at = now()`.
7. Exceção → `status = FAILED`, `error = mensagem` e relança; BullMQ tenta 3× (backoff 5 min). A última falha fica `FAILED`.

Assuntos por tipo: `CREATED` "Sua cobrança de {valor}", `BEFORE_DUE` "Lembrete: {valor} vence em {vencimento}", `ON_DUE` "Sua cobrança vence hoje", `AFTER_DUE` "Cobrança em aberto há {dias_atraso} dias", `MANUAL` "Cobrança {empresa} — {valor}".

## Canal Asaas (REG-02)

- `ensureAsaasCustomer` (spec 01) já envia `notificationDisabled = !channels.includes('ASAAS')`.
- `PATCH /settings` que altere a presença de `ASAAS` em `reminderChannels` enfileira `asaas-notification-sync`: percorre clientes com `asaas_customer_id` (lotes de 50, concorrência 3) e faz `PUT /customers/{id}` com `notificationDisabled`.
- As notificações do Asaas têm agenda própria (configurada no painel do Asaas); o sistema não registra esses envios.

## API

| Método | Rota | Papel | Corpo / query | Resposta | Requisitos |
| --- | --- | --- | --- | --- | --- |
| PATCH | `/settings` (campos `reminder*`) | ADMIN | spec 00 | settings | REG-01.1, 01.4 |
| POST | `/settings/reminders/preview` | ADMIN | `{ chargeId, kind, message? }` | `{ subject, text, html }` | REG-01.3 |
| GET | `/reminders` | ADMIN, FIN | `chargeId`, `status`, `from`, `to`, `page` | `{ data, meta, summary }` | REG-06 |
| POST | `/charges/:id/send` | ADMIN, FIN | `{ channel }` (spec 03) | `{ sentAt }` | REG-04.1 |
| PATCH | `/customers/:id` (`remindersEnabled`) | ADMIN, FIN | spec 01 | | REG-05.1 |
| POST | `/reminders/run` | ADMIN, só fora de produção | `{ date? }` | resumo | testes manuais |

## Erros

| Código | HTTP | Quando |
| --- | --- | --- |
| `REMINDER_UNKNOWN_VARIABLE` | 400 | REG-01.4 |
| `REMINDER_CHANNEL_NOT_CONFIGURED` | 422 | ligar EMAIL sem SMTP ou WHATSAPP sem provedor |
| `CUSTOMER_WITHOUT_EMAIL` | 422 | envio manual |

## Front

- Configurações › Régua: campos da régua, chips de canais (WhatsApp desabilitado com "em breve" até a v1.1), editor da mensagem com lista de variáveis clicáveis, prévia com cobrança escolhida, tabela dos últimos 7 dias.
- Ficha do cliente: chave "Receber lembretes automáticos".
- Detalhe da cobrança: seção "Lembretes".

## Testes

| Nível | O que cobre | Requisitos |
| --- | --- | --- |
| Unit | `MessageRenderer` (variáveis, desconhecida, escape HTML) | REG-01.2, 01.4 |
| Unit | `planForDay` com relógio fixo: antes, no dia, depois, fora da janela, cliente desligado | REG-03.1, 03.6, REG-05 |
| Integração | rodar o job 2× no mesmo dia → 1 envio; cobrança paga entre planejamento e envio → nada; sem e-mail → SKIPPED; falha SMTP → FAILED após 3 | REG-03.2–03.5 |
| Integração | contrato assinado → cobrança → e-mail CREATED | REG-04.2 |
| Integração (nock) | ligar/desligar canal ASAAS sincroniza clientes | REG-02 |

## Changelog

| Data | Mudança |
| --- | --- |
| 07/10/2026 | Versão inicial |
