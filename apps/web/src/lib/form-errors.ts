import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from './http';

/** Erros de domínio que pertencem a um campo específico do formulário. */
const FIELD_ERRORS: Record<string, string> = {
  EMAIL_IN_USE: 'email',
  CUSTOMER_DUPLICATE: 'document',
  CUSTOMER_DOCUMENT_LOCKED: 'document',
};

/**
 * Leva o erro da API para os campos do formulário. Devolve `true` se conseguiu
 * mostrar no campo; senão o chamador exibe a mensagem geral.
 */
export function applyApiError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): boolean {
  if (!(error instanceof ApiError)) return false;

  const field = FIELD_ERRORS[error.code];
  if (field && fields.includes(field as Path<T>)) {
    setError(field as Path<T>, { type: 'server', message: error.message }, { shouldFocus: true });
    return true;
  }

  if (error.code === 'VALIDATION_ERROR' && Array.isArray(error.details)) {
    let applied = false;
    for (const issue of error.details as Array<{ path?: string; message?: string }>) {
      const path = issue.path as Path<T> | undefined;
      if (path && fields.includes(path)) {
        setError(path, { type: 'server', message: issue.message }, { shouldFocus: !applied });
        applied = true;
      }
    }
    return applied;
  }

  return false;
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : 'Não foi possível concluir a operação. Verifique a conexão e tente de novo.';
}
