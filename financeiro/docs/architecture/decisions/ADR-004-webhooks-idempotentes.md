# ADR-004 — Webhooks: persistir, responder 200, processar em fila

**Status:** Aceito · 07/10/2026

## Contexto
O Asaas entrega eventos "pelo menos uma vez", recomenda persistir o `id` do evento para não processar duas vezes, responder 200 rápido e processar o que for lento de forma assíncrona; após 15 falhas consecutivas a fila de webhooks é pausada e eventos com mais de 14 dias são descartados. Provedores de assinatura eletrônica têm comportamento parecido.

## Decisão
Endpoint único por origem. Passos: validar autenticação → `INSERT … ON CONFLICT DO NOTHING` em `webhook_events` (único por `source + external_event_id`) → 200 → enfileirar com `jobId` = id do evento. Worker aplica a regra dentro de transação. Falha final fica visível no log com "Reprocessar".

## Consequências
- O endpoint nunca devolve 500 por regra de negócio (só por falha ao persistir), evitando pausar a fila do Asaas.
- Ordem de chegada não é garantida: o processamento respeita o mapa de transições (overview.md) e ignora transições inválidas.
- Monitorar eventos não processados há mais de 1 hora (alerta no dashboard de configurações).
