# ADR-008 — BullMQ + Redis para filas e agendamentos

**Status:** Aceito · 07/10/2026

## Contexto
Precisamos de processamento assíncrono (webhooks, geração de cobrança pós-contrato, envio de lembretes) e de jobs agendados com retry.

## Decisão
BullMQ via `@nestjs/bullmq`, Redis no docker-compose. Jobs repetíveis para crons. Cada processor é idempotente e usa `jobId` determinístico quando aplicável.

## Alternativa considerada
pg-boss (fila no próprio Postgres, sem Redis). Mais simples de operar, porém integração menos padrão com NestJS. Pode substituir o BullMQ se o Redis virar custo/complexidade relevante em produção.

## Consequências
- Redis passa a ser dependência de produção (instância pequena basta).
- Painel de filas (Bull Board) protegido por ADMIN, só fora de produção ou atrás de auth.
