# 06 — Dashboard e fluxo de caixa · Requisitos

> Status: **Em revisão** · Prefixo: `FLX` · Depende de: 03, 04, 05 · Marco: M5

## Contexto

Visão consolidada de entradas, saídas e saldo (O4) e acompanhamento da inadimplência (O5). Somente leitura; todos os números saem de `charges` e `expenses`.

## Definições (regime de caixa)

| Termo | Definição |
| --- | --- |
| Entrada realizada | Cobrança `PAID` ou `CONFIRMED` (inclusive se depois estornada), pelo valor bruto, no mês de `paid_at` |
| Entrada prevista | Cobrança `PENDING` ou `OVERDUE` com vencimento até o fim do mês consultado |
| Taxas Asaas | `value − net_value` das entradas realizadas do mês (saída realizada, categoria "Taxas Asaas") |
| Estornos | `refunded_cents` lançados no mês do evento de estorno (saída realizada) |
| Saída realizada | Despesa `PAID` pelo valor pago, no mês de `paid_at` + taxas Asaas + estornos |
| Saída prevista | Despesa `OPEN` com vencimento até o fim do mês consultado |
| Resultado do mês | Entradas realizadas − saídas realizadas |
| Saldo previsto do mês | Entradas realizadas + previstas − saídas realizadas − previstas |
| Inadimplência do mês | Valor vencido e não pago das cobranças que venceram no mês ÷ valor total que venceu no mês |

Cartão (`CONFIRMED`) conta como realizado na data de confirmação, embora o Asaas libere o saldo depois; a tela indica isso na legenda.

## Fora de escopo

- DRE contábil, competência, centros de custo, metas e orçamento (v2).

## Requisitos

### FLX-01 — Visão geral

- FLX-01.1 — A visão geral DEVE mostrar, para o mês escolhido (padrão: mês atual): recebido, a receber, vencido (acumulado, todos os meses), contas a pagar em aberto e saldo previsto do mês.
- FLX-01.2 — DEVE listar os 6 próximos recebimentos em aberto e as 6 próximas despesas em aberto (com ação "Marcar paga").
- FLX-01.3 — DEVE mostrar o resultado do mês com barras de realizado e previsto para entradas e saídas.
- FLX-01.4 — DEVE mostrar os 6 últimos eventos do webhook (ADMIN e FINANCEIRO).
- FLX-01.5 — DEVE exibir alertas quando houver: contrato assinado com erro ao gerar cobrança (CTR-05.4), cobrança em `DRAFT` há mais de 24 h (COB-12) ou evento de webhook pendente há mais de 1 hora (WHK-03.3).

### FLX-02 — Fluxo de caixa mensal

- FLX-02.1 — O usuário DEVE escolher um intervalo de meses (padrão: últimos 6, até 24) e ver, por mês: entradas, saídas, resultado, margem e, no mês corrente e futuros, o previsto.
- FLX-02.2 — DEVE haver gráfico de barras entradas × saídas com o previsto destacado em tom mais claro e totais do período.

### FLX-03 — Saídas por categoria

- FLX-03.1 — DEVE mostrar, para o mês escolhido, as saídas (realizadas + previstas) agrupadas por categoria, incluindo "Taxas Asaas" e "Estornos".

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
