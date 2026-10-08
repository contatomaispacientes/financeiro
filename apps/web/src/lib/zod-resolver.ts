import type { FieldErrors, FieldValues, Resolver } from 'react-hook-form';
import type { ZodType } from 'zod';

/**
 * Valida o formulário com o schema do shared (o mesmo da API), convertendo os valores da tela
 * para o payload antes. O erro vai para o primeiro segmento do caminho (`address.city` → `city`
 * quando `flatten` é true).
 */
export function zodFormResolver<T extends FieldValues>(
  schema: ZodType,
  toPayload: (values: T) => unknown,
  flatten = false,
): Resolver<T> {
  return async (values) => {
    const result = schema.safeParse(toPayload(values));
    if (result.success) return { values, errors: {} };
    const errors: Record<string, { type: string; message: string }> = {};
    for (const issue of result.error.issues) {
      const field = String(flatten ? issue.path.at(-1) : issue.path[0] ?? '');
      if (field && !errors[field]) errors[field] = { type: issue.code, message: issue.message };
    }
    return { values: {}, errors: errors as FieldErrors<T> };
  };
}
