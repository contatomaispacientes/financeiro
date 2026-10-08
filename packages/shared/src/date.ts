/**
 * Date utilities. Due dates are DATE (no time). "Today" is always in America/Sao_Paulo.
 * Timestamps in UTC (timestamptz).
 */

const SAO_PAULO_TZ = 'America/Sao_Paulo';

/**
 * Returns today's date in São Paulo timezone as "YYYY-MM-DD".
 */
export function todayInSaoPaulo(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SAO_PAULO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const year = parts.find((p) => p.type === 'year')!.value;
  const month = parts.find((p) => p.type === 'month')!.value;
  const day = parts.find((p) => p.type === 'day')!.value;

  return `${year}-${month}-${day}`;
}

/**
 * Adds months to a date string, clamping to end of month.
 * Example: addMonthsClamped("2026-01-31", 1) → "2026-02-28"
 */
export function addMonthsClamped(dateStr: string, months: number): string {
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = parseInt(yearStr!, 10);
  const month = parseInt(monthStr!, 10);
  const day = parseInt(dayStr!, 10);

  let newMonth = month + months;
  let newYear = year;

  // Normalize month overflow/underflow
  newYear += Math.floor((newMonth - 1) / 12);
  newMonth = ((newMonth - 1) % 12 + 12) % 12 + 1;

  // Clamp day to last day of target month
  const lastDay = new Date(newYear, newMonth, 0).getDate();
  const newDay = Math.min(day, lastDay);

  return `${String(newYear).padStart(4, '0')}-${String(newMonth).padStart(2, '0')}-${String(newDay).padStart(2, '0')}`;
}

/** Data ("YYYY-MM-DD") de um instante no fuso de São Paulo. */
export function toSaoPauloDate(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SAO_PAULO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Soma dias a uma data pura ("YYYY-MM-DD"), sem fuso. */
export function addDays(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Checks if a due date is overdue relative to today in São Paulo.
 */
export function isOverdue(dueDate: string): boolean {
  return dueDate < todayInSaoPaulo();
}
