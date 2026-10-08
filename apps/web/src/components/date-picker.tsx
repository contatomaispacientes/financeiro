import type { ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type DatePickerProps = Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> & {
  /** "AAAA-MM-DD" (DATE, sem hora) ou `null`. */
  value: string | null;
  onChange: (date: string | null) => void;
};

/** Seletor de data nativo: acessível por teclado, calendário do sistema no celular, sem fuso. */
export function DatePicker({ value, onChange, className, ...props }: DatePickerProps) {
  return (
    <Input
      {...props}
      type="date"
      className={cn('tabular', className)}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value || null)}
    />
  );
}
