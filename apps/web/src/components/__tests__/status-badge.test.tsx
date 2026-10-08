import { render, screen } from '@testing-library/react';
import { StatusBadge, statusLabel } from '../status-badge';

describe('StatusBadge', () => {
  it.each([
    ['PENDING', 'Pendente', 'amber'],
    ['CONFIRMED', 'Confirmado', 'sky'],
    ['PAID', 'Pago', 'emerald'],
    ['OVERDUE', 'Vencido', 'red'],
    ['CANCELED', 'Cancelado', 'zinc'],
    ['REFUNDED', 'Estornado', 'violet'],
  ] as const)('cobrança %s → "%s" em %s (texto + cor, telas.md)', (status, label, color) => {
    render(<StatusBadge kind="charge" status={status} />);
    const badge = screen.getByText(label);
    expect(badge.className).toContain(`bg-${color}-100`);
  });

  it('cobre os demais tipos', () => {
    expect(statusLabel('contract', 'PARTIALLY_SIGNED')).toBe('Parcialmente assinado');
    expect(statusLabel('expense', 'OVERDUE')).toBe('Atrasada');
    expect(statusLabel('subscription', 'ACTIVE')).toBe('Ativa');
  });
});
