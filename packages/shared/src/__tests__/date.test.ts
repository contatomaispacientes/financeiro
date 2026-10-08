import { describe, it, expect, vi, afterEach } from 'vitest';
import { todayInSaoPaulo, addMonthsClamped, isOverdue } from '../date.js';

describe('todayInSaoPaulo', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a string in YYYY-MM-DD format', () => {
    const result = todayInSaoPaulo();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('handles day boundary — midnight UTC is still previous day in São Paulo (UTC-3)', () => {
    // 2026-10-08 00:00:00 UTC = 2026-10-07 21:00:00 BRT (São Paulo)
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T00:00:00Z'));
    expect(todayInSaoPaulo()).toBe('2026-10-07');
  });

  it('handles day boundary — 03:00 UTC is same day in São Paulo', () => {
    // 2026-10-08 03:00:00 UTC = 2026-10-08 00:00:00 BRT (São Paulo)
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T03:00:00Z'));
    expect(todayInSaoPaulo()).toBe('2026-10-08');
  });
});

describe('addMonthsClamped', () => {
  it('adds 1 month: 2026-01-15 → 2026-02-15', () => {
    expect(addMonthsClamped('2026-01-15', 1)).toBe('2026-02-15');
  });

  it('clamps to end of month: 2026-01-31 + 1 → 2026-02-28', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('clamps to end of month in leap year: 2024-01-31 + 1 → 2024-02-29', () => {
    expect(addMonthsClamped('2024-01-31', 1)).toBe('2024-02-29');
  });

  it('adds 12 months: 2026-03-15 → 2027-03-15', () => {
    expect(addMonthsClamped('2026-03-15', 12)).toBe('2027-03-15');
  });

  it('wraps year: 2026-11-30 + 3 → 2027-02-28', () => {
    expect(addMonthsClamped('2026-11-30', 3)).toBe('2027-02-28');
  });

  it('handles 0 months (no change)', () => {
    expect(addMonthsClamped('2026-06-15', 0)).toBe('2026-06-15');
  });

  it('clamps 2026-03-31 + 1 → 2026-04-30', () => {
    expect(addMonthsClamped('2026-03-31', 1)).toBe('2026-04-30');
  });
});

describe('isOverdue', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true for a past date', () => {
    expect(isOverdue('2020-01-01')).toBe(true);
  });

  it('returns false for a future date', () => {
    expect(isOverdue('2099-12-31')).toBe(false);
  });

  it('returns false for today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T15:00:00Z')); // noon in SP
    expect(isOverdue('2026-10-08')).toBe(false);
  });
});

import { clampDay } from '../date.js';

describe('clampDay', () => {
  it('[DSP-03.2] dia 29–31 em mês curto vira o último dia', () => {
    expect(clampDay('2027-02', 31)).toBe('2027-02-28');
    expect(clampDay('2028-02', 30)).toBe('2028-02-29');
    expect(clampDay('2026-04', 31)).toBe('2026-04-30');
    expect(clampDay('2026-10', 5)).toBe('2026-10-05');
  });
});
