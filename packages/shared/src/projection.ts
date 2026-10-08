import { addDays, addMonthsClamped } from './date.js';
import type { Cycle } from './enums.js';

const MONTHS: Partial<Record<Cycle, number>> = { MONTHLY: 1, BIMONTHLY: 2, QUARTERLY: 3, SEMIANNUALLY: 6, YEARLY: 12 };
const DAYS: Partial<Record<Cycle, number>> = { WEEKLY: 7, BIWEEKLY: 14 };

/**
 * Vencimentos de uma assinatura dentro de [start, end] a partir do próximo vencimento (FLX-02.3).
 * Cada data é calculada a partir da original (não acumula o ajuste de fim de mês).
 */
export function projectSubscriptionDueDates(
  nextDueDate: string,
  cycle: Cycle,
  endDate: string | null,
  start: string,
  end: string,
): string[] {
  const dates: string[] = [];
  for (let i = 0; i < 400; i++) {
    const date = MONTHS[cycle] ? addMonthsClamped(nextDueDate, i * MONTHS[cycle]!) : addDays(nextDueDate, i * DAYS[cycle]!);
    if (date > end || (endDate && date > endDate)) break;
    if (date >= start) dates.push(date);
  }
  return dates;
}

/** Soma `n` meses a um "YYYY-MM". */
export function addMonthsToYearMonth(month: string, n: number): string {
  return addMonthsClamped(`${month}-01`, n).slice(0, 7);
}

/** Vencimento do ciclo seguinte de uma assinatura. */
export function addCycle(date: string, cycle: Cycle): string {
  return MONTHS[cycle] ? addMonthsClamped(date, MONTHS[cycle]!) : addDays(date, DAYS[cycle]!);
}
