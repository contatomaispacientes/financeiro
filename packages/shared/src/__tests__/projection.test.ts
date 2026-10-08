import { describe, it, expect } from 'vitest';
import { addMonthsToYearMonth, projectSubscriptionDueDates } from '../projection.js';

describe('projectSubscriptionDueDates', () => {
  it('[FLX-02.3] mensal: vencimentos do mês consultado, preservando fim de mês', () => {
    expect(projectSubscriptionDueDates('2026-10-31', 'MONTHLY', null, '2027-02-01', '2027-02-28')).toEqual(['2027-02-28']);
    expect(projectSubscriptionDueDates('2026-10-31', 'MONTHLY', null, '2027-03-01', '2027-03-31')).toEqual(['2027-03-31']);
  });

  it('[FLX-02.3] semanal gera várias datas; respeita a data final', () => {
    expect(projectSubscriptionDueDates('2026-11-02', 'WEEKLY', null, '2026-11-01', '2026-11-30')).toEqual([
      '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30',
    ]);
    expect(projectSubscriptionDueDates('2026-11-02', 'WEEKLY', '2026-11-10', '2026-11-01', '2026-11-30')).toEqual(['2026-11-02', '2026-11-09']);
  });

  it('trimestral fora do mês não projeta', () => {
    expect(projectSubscriptionDueDates('2026-10-15', 'QUARTERLY', null, '2026-11-01', '2026-11-30')).toEqual([]);
  });

  it('addMonthsToYearMonth', () => {
    expect(addMonthsToYearMonth('2026-11', 3)).toBe('2027-02');
    expect(addMonthsToYearMonth('2026-03', -6)).toBe('2025-09');
  });
});
