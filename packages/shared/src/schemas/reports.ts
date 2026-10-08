import { z } from '../zod.js';
import type { ChargeStatus } from '../enums.js';

const YearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: 'Mês inválido (AAAA-MM)' });

export const MonthQuerySchema = z.object({ month: YearMonth.optional() });
export const RangeQuerySchema = z.object({ from: YearMonth.optional(), to: YearMonth.optional() });

export interface CashflowMonth {
  month: string;
  /** Entradas realizadas (inclui reversões de chargeback). */
  inDoneCents: number;
  inForecastCents: number;
  inProjectedCents: number;
  /** Despesas pagas + taxas + estornos + chargebacks. */
  outDoneCents: number;
  outForecastCents: number;
  outProjectedCents: number;
  feesCents: number;
  refundsCents: number;
  chargebacksCents: number;
  resultCents: number;
  marginPct: number | null;
  isCurrent: boolean;
  isFuture: boolean;
}

export interface CashflowDto {
  months: CashflowMonth[];
  totals: { inDoneCents: number; outDoneCents: number; resultCents: number; inForecastCents: number; outForecastCents: number };
}

export interface DashboardReceivable {
  id: string;
  customerName: string;
  description: string;
  dueDate: string;
  valueCents: number;
  status: ChargeStatus;
}

export interface DashboardPayable {
  id: string;
  description: string;
  categoryName: string;
  dueDate: string;
  valueCents: number;
  late: boolean;
}

export interface DashboardEvent {
  id: string;
  event: string;
  resourceId: string | null;
  receivedAt: string;
  result: string | null;
  error: string | null;
}

export interface DashboardDto {
  month: string;
  kpis: {
    receivedCents: number;
    receivableCents: number;
    /** Acumulado de todos os meses; não entra no saldo previsto. */
    overdueCents: number;
    payablesOpenCents: number;
    forecastBalanceCents: number;
  };
  upcomingReceivables: DashboardReceivable[];
  openPayables: DashboardPayable[];
  monthResult: { in: { doneCents: number; forecastCents: number }; out: { doneCents: number; forecastCents: number } };
  /** Vazio para LEITURA. */
  recentEvents: DashboardEvent[];
  alerts: { contractsWithChargeError: number; staleDraftCharges: number; pendingWebhookEvents: number };
}

export interface CategoryBreakdown {
  category: string;
  doneCents: number;
  forecastCents: number;
}

export interface StatementEntry {
  date: string;
  kind: 'IN' | 'OUT';
  title: string;
  subtitle: string;
  valueCents: number;
  link: string | null;
}

export interface AgingDto {
  buckets: Array<{
    range: '1-15' | '16-30' | '31-60' | '60+';
    totalCents: number;
    customers: Array<{ id: string; name: string; totalCents: number; charges: number }>;
  }>;
  /** Inadimplência dos últimos 6 meses: vencido e não pago ÷ total que venceu no mês. */
  rateByMonth: Array<{ month: string; dueCents: number; unpaidCents: number; ratePct: number | null }>;
}
