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

-- Entradas previstas (vencimento até o fim do mês; inclui vencidas)
SELECT COALESCE(SUM(value_cents),0) FROM charges
WHERE status IN ('PENDING','OVERDUE') AND due_date <= :fim;      -- mês corrente/futuro
-- para meses passados, previsto = 0

-- Estornos do mês (gravados pelo processador de eventos, spec 04)
SELECT COALESCE(SUM(value_cents),0) FROM charge_refunds WHERE refunded_at BETWEEN :inicio AND :fim;

-- Saídas realizadas (despesas)
SELECT COALESCE(SUM(COALESCE(paid_value_cents, value_cents)),0) FROM expenses
WHERE status='PAID' AND paid_at BETWEEN :inicio AND :fim;

-- Saídas previstas
SELECT COALESCE(SUM(value_cents),0) FROM expenses WHERE status='OPEN' AND due_date <= :fim;
```

Previsto só se aplica quando `M ≥ mês corrente`. Para `M` futuro, entradas previstas = cobranças com vencimento dentro de `M` (não acumula vencidas) — vencidas entram só no mês corrente.

## API

| Método | Rota | Papel | Query | Resposta | Requisitos |
| --- | --- | --- | --- | --- | --- |
| GET | `/reports/dashboard` | todos | `month=YYYY-MM` | `DashboardDto` | FLX-01 |
| GET | `/reports/cashflow` | todos | `from`, `to` (YYYY-MM, máx. 24) | `{ months: CashflowMonth[], totals }` | FLX-02 |
| GET | `/reports/expenses-by-category` | todos | `month` | `[{ category, doneCents, forecastCents }]` | FLX-03 |
| GET | `/reports/statement` | todos | `month` | `[{ date, kind: 'IN'\|'OUT', title, subtitle, valueCents, link }]` | FLX-04 |
| GET | `/reports/aging` | todos | — | `{ buckets: [{ range, totalCents, customers: [...] }], rateByMonth: [...] }` | FLX-05 |
| GET | `/reports/cashflow.csv` · `/reports/statement.csv` | todos | idem | `text/csv` | FLX-06 |

```ts
type CashflowMonth = {
  month: string;              // YYYY-MM
  inDoneCents: number; inForecastCents: number;
  outDoneCents: number;       // despesas pagas + taxas + estornos
  outForecastCents: number;
  feesCents: number; refundsCents: number;
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
- `/fluxo`: seletor de intervalo; `BarChart` agrupado (entradas verde `#0E6B4E`, saídas `#B4471C`, previsto em tons claros empilhados); tabela mensal; card por categoria; extrato; card de inadimplência por faixa; botões "Exportar CSV".
- Cache: `['dashboard', month]` com `staleTime` 60 s; invalidado por mutações de cobrança/despesa.

## Testes

| Nível | O que cobre | Requisitos |
| --- | --- | --- |
| Integração | Cenário fixo (seed de teste com cobranças e despesas em vários estados e meses) → números esperados escritos à mão em tabela no teste | FLX-01, FLX-02, FLX-03, FLX-NF2 |
| Integração | Taxas e estornos; cartão confirmado; mês passado sem previsto; mês futuro sem vencidas | definições |
| Integração | Aging e taxa de inadimplência | FLX-05 |
| Unit | Formatação CSV (BOM, `;`, vírgula decimal, aspas) | FLX-06 |
| Desempenho | 50 mil cobranças sintéticas: p95 < 500 ms | FLX-NF1 |

## Changelog

| Data | Mudança |
| --- | --- |
| 07/10/2026 | Versão inicial |
