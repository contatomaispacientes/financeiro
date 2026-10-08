# ADR-007 — Reconciliação diária com o Asaas

**Status:** Aceito · 07/10/2026

## Contexto
Webhooks podem falhar (fila pausada, deploy fora do ar, token trocado). O objetivo O2 exige status 100% correto.

## Decisão
Job diário (06:00 BRT) consulta no Asaas toda cobrança local não final (`PENDING`, `OVERDUE`, `CONFIRMED`) e as cobranças das assinaturas ativas, aplica divergências pelo mesmo processador de eventos (evento sintético `source = RECONCILE`) e importa cobranças de assinatura desconhecidas. Também disponível sob demanda: `POST /charges/:id/sync` e "Reconciliar agora" em Configurações (ADMIN).

## Consequências
- Custo: 1 chamada por cobrança aberta por dia — aceitável para o volume esperado (centenas). Respeitar limite de requisições com concorrência baixa (ex.: 3) e pausa entre lotes.
- Toda correção feita pela reconciliação aparece no log de eventos.
