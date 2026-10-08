import { auditDiff } from '../audit-diff';

describe('auditDiff', () => {
  it('[FND-04.4] registra só os campos alterados, com antes e depois', () => {
    const before = { name: 'Ana', role: 'LEITURA', active: true, passwordHash: 'x' };
    const after = { name: 'Ana', role: 'ADMIN', active: false, passwordHash: 'y' };

    expect(auditDiff(before, after, ['name', 'role', 'active'])).toEqual({
      before: { role: 'LEITURA', active: true },
      after: { role: 'ADMIN', active: false },
    });
  });

  it('nunca inclui campos fora da lista (ex.: hash de senha)', () => {
    const diff = auditDiff({ a: 1, passwordHash: 'x' }, { a: 2, passwordHash: 'y' }, ['a']);
    expect(JSON.stringify(diff)).not.toContain('passwordHash');
  });

  it('compara datas e arrays por valor', () => {
    const d = new Date('2026-10-07T12:00:00Z');
    expect(
      auditDiff({ at: d, days: [1, 7] }, { at: new Date(d), days: [1, 7] }, ['at', 'days']),
    ).toBeNull();
  });
});
