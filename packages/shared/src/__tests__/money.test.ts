import { describe, it, expect } from 'vitest';
import { toCents, fromCents, formatBRL, splitInstallments } from '../money.js';

describe('toCents', () => {
  it('converts BRL string "1.234,56" to 123456', () => {
    expect(toCents('1.234,56')).toBe(123456);
  });

  it('converts simple string "10,50" to 1050', () => {
    expect(toCents('10,50')).toBe(1050);
  });

  it('converts string without decimals "100" to 10000', () => {
    expect(toCents('100')).toBe(10000);
  });

  it('converts number 12.5 to 1250', () => {
    expect(toCents(12.5)).toBe(1250);
  });

  it('converts number 0.01 to 1', () => {
    expect(toCents(0.01)).toBe(1);
  });

  it('rounds half-up: 0.005 → 1', () => {
    expect(toCents(0.005)).toBe(1);
  });

  it('converts zero', () => {
    expect(toCents(0)).toBe(0);
    expect(toCents('0')).toBe(0);
    expect(toCents('0,00')).toBe(0);
  });

  it('throws on invalid string', () => {
    expect(() => toCents('abc')).toThrow('Invalid money value');
  });
});

describe('fromCents', () => {
  it('converts 123456 to 1234.56', () => {
    expect(fromCents(123456)).toBe(1234.56);
  });

  it('converts 0 to 0', () => {
    expect(fromCents(0)).toBe(0);
  });

  it('converts 1 to 0.01', () => {
    expect(fromCents(1)).toBe(0.01);
  });
});

describe('formatBRL', () => {
  it('formats 123456 as "R$ 1.234,56"', () => {
    expect(formatBRL(123456)).toBe('R$\u00a01.234,56');
  });

  it('formats 0 as "R$ 0,00"', () => {
    expect(formatBRL(0)).toBe('R$\u00a00,00');
  });

  it('formats 500 as "R$ 5,00"', () => {
    expect(formatBRL(500)).toBe('R$\u00a05,00');
  });
});

describe('splitInstallments', () => {
  it('splits 10000 into 3 → [3333, 3333, 3334]', () => {
    expect(splitInstallments(10000, 3)).toEqual([3333, 3333, 3334]);
  });

  it('splits evenly when divisible: 9000 into 3 → [3000, 3000, 3000]', () => {
    expect(splitInstallments(9000, 3)).toEqual([3000, 3000, 3000]);
  });

  it('single installment returns the total', () => {
    expect(splitInstallments(5000, 1)).toEqual([5000]);
  });

  it('sum always equals total (property test)', () => {
    for (let total = 1; total <= 100; total++) {
      for (let n = 1; n <= 12; n++) {
        const parts = splitInstallments(total, n);
        expect(parts.length).toBe(n);
        const sum = parts.reduce((a, b) => a + b, 0);
        expect(sum).toBe(total);
      }
    }
  });

  it('all installments are positive when total >= n', () => {
    const parts = splitInstallments(3, 3);
    expect(parts.every((p) => p > 0)).toBe(true);
  });

  it('throws on invalid n', () => {
    expect(() => splitInstallments(1000, 0)).toThrow();
    expect(() => splitInstallments(1000, -1)).toThrow();
    expect(() => splitInstallments(1000, 1.5)).toThrow();
  });

  it('throws on invalid total', () => {
    expect(() => splitInstallments(-1, 3)).toThrow();
    expect(() => splitInstallments(1.5, 3)).toThrow();
  });
});
