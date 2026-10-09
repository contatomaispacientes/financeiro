# 08 — Régua de cobrança · Tarefas

> Status: **Aprovado** · Tarefas 1–7 = M7 · Tarefa 8 = v1.1

- [x] 1. `MessageRenderer` (variáveis por tipo) + `reminder_templates` (migration com índice único `NULLS NOT DISTINCT`, seed com textos padrão) + `ReminderTemplatesService` (CRUD, `resolve`, restaurar padrão) + prévia
  - _Requisitos: REG-01.1–01.4, REG-08.1–08.5_

- [x] 2. `MailProvider` definitivo (se a spec 03 usou versão simples, consolidar aqui) e modelos de e-mail por tipo
  - _Requisitos: REG-NF1, REG-NF2_

- [x] 3. `planForDay` + cron 09:00 + fila `reminders`
  - _Requisitos: REG-03.1, REG-03.6_

- [x] 4. `sendAutomatic` com reserva/unicidade, salto, SKIPPED, retries, FAILED; migration do índice único parcial; `jobId = rem_…` (ADR-010)
  - _Requisitos: REG-03.2–03.5_

- [x] 5. `sendManual` (substitui a implementação provisória da spec 03) e `sendForEvent` ouvindo `charge.created`, `charge.paid`, `charge.refunded`, `charge.canceled`
  - _Requisitos: REG-04.1, REG-04.2, REG-04.3_

- [x] 6. Canal Asaas: `notificationDisabled` por cliente (canal + `remindersEnabled`) no `ensureAsaasCustomer` e no `asaas-customer-sync`; sincronização em lote ao alternar o canal
  - _Requisitos: REG-02.1, REG-02.2, REG-05.1_

- [x] 7. Telas: Configurações › Régua, Configurações › Mensagens (editor por processo/canal/dia, prévia, restaurar), chave na ficha do cliente, lembretes no detalhe da cobrança
  - _Requisitos: REG-01, REG-05.1, REG-06.1, REG-06.2, REG-08_

- [ ] 8. (v1.1) Escolher provedor de WhatsApp (ADR), implementar `WhatsAppProvider` e habilitar o canal
  - _Requisitos: REG-07.1, REG-07.2_
