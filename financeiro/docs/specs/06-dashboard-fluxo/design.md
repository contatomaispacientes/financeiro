# 06 — Dashboard e fluxo de caixa · Design

> Status: **Em revisão** · Implementa: `FLX-01` … `FLX-06`

## Componentes

`ReportsModule` só leitura, com `CashflowCalculator` (SQL via `prisma.$queryRaw` tipado) como fonte única dos números (FLX-NF2). Nenhuma tabela nova.

## Consultas base (por mês `M`, intervalo `[inicio, fim]` em datas de São Paulo)

```sql
-- Entradas realizadas
SELECT COALESCE(SUM(value_cents),0) AS in_done,
       COALESCE(SUM(value_cents - COALESCE(net_value_cents, value_cents)),0) AS fees
FROM charges WHERE status IN ('PAID','CONFIRMED','REFUNDED','PARTIALLY_REFUNDED','CHARGEBACK')
  AND paid_at BETWEEN :inicio AND :fim;

-- Entradas previstas (só vencimento DENTRO do mês; vencidas de meses anteriores ficam no KPI "Vencido")
SELECT COALESCE(SUM(value_cents),0) FROM charges
WHERE status IN ('PENDING','OVERDUE') AND due_date BETWEEN :inicio AND :fim;   -- mês corrente/futuro
-- para meses passados, previsto = 0

-- Estornos, chargebacks e reversões do mês (gravados pelo processador de eventos, spec 04 / ADR-011)
SELECT kind, COALESCE(SUM(value_cents),0) FROM charge_refunds
WHERE refunded_at BETWEEN :inicio AND :fim GROUP BY kind;   -- REFUND e CHARGEBACK = saída; CHARGEBACK_REVERSAL = entrada

-- Saídas realizadas (despesas)
SELECT COALESCE(SUM(COALESCE(paid_value_cents, value_cents)),0) FROM expenses
WHERE status='PAID' AND paid_at BETWEEN :inicio AND :fim;

-- Saídas previstas (só vencimento DENTRO do mês; atrasadas ficam no KPI "Contas a pagar em aberto")
SELECT COALESCE(SUM(value_cents),0) FROM expenses WHERE status='OPEN' AND due_date BETWEEN :inicio AND :fim;
```

Previsto só se aplica quando `M ≥ mês corrente`. Em nenhum mês o previsto acumula vencidas de meses anteriores (decisão do dono, FLX-01.1).

### Projeção (FLX-02.3) — `projectMonth(M)`, só para `mês corrente < M ≤ mês corrente + 3`

Função pura em `shared` (`projectSubscriptionDueDates(nextDueDate, cycle, endDate, inicio, fim)`), sem gravar nada:
- **Entradas projetadas:** para cada `subscriptions.status = ACTIVE`, as datas de vencimento do ciclo dentro de `[inicio, fim]` a partir de `next_due_date` (passo do `cycle`, `addMonthsClamped`/`addDays`), até `end_date`; descarta as datas que já têm `charges` com `subscription_id` e `due_date` iguais (já geradas pelo Asaas → contam como previsto). Valor = `subscriptions.value_cents`.
- **Saídas projetadas:** para cada `expense_recurrences` ativa com `start_month ≤ M ≤ end_month`, sem despesa com `(recurrence_id, reference_month = M)`; valor = `value_cents`.
- Nunca entram em "realizado"; aparecem em `inProjectedCents`/`outProjectedCents` e no saldo previsto do mês.

## API

| Método | Rota | Papel | Query | Resposta | Requisitos |
| --- | --- | --- | --- | --- | --- |
| GET | `/reports/dashboard` | todos | `month=YYYY-MM` | `DashboardDto` | FLX-01 |
| GET | `/reports/cashflow` | todos | `from`, `to` (YYYY-MM; até 24 meses; `to` ≤ mês atual + 3, senão `REPORT_RANGE_INVALID` 422) | `{ months: CashflowMonth[], totals }` | FLX-02 |
| GET | `/reports/expenses-by-category` | todos | `month` | `[{ category, doneCents, forecastCents }]` | FLX-03 |
| GET | `/reports/statement` | todos | `month` | `[{ date, kind: 'IN'\|'OUT', title, subtitle, valueCents, link }]` | FLX-04 |
| GET | `/reports/aging` | todos | — | `{ buckets: [{ range, totalCents, customers: [...] }], rateByMonth: [...] }` | FLX-05 |
| GET | `/reports/cashflow.csv` · `/reports/statement.csv` | todos | idem | `text/csv` | FLX-06 |

```ts
type CashflowMonth = {
  month: string;              // YYYY-MM
  inDoneCents: number;        // inclui reversões de chargeback
  inForecastCents: number; inProjectedCents: number;
  outDoneCents: number;       // despesas pagas + taxas + estornos + chargebacks
  outForecastCents: number; outProjectedCents: number;
  feesCents: number; refundsCents: number; chargebacksCents: number;
  resultCents: number;        // inDone − outDone
  marginPct: number | null;   // resultCents / inDoneCents
  isCurrent: boolean; isFuture: boolean;
};
type DashboardDto = {
  month: string;
  kpis: { receivedCents; receivableCents; overdueCents; payablesOpenCents; forecastBalanceCents; counts: {...} };
  upcomingReceivables: ChargeListItem[];  // 6, PENDING/OVERDUE por vencimento asc
  openPayables: ExpenseListItem[];        // 6, OPEN por vencimento asc
  monthResult: { in: { doneCents, forecastCents }, out: { doneCents, forecastCents } };
  recentEvents: WebhookEventListItem[];   // 6 (vazio para LEITURA)
  alerts: { contractsWithChargeError: number; staleDraftCharges: number; pendingWebhookEvents: number }; // FLX-01.5
};
```

## Front

- `/` Visão geral: seletor de mês no cabeçalho; 5 cards; duas listas; card de resultado (barras horizontais realizado/previsto); card de eventos. Recharts só onde houver gráfico.
- `/fluxo`: seletor de intervalo (padrão: 6 meses atrás + 3 à frente); `BarChart` agrupado (entradas verde `#0E6B4E`, saídas `#B4471C`, previsto em tons claros empilhados, projetado tracejado/hachurado com legenda "projeção"); tabela mensal; card por categoria; extrato; card de inadimplência por faixa; botões "Exportar CSV".
- Cache: `['dashboard', month]` com `staleTime` 60 s; invalidado por mutações de cobrança/despesa.

## Testes

| Nível | O que cobre | Requisitos |
| --- | --- | --- |
| Integração | Cenário fixo (seed de teste com cobranças e despesas em vários estados e meses) → números esperados escritos à mão em tabela no teste | FLX-01, FLX-02, FLX-03, FLX-NF2 |
| Integração | Taxas, estornos e chargeback/reversão; cartão confirmado; mês passado sem previsto; vencida de mês anterior fora do previsto e dentro do KPI Vencido; `to` além de +3 meses → 422 | definições |
| Unit (shared) | `projectSubscriptionDueDates`: mensal, semanal, fim de mês, `end_date` no meio do intervalo, datas já geradas descartadas | FLX-02.3 |
| Integração | Projeção: assinatura ativa e recorrência de despesa aparecem como projetado nos 3 meses seguintes e somem do projetado quando geradas | FLX-02.3 |
| Integração | Aging e taxa de inadimplência | FLX-05 |
| Unit | Formatação CSV (BOM, `;`, vírgula decimal, aspas) | FLX-06 |
| Desempenho | 50 mil cobranças sintéticas: p95 < 500 ms | FLX-NF1 |

## Changelog

| Data | Mudança |
| --- | --- |
| 07/10/2026 | Versão inicial |
| 07/10/2026 | Decisões do dono: previsto sem vencidas antigas, projeção de 3 meses (`projectMonth`), chargebacks e reversões (ADR-011), limite de `to` |
