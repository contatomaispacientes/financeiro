import { computeTotals } from '../customer-totals';

describe('computeTotals', () => {
  it('[CLI-02.2][CLI-03.1] pago, em aberto, vencido e nº de cobranças', () => {
    expect(
      computeTotals([
        { status: 'PAID', count: 2, valueCents: 20_000, refundedCents: 0 },
        { status: 'CONFIRMED', count: 1, valueCents: 5_000, refundedCents: 0 },
        { status: 'PARTIALLY_REFUNDED', count: 1, valueCents: 10_000, refundedCents: 3_000 },
        { status: 'REFUNDED', count: 1, valueCents: 8_000, refundedCents: 8_000 },
        { status: 'PENDING', count: 3, valueCents: 30_000, refundedCents: 0 },
        { status: 'OVERDUE', count: 1, valueCents: 7_000, refundedCents: 0 },
        { status: 'DRAFT', count: 4, valueCents: 99_000, refundedCents: 0 },
        { status: 'CANCELED', count: 2, valueCents: 50_000, refundedCents: 0 },
        { status: 'CHARGEBACK', count: 1, valueCents: 4_000, refundedCents: 0 },
      ]),
    ).toEqual({
      chargesCount: 2 + 1 + 1 + 1 + 3 + 1 + 1,
      paidCents: 20_000 + 5_000 + (10_000 - 3_000),
      openCents: 30_000 + 7_000,
      overdueCents: 7_000,
    });
  });

  it('cliente sem cobranças', () => {
    expect(computeTotals([])).toEqual({ chargesCount: 0, paidCents: 0, openCents: 0, overdueCents: 0 });
  });
});
