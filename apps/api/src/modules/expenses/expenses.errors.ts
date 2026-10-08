import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../common/filters/domain-exception.filter';

export const expenseNotFound = () => new DomainException('NOT_FOUND', 'Despesa não encontrada', HttpStatus.NOT_FOUND);
export const recurrenceNotFound = () =>
  new DomainException('NOT_FOUND', 'Recorrência não encontrada', HttpStatus.NOT_FOUND);
export const categoryNotFound = () => new DomainException('NOT_FOUND', 'Categoria não encontrada', HttpStatus.NOT_FOUND);

export const expenseNotEditable = () =>
  new DomainException(
    'EXPENSE_NOT_EDITABLE',
    'Despesa paga ou cancelada só pode ter as observações alteradas',
    HttpStatus.CONFLICT,
  );

export const expenseInvalidState = (action: string) =>
  new DomainException('EXPENSE_INVALID_STATE', `Não é possível ${action} esta despesa no estado atual`, HttpStatus.CONFLICT);

export const categoryInactive = () =>
  new DomainException('CATEGORY_INACTIVE', 'A categoria está desativada', HttpStatus.UNPROCESSABLE_ENTITY);

export const categoryInUse = () =>
  new DomainException(
    'CATEGORY_IN_USE',
    'A categoria tem despesas ou recorrências. Desative-a em vez de excluir.',
    HttpStatus.CONFLICT,
  );

export const categoryDuplicate = () =>
  new DomainException('CATEGORY_DUPLICATE', 'Já existe uma categoria com este nome', HttpStatus.CONFLICT);
