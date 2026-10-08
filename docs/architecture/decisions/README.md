# Decisões de arquitetura (ADRs)

Formato curto: contexto → decisão → consequências. Um ADR aceito só muda por outro ADR que o substitua.

| ADR | Título | Status |
| --- | --- | --- |
| [001](ADR-001-monorepo-stack.md) | Monorepo pnpm com NestJS, React e pacote shared | Aceito |
| [002](ADR-002-dinheiro-e-datas.md) | Dinheiro em centavos; vencimento como DATE em America/Sao_Paulo | Aceito |
| [003](ADR-003-conta-asaas-unica.md) | Uma conta Asaas; credenciais apenas em variáveis de ambiente | Aceito |
| [004](ADR-004-webhooks-idempotentes.md) | Webhooks: persistir, responder 200, processar em fila | Aceito |
| [005](ADR-005-contratos-adapter.md) | Contratos atrás de um adapter, com modelos do provedor e FakeProvider | Aceito |
| [006](ADR-006-chargeplan-unico.md) | Um único ChargePlan para Nova Cobrança e Contrato | Aceito |
| [007](ADR-007-reconciliacao.md) | Reconciliação diária com o Asaas | Aceito |
| [008](ADR-008-filas-bullmq.md) | BullMQ + Redis para filas e agendamentos | Aceito |
| [009](ADR-009-clicksign.md) | Clicksign (API v3) como provedor de assinatura eletrônica | Aceito |
| [010](ADR-010-ids-de-job-e-reenfileiramento.md) | Ids de job sem `:` e reenfileiramento manual no BullMQ | Aceito |
| [011](ADR-011-chargeback-como-saida.md) | Chargeback lançado como saída no fluxo de caixa | Aceito (provisório) |
| [012](ADR-012-vitest-na-api.md) | Vitest na API (NestJS 12 é ESM) e dependências do scaffold | Aceito |
| [013](ADR-013-dependencias-do-web.md) | Dependências do web trazidas pelo shadcn/ui e pelo scaffold | Aceito |
| [014](ADR-014-versoes-fixadas.md) | Versões fixadas e exceções à "última estável" (TypeScript 6, Prisma 7) | Aceito |
| [015](ADR-015-deploy-vps-docker.md) | Produção em VPS Hostinger com Docker Compose, Caddy e backup local | Aceito |
| [016](ADR-016-asaas-simulado.md) | Asaas simulado (`ASAAS_ENV=mock`) para usar o sistema sem conta | Aceito |
