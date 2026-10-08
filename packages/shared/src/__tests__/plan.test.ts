import { describe, it, expect } from 'vitest';
import { calculatePlan } from '../plan.js';
import { ChargePlanSchema, type ChargePlanInput } from '../schemas/charge-plan.js';
import { ServiceCreateSchema, ServiceUpdateSchema } from '../schemas/service.js';

const TODAY = '2026-10-08';
const opts = { today: TODAY, minChargeCents: 500 };

function plan(overrides: Partial<ChargePlanInput> = {}) {
  return ChargePlanSchema.parse({
    items: [{ description: 'Consultoria', quantity: 2, unitPriceCents: 50_000 }],
    type: 'SINGLE',
    billingType: 'PIX',
    dueDate: { mode: 'FIXED_DATE', date: '2026-10-20' },
    finePct: 2,
    interestPct: 1,
    ...overrides,
  });
}

function errorCode(p: ReturnType<typeof plan>, o: Partial<typeof opts & { signedAt: string }> = {}) {
  const r = calculatePlan(p, { ...opts, ...o });
  return r.ok ? null : r.error.code;
}

describe('ChargePlanSchema', () => {
  it('[COB-01.1] exige itens, tipo, forma, vencimento, multa e juros; desconto padrão 0', () => {
    const r = ChargePlanSchema.safeParse({ items: [] });
    expect(r.success).toBe(false);
    expect(plan().discountCents).toBe(0);
  });

  it('[COB-01.1] valida itens: quantidade 1–999 e preço ≥ 0', () => {
    for (const item of [
      { description: 'X', quantity: 0, unitPriceCents: 1 },
      { description: 'X', quantity: 1000, unitPriceCents: 1 },
      { description: 'X', quantity: 1, unitPriceCents: -1 },
      { description: '', quantity: 1, unitPriceCents: 1 },
    ]) {
      expect(ChargePlanSchema.safeParse({ ...plan(), items: [item] }).success, JSON.stringify(item)).toBe(false);
    }
  });

  it('parcelas só em parcelada; ciclo e data final só em recorrente', () => {
    expect(() => plan({ type: 'INSTALLMENT' })).toThrow();
    expect(() => plan({ type: 'RECURRING' })).toThrow();
    expect(() => plan({ installmentCount: 3 })).toThrow();
    expect(() => plan({ cycle: 'MONTHLY' })).toThrow();
    expect(plan({ type: 'INSTALLMENT', installmentCount: 3 }).installmentCount).toBe(3);
    expect(() => plan({ type: 'INSTALLMENT', installmentCount: 13 })).toThrow();
  });
});

describe('calculatePlan', () => {
  it('[COB-01.4] avulsa: subtotal, desconto, total, vencimento e descrição', () => {
    const r = calculatePlan(
      plan({
        items: [
          { description: 'Consultoria', quantity: 2, unitPriceCents: 50_000 },
          { description: 'Treinamento', quantity: 1, unitPriceCents: 30_000 },
        ],
        discountCents: 10_000,
      }),
      opts,
    );
    expect(r).toEqual({
      ok: true,
      value: {
        subtotalCents: 130_000,
        discountCents: 10_000,
        totalCents: 120_000,
        firstDueDate: '2026-10-20',
        installments: [{ number: 1, dueDate: '2026-10-20', valueCents: 120_000 }],
        description: 'Consultoria (2x) · Treinamento (1x)',
      },
    });
  });

  it.each([
    ['desconto maior que o subtotal', { discountCents: 100_001 }, 'DISCOUNT_EXCEEDS_SUBTOTAL'],
    ['total zero', { discountCents: 100_000 }, 'CHARGE_TOTAL_ZERO'],
    ['vencimento no passado', { dueDate: { mode: 'FIXED_DATE' as const, date: '2026-10-07' } }, 'DUE_DATE_IN_PAST'],
    ['abaixo do mínimo', { items: [{ description: 'X', quantity: 1, unitPriceCents: 499 }] }, 'CHARGE_BELOW_MINIMUM'],
  ])('[COB-01.5] recusa %s', (_label, overrides, code) => {
    expect(errorCode(plan(overrides))).toBe(code);
  });

  it('[COB-01.5] vencimento hoje é aceito', () => {
    expect(errorCode(plan({ dueDate: { mode: 'FIXED_DATE', date: TODAY } }))).toBeNull();
  });

  it('[COB-02.2] descrição truncada em 500 caracteres com reticências', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ description: `Serviço número ${i} ${'x'.repeat(10)}`, quantity: 1, unitPriceCents: 1_000 }));
    const r = calculatePlan(plan({ items }), opts);
    expect(r.ok && r.value.description.length).toBe(500);
    expect(r.ok && r.value.description.endsWith('…')).toBe(true);
  });

  it('[COB-03.2] parcelada: parcelas mensais somando exatamente o total, resto na última, fim de mês preservado', () => {
    const r = calculatePlan(
      plan({
        items: [{ description: 'Projeto', quantity: 1, unitPriceCents: 100_000 }],
        type: 'INSTALLMENT',
        installmentCount: 3,
        dueDate: { mode: 'FIXED_DATE', date: '2027-01-31' },
      }),
      opts,
    );
    expect(r.ok && r.value.installments).toEqual([
      { number: 1, dueDate: '2027-01-31', valueCents: 33_333 },
      { number: 2, dueDate: '2027-02-28', valueCents: 33_333 },
      { number: 3, dueDate: '2027-03-31', valueCents: 33_334 },
    ]);
  });

  it('[COB-03.4] parcela abaixo do mínimo', () => {
    const p = plan({ items: [{ description: 'X', quantity: 1, unitPriceCents: 1_000 }], type: 'INSTALLMENT', installmentCount: 3 });
    expect(errorCode(p)).toBe('CHARGE_BELOW_MINIMUM');
  });

  it('recorrente: data final deve ser depois do 1º vencimento', () => {
    const base = { type: 'RECURRING' as const, cycle: 'MONTHLY' as const };
    expect(errorCode(plan({ ...base, endDate: '2026-10-20' }))).toBe('END_DATE_BEFORE_FIRST_DUE');
    expect(errorCode(plan({ ...base, endDate: '2027-10-20' }))).toBeNull();
  });

  it('DAYS_AFTER_SIGNATURE: exige assinatura e usa a data da assinatura em São Paulo', () => {
    const p = plan({ dueDate: { mode: 'DAYS_AFTER_SIGNATURE', days: 5 } });
    expect(errorCode(p)).toBe('DUE_RULE_REQUIRES_SIGNATURE');
    // 09/10 01:30 UTC = 08/10 22:30 em São Paulo → 08/10 + 5 = 13/10
    const r = calculatePlan(p, { ...opts, signedAt: '2026-10-09T01:30:00Z' });
    expect(r.ok && r.value.firstDueDate).toBe('2026-10-13');
  });
});

describe('ServiceCreateSchema / ServiceUpdateSchema', () => {
  it('[SRV-01.1] nome 2–120, preço > 0, descrição opcional até 500, ativo por padrão', () => {
    expect(ServiceCreateSchema.parse({ name: ' Consultoria ', defaultPriceCents: 1 })).toEqual({
      name: 'Consultoria',
      defaultPriceCents: 1,
      active: true,
    });
    expect(ServiceCreateSchema.safeParse({ name: 'A', defaultPriceCents: 0 }).success).toBe(false);
    expect(ServiceCreateSchema.safeParse({ name: 'Ok', defaultPriceCents: 100, description: 'x'.repeat(501) }).success).toBe(false);
  });

  it('update parcial não reativa sozinho', () => {
    expect(ServiceUpdateSchema.parse({ defaultPriceCents: 9_900 })).toEqual({ defaultPriceCents: 9_900 });
    expect(ServiceUpdateSchema.safeParse({}).success).toBe(false);
  });
});
