import type { ReactNode } from 'react';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';

/** Props de acessibilidade para o controle dentro de um FormField. */
export function fieldAria(id: string, error?: string, description?: boolean) {
  const describedBy = [error ? `${id}-error` : null, description ? `${id}-description` : null]
    .filter(Boolean)
    .join(' ');
  return {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy || undefined,
  } as const;
}

export function FormField({
  id,
  label,
  error,
  description,
  className,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  description?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Field data-invalid={error ? true : undefined} className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children}
      {description && <FieldDescription id={`${id}-description`}>{description}</FieldDescription>}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </Field>
  );
}
