import { HttpStatus, Injectable } from '@nestjs/common';
import {
  addMonthsToYearMonth,
  clampDay,
  currentMonthInSaoPaulo,
  projectSubscriptionDueDates,
  todayInSaoPaulo,
  type AgingDto,
  type CashflowDto,
  type CashflowMonth,
  type CategoryBreakdown,
  type DashboardDto,
  type Role,
  type StatementEntry,
} from '@financeiro/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { DomainException } from '../../common/filters/domain-exception.filter';

const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);
const bounds = (month: string) => ({ start: toDate(`${month}-01`), end: toDate(clampDay(month, 31)) });

/** Status que contam como entrada realizada (spec 06: inclusive se depois estornada). */
const DONE_STATUSES = ['PAID', 'CONFIRMED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'CHARGEBACK'] as const;

export const rangeInvalid = (message: string) =>
  new DomainException('REPORT_RANGE_INVALID', message, HttpStatus.UNPROCESSABLE_ENTITY);

/**
 * Fonte única dos números do dashboard e do fluxo de caixa (FLX-NF2), em regime de caixa
 * conforme as definições do requirements da spec 06.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async month(month: string): Promise<CashflowMonth> {
    const current = currentMonthInSaoPaulo();
    const { start, end } = bounds(month);
    const isCurrent = month === current;
    const isFuture = month > current;
    const withForecast = month >= current;
    const withProjection = isFuture && month <= addMonthsToYearMonth(current, 3);

    const [[charges], refunds, [expenses], inForecast, outForecast] = await Promise.all([
      this.prisma.$queryRaw<Array<{ done: bigint | null; fees: bigint | null }>>`
        SELECT SUM(value_cents) AS done, SUM(value_cents - COALESCE(net_value_cents, value_cents)) AS fees
        FROM charges WHERE status::text IN ('PAID','CONFIRMED','REFUNDED','PARTIALLY_REFUNDED','CHARGEBACK')
          AND paid_at BETWEEN ${start} AND ${end}`,
      this.prisma.chargeRefund.groupBy({ by: ['kind'], where: { refundedAt: { gte: start, lte: end } }, _sum: { valueCents: true } }),
      this.prisma.$queryRaw<Array<{ done: bigint | null }>>`
        SELECT SUM(COALESCE(paid_value_cents, value_cents)) AS done FROM expenses
        WHERE status = 'PAID' AND paid_at BETWEEN ${start} AND ${end}`,
      withForecast
        ? this.prisma.charge.aggregate({ where: { status: { in: ['PENDING', 'OVERDUE'] }, dueDate: { gte: start, lte: end } }, _sum: { valueCents: true } })
        : null,
      withForecast
        ? this.prisma.expense.aggregate({ where: { status: 'OPEN', dueDate: { gte: start, lte: end } }, _sum: { valueCents: true } })
        : null,
    ]);

    const refundSum = (kind: string) => refunds.find((r) => r.kind === kind)?._sum.valueCents ?? 0;
    const feesCents = Number(charges?.fees ?? 0);
    const refundsCents = refundSum('REFUND');
    const chargebacksCents = refundSum('CHARGEBACK');
    const inDoneCents = Number(charges?.done ?? 0) + refundSum('CHARGEBACK_REVERSAL');
    const outDoneCents = Number(expenses?.done ?? 0) + feesCents + refundsCents + chargebacksCents;
    const projected = withProjection ? await this.projected(month) : { in: 0, out: 0 };
    const resultCents = inDoneCents - outDoneCents;

    return {
      month,
      inDoneCents,
      inForecastCents: inForecast?._sum.valueCents ?? 0,
      inProjectedCents: projected.in,
      outDoneCents,
      outForecastCents: outForecast?._sum.valueCents ?? 0,
      outProjectedCents: projected.out,
      feesCents,
      refundsCents,
      chargebacksCents,
      resultCents,
      marginPct: inDoneCents > 0 ? Math.round((resultCents / inDoneCents) * 1000) / 10 : null,
      isCurrent,
      isFuture,
    };
  }

  /** FLX-02.3: ciclos de assinaturas e recorrências ainda não gerados. Nada é gravado. */
  private async projected(month: string) {
    const { start, end } = bounds(month);
    const startIso = toIso(start);
    const endIso = toIso(end);
    const [subscriptions, existing, recurrences, generated] = await Promise.all([
      this.prisma.subscription.findMany({ where: { status: 'ACTIVE' } }),
      this.prisma.charge.findMany({
        where: { subscriptionId: { not: null }, dueDate: { gte: start, lte: end } },
        select: { subscriptionId: true, dueDate: true },
      }),
      this.prisma.expenseRecurrence.findMany({
        where: { active: true, startMonth: { lte: month }, OR: [{ endMonth: null }, { endMonth: { gte: month } }] },
        select: { id: true, valueCents: true },
      }),
      this.prisma.expense.findMany({ where: { referenceMonth: month, recurrenceId: { not: null } }, select: { recurrenceId: true } }),
    ]);

    const already = new Set(existing.map((c) => `${c.subscriptionId}|${toIso(c.dueDate)}`));
    let inCents = 0;
    for (const s of subscriptions) {
      const dates = projectSubscriptionDueDates(toIso(s.nextDueDate), s.cycle, s.endDate ? toIso(s.endDate) : null, startIso, endIso);
      inCents += dates.filter((d) => !already.has(`${s.id}|${d}`)).length * s.valueCents;
    }
    const generatedIds = new Set(generated.map((e) => e.recurrenceId));
    const outCents = recurrences.filter((r) => !generatedIds.has(r.id)).reduce((sum, r) => sum + r.valueCents, 0);
    return { in: inCents, out: outCents };
  }

  async cashflow(from?: string, to?: string): Promise<CashflowDto> {
    const current = currentMonthInSaoPaulo();
    const fromMonth = from ?? addMonthsToYearMonth(current, -6);
    const toMonth = to ?? addMonthsToYearMonth(current, 3);
    if (fromMonth > toMonth) throw rangeInvalid('O mês inicial deve ser anterior ao final');
    if (toMonth > addMonthsToYearMonth(current, 3)) throw rangeInvalid('O fluxo vai no máximo até 3 meses à frente');
    if (fromMonth < addMonthsToYearMonth(current, -24)) throw rangeInvalid('O fluxo volta no máximo 24 meses');

    const months: string[] = [];
    for (let m = fromMonth; m <= toMonth; m = addMonthsToYearMonth(m, 1)) months.push(m);
    const rows = await Promise.all(months.map((m) => this.month(m)));
    const sum = (k: keyof CashflowMonth) => rows.reduce((acc, r) => acc + (r[k] as number), 0);
    return {
      months: rows,
      totals: {
        inDoneCents: sum('inDoneCents'),
        outDoneCents: sum('outDoneCents'),
        resultCents: sum('resultCents'),
        inForecastCents: sum('inForecastCents') + sum('inProjectedCents'),
        outForecastCents: sum('outForecastCents') + sum('outProjectedCents'),
      },
    };
  }

  async dashboard(month: string | undefined, role: Role): Promise<DashboardDto> {
    const m = month ?? currentMonthInSaoPaulo();
    const today = toDate(todayInSaoPaulo());
    const now = Date.now();
    const [flow, overdue, payables, receivables, openExpenses, events, contracts, drafts, pending] = await Promise.all([
      this.month(m),
      this.prisma.charge.aggregate({ where: { status: { in: ['PENDING', 'OVERDUE'] }, dueDate: { lt: today } }, _sum: { valueCents: true } }),
      this.prisma.expense.aggregate({ where: { status: 'OPEN' }, _sum: { valueCents: true } }),
      this.prisma.charge.findMany({
        where: { status: { in: ['PENDING', 'OVERDUE'] } },
        orderBy: { dueDate: 'asc' },
        take: 6,
        include: { customer: { select: { name: true } } },
      }),
      this.prisma.expense.findMany({ where: { status: 'OPEN' }, orderBy: { dueDate: 'asc' }, take: 6, include: { category: true } }),
      role === 'LEITURA'
        ? []
        : this.prisma.webhookEvent.findMany({ orderBy: { receivedAt: 'desc' }, take: 6 }),
      this.prisma.contract.count({ where: { status: 'SIGNED', chargeError: { not: null } } }),
      this.prisma.charge.count({ where: { status: 'DRAFT', createdAt: { lt: new Date(now - 24 * 3600_000) } } }),
      this.prisma.webhookEvent.count({ where: { processedAt: null, receivedAt: { lt: new Date(now - 3600_000) } } }),
    ]);

    return {
      month: m,
      kpis: {
        receivedCents: flow.inDoneCents,
        receivableCents: flow.inForecastCents,
        overdueCents: overdue._sum.valueCents ?? 0,
        payablesOpenCents: payables._sum.valueCents ?? 0,
        forecastBalanceCents:
          flow.inDoneCents + flow.inForecastCents + flow.inProjectedCents - flow.outDoneCents - flow.outForecastCents - flow.outProjectedCents,
      },
      upcomingReceivables: receivables.map((c) => ({
        id: c.id,
        customerName: c.customer.name,
        description: c.description,
        dueDate: toIso(c.dueDate),
        valueCents: c.valueCents,
        status: c.status,
      })),
      openPayables: openExpenses.map((e) => ({
        id: e.id,
        description: e.description,
        categoryName: e.category.name,
        dueDate: toIso(e.dueDate),
        valueCents: e.valueCents,
        late: e.dueDate < today,
      })),
      monthResult: {
        in: { doneCents: flow.inDoneCents, forecastCents: flow.inForecastCents + flow.inProjectedCents },
        out: { doneCents: flow.outDoneCents, forecastCents: flow.outForecastCents + flow.outProjectedCents },
      },
      recentEvents: events.map((e) => ({
        id: e.id,
        event: e.event,
        resourceId: e.resourceId,
        receivedAt: e.receivedAt.toISOString(),
        result: e.result,
        error: e.error,
      })),
      alerts: { contractsWithChargeError: contracts, staleDraftCharges: drafts, pendingWebhookEvents: pending },
    };
  }

  /** FLX-03.1: saídas do mês por categoria, com taxas, estornos e chargebacks. */
  async expensesByCategory(month: string | undefined): Promise<CategoryBreakdown[]> {
    const m = month ?? currentMonthInSaoPaulo();
    const { start, end } = bounds(m);
    const withForecast = m >= currentMonthInSaoPaulo();
    const [done, forecast, categories, flow] = await Promise.all([
      this.prisma.$queryRaw<Array<{ category_id: string; total: bigint }>>`
        SELECT category_id, SUM(COALESCE(paid_value_cents, value_cents)) AS total FROM expenses
        WHERE status = 'PAID' AND paid_at BETWEEN ${start} AND ${end} GROUP BY category_id`,
      withForecast
        ? this.prisma.expense.groupBy({ by: ['categoryId'], where: { status: 'OPEN', dueDate: { gte: start, lte: end } }, _sum: { valueCents: true } })
        : [],
      this.prisma.expenseCategory.findMany({ select: { id: true, name: true } }),
      this.month(m),
    ]);

    const rows = categories
      .map((c) => ({
        category: c.name,
        doneCents: Number(done.find((d) => d.category_id === c.id)?.total ?? 0),
        forecastCents: forecast.find((f) => f.categoryId === c.id)?._sum.valueCents ?? 0,
      }))
      .filter((r) => r.doneCents + r.forecastCents > 0);
    const extras = [
      { category: 'Taxas Asaas', doneCents: flow.feesCents, forecastCents: 0 },
      { category: 'Estornos', doneCents: flow.refundsCents, forecastCents: 0 },
      { category: 'Chargebacks', doneCents: flow.chargebacksCents, forecastCents: 0 },
    ].filter((r) => r.doneCents > 0);
    return [...rows, ...extras].sort((a, b) => b.doneCents + b.forecastCents - (a.doneCents + a.forecastCents));
  }

  /** FLX-04.1: movimentações realizadas do mês, em ordem de data. */
  async statement(month: string | undefined): Promise<StatementEntry[]> {
    const m = month ?? currentMonthInSaoPaulo();
    const { start, end } = bounds(m);
    const [charges, expenses, refunds] = await Promise.all([
      this.prisma.charge.findMany({
        where: { status: { in: [...DONE_STATUSES] }, paidAt: { gte: start, lte: end } },
        include: { customer: { select: { name: true } } },
      }),
      this.prisma.expense.findMany({ where: { status: 'PAID', paidAt: { gte: start, lte: end } }, include: { category: true } }),
      this.prisma.chargeRefund.findMany({
        where: { refundedAt: { gte: start, lte: end } },
        include: { charge: { include: { customer: { select: { name: true } } } } },
      }),
    ]);

    const entries: StatementEntry[] = [];
    for (const c of charges) {
      const date = toIso(c.paidAt!);
      entries.push({ date, kind: 'IN', title: c.customer.name, subtitle: c.description, valueCents: c.valueCents, link: `/cobrancas/${c.id}` });
      const fee = c.netValueCents !== null ? c.valueCents - c.netValueCents : 0;
      if (fee > 0) entries.push({ date, kind: 'OUT', title: 'Taxa Asaas', subtitle: c.customer.name, valueCents: fee, link: `/cobrancas/${c.id}` });
    }
    for (const e of expenses) {
      entries.push({
        date: toIso(e.paidAt!),
        kind: 'OUT',
        title: e.description,
        subtitle: e.supplier ? `${e.category.name} · ${e.supplier}` : e.category.name,
        valueCents: e.paidValueCents ?? e.valueCents,
        link: '/despesas',
      });
    }
    const refundTitle = { REFUND: 'Estorno', CHARGEBACK: 'Chargeback', CHARGEBACK_REVERSAL: 'Reversão de chargeback' } as const;
    for (const r of refunds) {
      entries.push({
        date: toIso(r.refundedAt),
        kind: r.kind === 'CHARGEBACK_REVERSAL' ? 'IN' : 'OUT',
        title: refundTitle[r.kind],
        subtitle: r.charge.customer.name,
        valueCents: r.valueCents,
        link: `/cobrancas/${r.chargeId}`,
      });
    }
    return entries.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === 'IN' ? -1 : 1));
  }

  /** FLX-05: vencido por faixa de atraso e inadimplência dos últimos 6 meses. */
  async aging(): Promise<AgingDto> {
    const todayIso = todayInSaoPaulo();
    const today = toDate(todayIso);
    const overdue = await this.prisma.charge.findMany({
      where: { status: { in: ['PENDING', 'OVERDUE'] }, dueDate: { lt: today } },
      include: { customer: { select: { id: true, name: true } } },
    });

    const ranges = ['1-15', '16-30', '31-60', '60+'] as const;
    const rangeOf = (days: number) => (days <= 15 ? '1-15' : days <= 30 ? '16-30' : days <= 60 ? '31-60' : '60+');
    const buckets = ranges.map((range) => ({ range, totalCents: 0, customers: new Map<string, { id: string; name: string; totalCents: number; charges: number }>() }));
    for (const c of overdue) {
      const days = Math.round((today.getTime() - c.dueDate.getTime()) / 86_400_000);
      const bucket = buckets.find((b) => b.range === rangeOf(days))!;
      bucket.totalCents += c.valueCents;
      const entry = bucket.customers.get(c.customerId) ?? { id: c.customer.id, name: c.customer.name, totalCents: 0, charges: 0 };
      entry.totalCents += c.valueCents;
      entry.charges += 1;
      bucket.customers.set(c.customerId, entry);
    }

    const current = currentMonthInSaoPaulo();
    const rateByMonth = await Promise.all(
      Array.from({ length: 6 }, (_, i) => addMonthsToYearMonth(current, i - 5)).map(async (month) => {
        const { start, end } = bounds(month);
        const lastDue = end < today ? end : new Date(today.getTime() - 86_400_000);
        const [due, unpaid] = await Promise.all([
          this.prisma.charge.aggregate({ where: { status: { notIn: ['DRAFT', 'CANCELED'] }, dueDate: { gte: start, lte: lastDue } }, _sum: { valueCents: true } }),
          this.prisma.charge.aggregate({ where: { status: { in: ['PENDING', 'OVERDUE'] }, dueDate: { gte: start, lte: lastDue } }, _sum: { valueCents: true } }),
        ]);
        const dueCents = due._sum.valueCents ?? 0;
        const unpaidCents = unpaid._sum.valueCents ?? 0;
        return { month, dueCents, unpaidCents, ratePct: dueCents > 0 ? Math.round((unpaidCents / dueCents) * 1000) / 10 : null };
      }),
    );

    return {
      buckets: buckets.map((b) => ({ range: b.range, totalCents: b.totalCents, customers: [...b.customers.values()].sort((a, c) => c.totalCents - a.totalCents) })),
      rateByMonth,
    };
  }
}
