import { addDays, addMonthsClamped, toSaoPauloDate } from './date.js';
import { formatBRL, splitInstallments } from './money.js';
import type { ChargePlan, PlanErrorCode, PlanInstallment, PlanResult } from './schemas/charge-plan.js';

export interface CalculatePlanOptions {
  /** "Hoje" em America/Sao_Paulo ("YYYY-MM-DD"). */
  today: string;
  /** Instante da assinatura do contrato (regra DAYS_AFTER_SIGNATURE). */
  signedAt?: Date | string;
  /** Valor mínimo por cobrança no Asaas (ASAAS_MIN_CHARGE_CENTS). */
  minChargeCents: number;
}

const DESCRIPTION_MAX = 500;

function fail(code: PlanErrorCode, message: string): PlanResult {
  return { ok: false, error: { code, message } };
}

export function describeItems(items: ChargePlan['items']): string {
  const text = items.map((i) => `${i.description} (${i.quantity}x)`).join(' · ');
  return text.length > DESCRIPTION_MAX ? `${text.slice(0, DESCRIPTION_MAX - 1)}…` : text;
}

/**
 * Totais, parcelas e vencimentos do plano (design da spec 03). Função pura: o front usa para o
 * resumo em tempo real e a API recalcula sempre (nunca confia no total enviado).
 */
export function calculatePlan(plan: ChargePlan, options: CalculatePlanOptions): PlanResult {
  const subtotalCents = plan.items.reduce((sum, i) => sum + i.quantity * i.unitPriceCents, 0);
  const discountCents = plan.discountCents ?? 0;

  if (discountCents > subtotalCents) {
    return fail('DISCOUNT_EXCEEDS_SUBTOTAL', 'O desconto não pode ser maior que o subtotal');
  }
  const totalCents = subtotalCents - discountCents;
  if (totalCents <= 0) return fail('CHARGE_TOTAL_ZERO', 'O total da cobrança precisa ser maior que zero');

  let firstDueDate: string;
  if (plan.dueDate.mode === 'FIXED_DATE') {
    firstDueDate = plan.dueDate.date;
  } else {
    if (!options.signedAt) {
      return fail('DUE_RULE_REQUIRES_SIGNATURE', 'Vencimento "dias após a assinatura" só vale para contrato assinado');
    }
    const signedAt = typeof options.signedAt === 'string' ? new Date(options.signedAt) : options.signedAt;
    firstDueDate = addDays(toSaoPauloDate(signedAt), plan.dueDate.days);
  }

  if (firstDueDate < options.today) return fail('DUE_DATE_IN_PAST', 'O vencimento não pode ser anterior a hoje');
  if (plan.type === 'RECURRING' && plan.endDate && plan.endDate <= firstDueDate) {
    return fail('END_DATE_BEFORE_FIRST_DUE', 'A data final precisa ser depois do primeiro vencimento');
  }

  let installments: PlanInstallment[];
  if (plan.type === 'INSTALLMENT') {
    const values = splitInstallments(totalCents, plan.installmentCount ?? 2);
    installments = values.map((valueCents, i) => ({
      number: i + 1,
      dueDate: addMonthsClamped(firstDueDate, i),
      valueCents,
    }));
  } else {
    installments = [{ number: 1, dueDate: firstDueDate, valueCents: totalCents }];
  }

  if (installments.some((i) => i.valueCents < options.minChargeCents)) {
    return fail(
      'CHARGE_BELOW_MINIMUM',
      plan.type === 'INSTALLMENT'
        ? `Cada parcela precisa ter no mínimo ${formatBRL(options.minChargeCents)}`
        : `A cobrança precisa ter no mínimo ${formatBRL(options.minChargeCents)}`,
    );
  }

  return {
    ok: true,
    value: {
      subtotalCents,
      discountCents,
      totalCents,
      firstDueDate,
      installments,
      description: describeItems(plan.items),
    },
  };
}
