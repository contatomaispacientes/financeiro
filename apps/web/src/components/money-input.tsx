import type { ComponentProps } from 'react';
import { formatBRL } from '@financeiro/shared';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// Até R$ 99.999.999.999,99: cabe em Number sem perder precisão.
const MAX_DIGITS = 13;

type MoneyInputProps = Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> & {
  /** Valor em centavos (inteiro). `null` = campo vazio. */
  value: number | null;
  onChange: (cents: number | null) => void;
};

/**
 * Campo de valor em R$ com máscara: os dígitos entram pela direita, como em caixa eletrônico
 * ("1", "12", "123" → R$ 0,01, R$ 0,12, R$ 1,23). Devolve centavos; nunca float (ADR-002).
 */
export function MoneyInput({ value, onChange, className, ...props }: MoneyInputProps) {
  return (
    <Input
      {...props}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      className={cn('tabular text-right', className)}
      value={value === null ? '' : formatBRL(value)}
      onChange={(event) => {
        const digits = event.target.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, MAX_DIGITS);
        onChange(digits ? Number(digits) : null);
      }}
      onFocus={(event) => {
        const input = event.currentTarget;
        requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length));
        props.onFocus?.(event);
      }}
    />
  );
}
