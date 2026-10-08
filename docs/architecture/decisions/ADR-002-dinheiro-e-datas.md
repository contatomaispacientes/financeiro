# ADR-002 — Dinheiro em centavos; vencimento como DATE em America/Sao_Paulo

**Status:** Aceito · 07/10/2026

## Contexto
Ponto flutuante gera erros de arredondamento em parcelas e somatórios. Vencimentos são datas civis brasileiras; tratar como instante UTC faz cobranças "vencerem" um dia antes ou depois.

## Decisão
- Valores sempre `Int` em centavos (`*_cents`). O Asaas recebe/devolve decimal: conversão só no `AsaasClient` via `fromCents`/`toCents`.
- Parcelas: `splitInstallments(total, n)` divide em centavos e joga o resto na última parcela.
- Percentuais (multa, juros) em `Decimal(5,2)`.
- Vencimento, data de pagamento e data de despesa em `date`. "Hoje" = data atual em `America/Sao_Paulo` (`todayInSaoPaulo()`), nunca `new Date()` direto em regra de negócio.

## Consequências
- Lint/revisão deve barrar `parseFloat` em valores monetários fora de `money.ts`.
- Testes de borda: virada de dia às 21h–00h UTC.
