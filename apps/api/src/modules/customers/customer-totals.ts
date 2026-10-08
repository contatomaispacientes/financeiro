import type { ChargeStatus, CustomerTotals } from '@financeiro/shared';

export interface StatusGroup {
  status: ChargeStatus;
  count: number;
  valueCents: number;
  refundedCents: number;
}

const PAID: ChargeStatus[] = ['PAID', 'CONFIRMED', 'PARTIALLY_REFUNDED'];
const OPEN: ChargeStatus[] = ['PENDING', 'OVERDUE'];
const NOT_COUNTED: ChargeStatus[] = ['DRAFT', 'CANCELED'];

/** Definições em CustomerTotals (shared) e no design da spec 01. */
export function computeTotals(groups: StatusGroup[]): CustomerTotals {
  const totals: CustomerTotals = { chargesCount: 0, paidCents: 0, openCents: 0, overdueCents: 0 };
  for (const g of groups) {
    if (!NOT_COUNTED.includes(g.status)) totals.chargesCount += g.count;
    if (PAID.includes(g.status)) totals.paidCents += g.valueCents - g.refundedCents;
    if (OPEN.includes(g.status)) totals.openCents += g.valueCents;
    if (g.status === 'OVERDUE') totals.overdueCents += g.valueCents;
  }
  return totals;
}
