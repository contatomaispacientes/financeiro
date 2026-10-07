# 08 — Régua de cobrança · Tarefas

> Status: **Em revisão** · Tarefas 1–7 = M7 · Tarefa 8 = v1.1

- [ ] 1. `MessageRenderer` + validação de variáveis no `PATCH /settings` + prévia
  - _Requisitos: REG-01.1–01.4_

- [ ] 2. `MailProvider` definitivo (se a spec 03 usou versão simples, consolidar aqui) e modelos de e-mail por tipo
  - _Requisitos: REG-NF1, REG-NF2_

- [ ] 3. `planForDay` + cron 09:00 + fila `reminders`
  - _Requisitos: REG-03.1, REG-03.6_

- [ ] 4. `sendAutomatic` com reserva/unicidade, salto, SKIPPED, retries, FAILED; migration do índice único parcial
  - _Requisitos: REG-03.2–03.5_

- [ ] 5. `sendManual` (substitui a implementação provisória da spec 03) e `sendCreated` ouvindo `contract.charge_generated`
  - _Requisitos: REG-04.1, REG-04.2_

- [ ] 6. Canal Asaas: `notificationDisabled` no `ensureAsaasCustomer` e sincronização em lote ao alternar o canal
  - _Requisitos: REG-02.1, REG-02.2_

- [ ] 7. Telas: Configurações › Régua, chave na ficha do cliente, lembretes no detalhe da cobrança
  - _Requisitos: REG-01, REG-05.1, REG-06.1, REG-06.2_

- [ ] 8. (v1.1) Escolher provedor de WhatsApp (ADR), implementar `WhatsAppProvider` e habilitar o canal
  - _Requisitos: REG-07.1, REG-07.2_
