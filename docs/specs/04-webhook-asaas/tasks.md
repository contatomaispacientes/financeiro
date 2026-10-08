# 04 — Webhook e reconciliação Asaas · Tarefas

> Status: **Aprovado** · Tarefas 1–6 = M2 · 7–9 = M3

- [x] 1. `WebhookInbox` genérico + `webhook_events` + guard do Asaas + endpoint
  - Resposta 200 rápida, `ON CONFLICT DO NOTHING`, enfileiramento com `jobId = evt_<id>`; helpers `enqueueUnique`/`requeue` do ADR-010 com teste.
  - _Requisitos: WHK-01.1–01.5, WHK-NF1, WHK-NF2_

- [x] 2. Mapa de transições de status em `shared` (função pura `nextChargeStatus(current, event)`) + testes exaustivos
  - _Requisitos: WHK-02.3_

- [x] 3. `PaymentEventProcessor`: localizar, transicionar, aplicar, marcar resultado; fila `asaas-events` com retry
  - Testes com fixtures reais de cada evento (fixtures montadas pela documentação; trocar pelos payloads do sandbox na tarefa 6).
  - Inclui localização de parcela por `group_key`, retry de evento recente sem recurso, `charge_refunds` (REFUND/CHARGEBACK).
  - _Requisitos: WHK-02.1, WHK-02.2 (sem importação), WHK-02.4, WHK-02.5, WHK-02.7_

- [x] 4. Sweeper de eventos não enfileirados (a cada 10 min)
  - _Requisitos: WHK-02.5_

- [x] 5. Eventos no detalhe da cobrança + timeline no front
  - _Requisitos: WHK-03.4_

- [x] 6. Teste ponta a ponta no sandbox com túnel (cloudflared/ngrok)
  - Documentar o passo a passo em `docs/testes/sandbox-webhook.md`.
  - Documento escrito; a execução no sandbox (e a troca das fixtures pelos payloads reais) fica com o usuário.
  - _Requisitos: WHK-01, WHK-02_

- [x] 7. Importação de cobranças de assinatura e atualização de `next_due_date`
  - _Requisitos: WHK-02.2 (importação), WHK-02.6_

- [x] 8. Log de eventos (API + tela), reprocessar, card de saúde
  - _Requisitos: WHK-03.1–03.3_

- [ ] 9. `ReconcileService` com cron 06:00, "Reconciliar agora", limite de concorrência, eventos RECONCILE; job mensal de retenção
  - _Requisitos: WHK-04.1–04.5, WHK-NF3_
