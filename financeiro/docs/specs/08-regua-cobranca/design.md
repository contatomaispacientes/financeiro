# 08 — Régua de cobrança · Design

> Status: **Em revisão** · Implementa: `REG-01` … `REG-08`

## Componentes

```
SettingsService (régua)              campos reminder_* em settings
ReminderTemplatesService             CRUD dos modelos (reminder_templates), resolução por offset, restaurar padrão
RemindersService
  ├─ planForDay(today)               quais (cobrança, tipo, offset) vencem hoje
  ├─ sendAutomatic(item)             aplica salto/unicidade e envia
  ├─ sendManual(chargeId, channel)   COB-10
  └─ sendForEvent(chargeId, kind)    REG-04.2/04.3 — ouvintes de charge.created | charge.paid | charge.refunded | charge.canceled
MessageRenderer                      substitui variáveis; valida variáveis por tipo; prévia
MailProvider (integrations/mail)     Nodemailer/SMTP; Mailpit em dev
WhatsAppProvider (v1.1)              interface + implementação escolhida
AsaasNotificationSync                REG-02 (fila asaas-customer-sync em lote)
```

## Modelos de mensagem (REG-08)

Tabela `reminder_templates` (data-model.md): uma linha por `(kind, channel, offset_days)`; `offset_days = null` é a mensagem geral do tipo, preenchido só em `BEFORE_DUE`/`AFTER_DUE` (REG-08.2). Canais: `EMAIL` (assunto + corpo) e `WHATSAPP` (corpo; usado na v1.1).

**Resolução** — `resolve(kind, channel, offset)`: linha com o offset exato → senão a geral (`offset_days = null`) → se nenhuma ativa, não envia (automático) ou usa a geral mesmo inativa (`MANUAL`, que não pode ser desativado — REG-08.3).

**Variáveis por tipo** (REG-01.4 — `REMINDER_VARIABLE_NOT_AVAILABLE` fora da lista):

| Variável | Disponível em |
| --- | --- |
| `{cliente}` `{valor}` `{vencimento}` `{link}` `{empresa}` `{servicos}` `{parcela}` | todos |
| `{pix}` `{linha_digitavel}` | `CREATED`, `BEFORE_DUE`, `ON_DUE`, `AFTER_DUE`, `MANUAL` |
| `{dias_para_vencer}` | `BEFORE_DUE` |
| `{dias_atraso}` | `AFTER_DUE` |
| `{data_pagamento}` | `PAID` |
| `{valor_estornado}` | `REFUNDED` |

`{parcela}` vira texto vazio em cobrança que não é parcela; o renderizador junta espaços duplos.

**Textos padrão** (seed e "Restaurar padrão" — REG-08.4/08.5; e-mail):

| Tipo | Assunto | Corpo (resumo) | Ativo |
| --- | --- | --- | --- |
| `CREATED` | Sua cobrança de {valor} | Olá, {cliente}! Segue a cobrança de {servicos}, vencimento {vencimento}. Pague por aqui: {link} | sim |
| `BEFORE_DUE` | Lembrete: {valor} vence em {vencimento} | Olá, {cliente}! Faltam {dias_para_vencer} dias para o vencimento… {link} | sim |
| `ON_DUE` | Sua cobrança vence hoje | Olá, {cliente}! Sua cobrança de {valor} vence hoje… {link} | sim |
| `AFTER_DUE` | Cobrança em aberto há {dias_atraso} dias | Olá, {cliente}! Não identificamos o pagamento de {valor}, vencido em {vencimento}… {link} | sim |
| `MANUAL` | Cobrança {empresa} — {valor} | Olá, {cliente}! Segue o link da sua cobrança… {link} | sempre |
| `PAID` | Pagamento confirmado | Olá, {cliente}! Recebemos {valor} em {data_pagamento}. Obrigado! | não |
| `REFUNDED` | Estorno realizado | Olá, {cliente}! Estornamos {valor_estornado} da cobrança de {valor}. | não |
| `CANCELED` | Cobrança cancelada | Olá, {cliente}! A cobrança de {valor} com vencimento {vencimento} foi cancelada. | não |

O texto completo de cada corpo fica no seed (`apps/api/prisma/seed/reminder-templates.ts`), que é a fonte do "Restaurar padrão".

## Planejamento diário — `planForDay(today)`

Para cobranças `status IN (PENDING, OVERDUE)` de clientes com `reminders_enabled = true`, para cada canal ativo em `EMAIL`/`WHATSAPP` e só quando `resolve(kind, channel, offset)` devolver modelo ativo:

| Tipo | Condição | `offset_days` |
| --- | --- | --- |
| `BEFORE_DUE` | `reminder_days_before > 0` e `due_date − today = reminder_days_before` e status `PENDING` | `−reminder_days_before` |
| `ON_DUE` | `reminder_on_due_date` e `due_date = today` | `0` |
| `AFTER_DUE` | `today − due_date = d` para `d ∈ reminder_days_after` e status `OVERDUE` | `d` |

Como `AFTER_DUE` só casa offsets exatos da lista, cobranças vencidas há mais que o maior offset nunca entram no plano (REG-03.6). Uma consulta SQL por tipo; resultado enfileirado na fila `reminders` com `jobId = "rem_<chargeId>_<kind>_<channel>_<offset>"` (ADR-010: o BullMQ recusa `:` em `jobId` com mais de 3 partes; offset negativo vira `m3` para `-3`).

## Envio — `sendAutomatic`

1. Relê a cobrança; se não está mais `PENDING/OVERDUE` → sai sem registrar (REG-03.3). (Vale para `BEFORE_DUE`/`ON_DUE`/`AFTER_DUE`; mensagens de evento usam `sendForEvent`.)
2. **Reserva**: `INSERT reminder_logs (…, status = 'SKIPPED', error = 'IN_PROGRESS') ON CONFLICT DO NOTHING`. Conflito com registro `SENT`/`SKIPPED` definitivo → sai (já tratado). Conflito com `IN_PROGRESS`/`FAILED` vindo de tentativa anterior deste mesmo job → segue (é um retry).
3. Cliente sem e-mail (ou sem celular para WhatsApp) ou `reminders_enabled = false` → atualiza a reserva para `SKIPPED` com o motivo e sai.
4. Garante dados de pagamento (`payment-info` da spec 03) para `{pix}`/`{linha_digitavel}`.
5. Resolve o modelo (`resolve(kind, channel, offset)`), renderiza assunto + corpo e envia.
6. Sucesso → `status = SENT`, `error = null`, `sent_at = now()`.
7. Exceção → `status = FAILED`, `error = mensagem` e relança; BullMQ tenta 3× (backoff 5 min). A última falha fica `FAILED`.

## Mensagens de evento — `sendForEvent(chargeId, kind)` (REG-04.2, REG-04.3)

Ouvintes `EventEmitter2`: `charge.created` → `CREATED` (spec 03 ao sair de `DRAFT`, e spec 04 ao importar ciclo de assinatura); `charge.paid` → `PAID`; `charge.refunded` → `REFUNDED`; `charge.canceled` → `CANCELED`. Para cada canal ativo em `EMAIL`/`WHATSAPP` com modelo ativo, enfileira na fila `reminders` com `jobId = "rem_<chargeId>_<kind>_<channel>_0"` e `offset_days = 0`; o envio segue os passos 2–7 acima (mesma reserva/unicidade, mesmo SKIPPED para cliente sem e-mail ou com lembretes desligados). Estornos parciais sucessivos geram uma única mensagem `REFUNDED` (unicidade por cobrança/tipo/canal).

## Canal Asaas (REG-02)

- Regra única: `notificationDisabled = !(settings.reminderChannels.includes('ASAAS') && customer.remindersEnabled)`. Usada por `ensureAsaasCustomer` e pelo `asaas-customer-sync` (spec 01).
- `PATCH /settings` que altere a presença de `ASAAS` em `reminderChannels` enfileira `asaas-notification-sync`: percorre clientes com `asaas_customer_id` (lotes de 50, concorrência 3) e faz `PUT /customers/{id}` com o `notificationDisabled` calculado por cliente.
- Alterar `remindersEnabled` de um cliente com `asaas_customer_id` enfileira `asaas-customer-sync` (spec 01), que leva o novo `notificationDisabled` (REG-05.1).
- As notificações do Asaas têm agenda própria (configurada no painel do Asaas); o sistema não registra esses envios.

## API

| Método | Rota | Papel | Corpo / query | Resposta | Requisitos |
| --- | --- | --- | --- | --- | --- |
| PATCH | `/settings` (campos `reminder*`) | ADMIN | spec 00 | settings | REG-01.1 |
| GET | `/reminder-templates` | ADMIN | `channel?` | lista com `kind`, `channel`, `offsetDays`, `subject`, `body`, `active`, `isDefault` | REG-08.1 |
| PUT | `/reminder-templates` | ADMIN | `{ kind, channel, offsetDays?, subject?, body, active }` (cria ou atualiza; valida variáveis) | modelo | REG-08.1–08.3, REG-01.4 |
| DELETE | `/reminder-templates/:id` | ADMIN | — (só específicas por offset) | 204 | REG-08.2 |
| POST | `/reminder-templates/:id/reset` | ADMIN | — | modelo com o texto padrão | REG-08.4 |
| POST | `/reminder-templates/preview` | ADMIN | `{ chargeId, kind, channel, offsetDays?, subject?, body? }` (texto em edição, opcional) | `{ subject, text, html }` | REG-01.3 |
| GET | `/reminders` | ADMIN, FIN | `chargeId`, `status`, `from`, `to`, `page` | `{ data, meta, summary }` | REG-06 |
| POST | `/charges/:id/send` | ADMIN, FIN | `{ channel }` (spec 03) | `{ sentAt }` | REG-04.1 |
| PATCH | `/customers/:id` (`remindersEnabled`) | ADMIN, FIN | spec 01 | | REG-05.1 |
| POST | `/reminders/run` | ADMIN, só fora de produção | `{ date? }` | resumo | testes manuais |

## Erros

| Código | HTTP | Quando |
| --- | --- | --- |
| `REMINDER_UNKNOWN_VARIABLE` | 400 | REG-01.4 |
| `REMINDER_VARIABLE_NOT_AVAILABLE` | 400 | REG-01.4 (`details` = variável e tipo) |
| `REMINDER_TEMPLATE_INVALID` | 422 | e-mail sem assunto; offset em tipo que não aceita; desativar `MANUAL`; excluir a mensagem geral |
| `REMINDER_CHANNEL_NOT_CONFIGURED` | 422 | ligar EMAIL sem SMTP ou WHATSAPP sem provedor |
| `CUSTOMER_WITHOUT_EMAIL` | 422 | envio manual |

## Front

- Configurações › Régua: campos da régua, chips de canais (WhatsApp desabilitado com "em breve" até a v1.1), tabela dos últimos 7 dias.
- Configurações › Mensagens: lista por processo (emitida, antes, no dia, atraso, manual, paga, estornada, cancelada) com chave ativa/inativa; editor com abas por canal (E-mail: assunto + corpo; WhatsApp: corpo), variáveis disponíveis do tipo clicáveis, prévia ao lado com cobrança escolhida, "Restaurar padrão"; em "antes" e "atraso", botão "Mensagem específica para o dia…" listando os dias configurados na régua.
- Ficha do cliente: chave "Receber mensagens automáticas (plataforma e Asaas)".
- Detalhe da cobrança: seção "Lembretes".

## Testes

| Nível | O que cobre | Requisitos |
| --- | --- | --- |
| Unit | `MessageRenderer` (variáveis, desconhecida, não disponível no tipo, escape HTML, `{parcela}` vazio) | REG-01.2, 01.4 |
| Unit | `resolve`: específica por offset > geral; inativa não envia; `MANUAL` sempre | REG-08.2, 08.3 |
| Integração | CRUD de modelos, restaurar padrão, seed com todos os tipos | REG-08.1–08.5 |
| Integração | `charge.paid`/`charge.refunded`/`charge.canceled` com modelo ativo → 1 envio; inativo → nada; dois estornos parciais → 1 mensagem | REG-04.3 |
| Unit | `planForDay` com relógio fixo: antes, no dia, depois, fora da janela, cliente desligado | REG-03.1, 03.6, REG-05 |
| Integração | rodar o job 2× no mesmo dia → 1 envio; cobrança paga entre planejamento e envio → nada; sem e-mail → SKIPPED; falha SMTP → FAILED após 3 | REG-03.2–03.5 |
| Integração | cobrança manual, de contrato e ciclo de assinatura importado → e-mail CREATED (uma vez) | REG-04.2 |
| Integração (nock) | ligar/desligar canal ASAAS sincroniza clientes; cliente com lembretes desligados fica `notificationDisabled = true` com o canal ligado | REG-02, REG-05.1 |

## Changelog

| Data | Mudança |
| --- | --- |
| 07/10/2026 | Versão inicial |
| 07/10/2026 | Decisões do dono: modelos de mensagem por processo × canal × dia (REG-08, `reminder_templates`), mensagens de evento (`sendForEvent`), `notificationDisabled` por cliente; jobId `rem_…` sem `:` (ADR-010) |
