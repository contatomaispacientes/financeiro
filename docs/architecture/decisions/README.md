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
