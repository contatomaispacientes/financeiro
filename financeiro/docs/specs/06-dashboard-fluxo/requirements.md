# 06 — Dashboard e fluxo de caixa · Requisitos

> Status: **Em revisão** · Prefixo: `FLX` · Depende de: 03, 04, 05 · Marco: M5

## Contexto

Visão consolidada de entradas, saídas e saldo (O4) e acompanhamento da inadimplência (O5). Somente leitura; todos os números saem de `charges` e `expenses`.

## Definições (regime de caixa)

| Termo | Definição |
| --- | --- |
| Entrada realizada | Cobrança `PAID` ou `CONFIRMED` (inclusive se depois estornada), pelo valor bruto, no mês de `paid_at` |
| Entrada prevista | Cobrança `PENDING` ou `OVERDUE` com vencimento **dentro** do mês consultado. Cobranças vencidas de meses anteriores NÃO entram no previsto: aparecem só no KPI "Vencido" |
| Entrada projetada | Só nos 3 meses seguintes ao atual: ciclos de assinaturas `ACTIVE` que o Asaas ainda não gerou, calculados a partir de `next_due_date` pelo ciclo, até `end_date` |
| Taxas Asaas | `value − net_value` das entradas realizadas do mês (saída realizada, categoria "Taxas Asaas") |
| Estornos | Lançamentos `charge_refunds` com `kind = REFUND` no mês do evento (saída realizada) |
| Chargebacks | Lançamentos `charge_refunds` com `kind = CHARGEBACK` no mês em que o chargeback foi aberto (saída realizada); reversão (`CHARGEBACK_REVERSAL`) entra como entrada realizada no mês da devolução — ADR-011 |
| Saída realizada | Despesa `PAID` pelo valor pago, no mês de `paid_at` + taxas Asaas + estornos + chargebacks |
| Saída prevista | Despesa `OPEN` com vencimento **dentro** do mês consultado (atrasadas de meses anteriores ficam no KPI "Contas a pagar em aberto") |
| Saída projetada | Só nos 3 meses seguintes ao atual: recorrências de despesa ativas cuja despesa do mês ainda não foi gerada |
| Resultado do mês | Entradas realizadas − saídas realizadas |
| Saldo previsto do mês | Entradas realizadas + previstas (+ projetadas) − saídas realizadas − previstas (− projetadas) |
| Inadimplência do mês | Valor vencido e não pago das cobranças que venceram no mês ÷ valor total que venceu no mês |

Cartão (`CONFIRMED`) conta como realizado na data de confirmação, embora o Asaas libere o saldo depois; a tela indica isso na legenda.

## Fora de escopo

- DRE contábil, competência, centros de custo, metas e orçamento (v2).

## Requisitos

### FLX-01 — Visão geral

- FLX-01.1 — A visão geral DEVE mostrar, para o mês escolhido (padrão: mês atual): recebido, a receber (vencimento no mês), vencido (acumulado, todos os meses — não entra no saldo previsto), contas a pagar em aberto (inclui atrasadas) e saldo previsto do mês.
- FLX-01.2 — DEVE listar os 6 próximos recebimentos em aberto e as 6 próximas despesas em aberto (com ação "Marcar paga").
- FLX-01.3 — DEVE mostrar o resultado do mês com barras de realizado e previsto para entradas e saídas.
- FLX-01.4 — DEVE mostrar os 6 últimos eventos do webhook (ADMIN e FINANCEIRO).
- FLX-01.5 — DEVE exibir alertas quando houver: contrato assinado com erro ao gerar cobrança (CTR-05.4), cobrança em `DRAFT` há mais de 24 h (COB-12) ou evento de webhook pendente há mais de 1 hora (WHK-03.3).

### FLX-02 — Fluxo de caixa mensal

- FLX-02.1 — O usuário DEVE escolher um intervalo de meses (padrão: últimos 6 + os 3 seguintes; até 24 no passado e no máximo 3 meses à frente do atual) e ver, por mês: entradas, saídas, resultado, margem e, no mês corrente e nos futuros, o previsto.
- FLX-02.3 — Nos 3 meses seguintes ao atual, o sistema DEVE projetar as cobranças futuras das assinaturas ativas e as despesas das recorrências ativas que ainda não foram geradas, exibindo-as separadas do previsto ("projetado").
- FLX-02.2 — DEVE haver gráfico de barras entradas × saídas com o previsto destacado em tom mais claro e totais do período.

### FLX-03 — Saídas por categoria

- FLX-03.1 — DEVE mostrar, para o mês escolhido, as saídas (realizadas + previstas) agrupadas por categoria, incluindo "Taxas Asaas", "Estornos" e "Chargebacks".

### FLX-04 — Extrato

- FLX-04.1 — DEVE listar as movimentações realizadas do mês (entradas e saídas) em ordem de data, com origem (cliente/serviços ou despesa/categoria) e link para o registro.

### FLX-05 — Inadimplência

- FLX-05.1 — DEVE mostrar o valor vencido por faixa de atraso (1–15, 16–30, 31–60, mais de 60 dias) com lista dos clientes de cada faixa.
- FLX-05.2 — DEVE mostrar a taxa de inadimplência dos últimos 6 meses.

### FLX-06 — Exportação

- FLX-06.1 — O usuário DEVE poder exportar em CSV (separador `;`, decimal com vírgula, UTF-8 com BOM) o fluxo do período e o extrato do mês.

## Requisitos não funcionais

- FLX-NF1 — Cada endpoint de relatório responde em < 500 ms com 50 mil cobranças e 20 mil despesas (agregação em SQL).
- FLX-NF2 — Os números do dashboard e do fluxo DEVEM ser idênticos para o mesmo mês (mesma função de cálculo).

## Changelog

| Data | Mudança |
| --- | --- |
| 07/10/2026 | Versão inicial |
| 07/10/2026 | Decisões do dono: vencidas de meses anteriores fora do saldo previsto (só no KPI Vencido); projeção de assinaturas e despesas recorrentes nos 3 meses seguintes (FLX-02.3); chargeback como saída (ADR-011) |
