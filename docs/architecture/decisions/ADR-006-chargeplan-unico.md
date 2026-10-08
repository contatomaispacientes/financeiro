# ADR-006 — Um único ChargePlan para Nova Cobrança e Contrato

**Status:** Aceito · 07/10/2026

## Contexto
A cobrança pode nascer de duas formas: direto (Nova Cobrança) ou após assinatura de contrato. Duplicar a lógica gera divergência de valores e regras.

## Decisão
`ChargePlanSchema` (zod, em `packages/shared/schemas/charge-plan.ts`) descreve itens, tipo, forma de pagamento, regra de vencimento, parcelas/ciclo, desconto, multa e juros. `ChargesService.createFromPlan(customerId, plan, { origin, contractId?, userId? })` é o único caminho que cria cobranças/assinaturas no Asaas. O contrato guarda o plano em `contracts.charge_plan` (snapshot) e o total calculado.

## Consequências
- A tela de Novo Contrato reutiliza o formulário da Nova Cobrança.
- A regra de vencimento suporta `FIXED_DATE` e `DAYS_AFTER_SIGNATURE` (este último só válido com origem CONTRACT).
- Mudança no catálogo de serviços não altera contratos já enviados (preço congelado no plano).
