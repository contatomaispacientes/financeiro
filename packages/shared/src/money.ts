/**
 * All money values are integers in centavos.
 * Conversion only at the boundary (UI and Asaas payload).
 */

/**
 * Converts a BRL-formatted string ("1.234,56") or a number (12.5) to centavos.
 * Rounds half-up.
 */
export function toCents(value: string | number): number {
  if (typeof value === 'number') {
    return Math.round(value * 100);
  }

  // Remove thousands separator (.) and replace decimal comma with dot
  const normalized = value.replace(/\./g, '').replace(',', '.');
  const parsed = parseFloat(normalized);

  if (isNaN(parsed)) {
    throw new Error(`Invalid money value: ${value}`);
  }

  return Math.round(parsed * 100);
}

/**
 * Converts centavos to a decimal number (for Asaas payload).
 * Example: 123456 → 1234.56
 */
export function fromCents(cents: number): number {
  return cents / 100;
}

/**
 * Formats centavos as BRL currency string.
 * Example: 123456 → "R$ 1.234,56"
 */
export function formatBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100);
}

/**
 * Splits a total in centavos into `n` installments.
 * The remainder goes to the last installment so the sum always equals the total.
 * Example: splitInstallments(10000, 3) → [3333, 3333, 3334]
 */
export function splitInstallments(totalCents: number, n: number): number[] {
  if (n <= 0 || !Number.isInteger(n)) {
    throw new Error(`Invalid number of installments: ${n}`);
  }
  if (totalCents < 0 || !Number.isInteger(totalCents)) {
    throw new Error(`Invalid total: ${totalCents}`);
  }

  const base = Math.floor(totalCents / n);
  const remainder = totalCents - base * n;

  const installments = Array.from({ length: n }, (_, i) =>
    i === n - 1 ? base + remainder : base,
  );

  return installments;
}
