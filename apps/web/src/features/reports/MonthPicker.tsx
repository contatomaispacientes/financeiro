import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addMonthsToYearMonth } from '@financeiro/shared';
import { Button } from '@/components/ui/button';

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function monthLabel(month: string, short = false) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const name = MONTHS[m - 1]!;
  return short ? `${name.slice(0, 3)}/${String(y).slice(2)}` : `${name} de ${y}`;
}

export function MonthPicker({ value, onChange, max }: { value: string; onChange: (m: string) => void; max?: string }) {
  const next = addMonthsToYearMonth(value, 1);
  return (
    <div className="flex items-center gap-1 rounded-lg border bg-card p-1">
      <Button size="icon-sm" variant="ghost" aria-label="Mês anterior" onClick={() => onChange(addMonthsToYearMonth(value, -1))}>
        <ChevronLeft />
      </Button>
      <span className="min-w-36 text-center text-sm font-medium capitalize" aria-live="polite">{monthLabel(value)}</span>
      <Button size="icon-sm" variant="ghost" aria-label="Próximo mês" disabled={max !== undefined && next > max} onClick={() => onChange(next)}>
        <ChevronRight />
      </Button>
    </div>
  );
}
