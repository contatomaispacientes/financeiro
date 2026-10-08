import { HttpStatus } from '@nestjs/common';
import type { ChargeCreateFailureDetails, PlanErrorCode } from '@financeiro/shared';
import { DomainException } from '../../common/filters/domain-exception.filter';
import type { AsaasError } from '../../integrations/asaas/http-asaas.client';

export const chargeNotFound = () =>
  new DomainException('NOT_FOUND', 'Cobrança não encontrada', HttpStatus.NOT_FOUND);

/** COB-01.6 */
export const customerArchived = () =>
  new DomainException('CUSTOMER_ARCHIVED', 'Cliente arquivado não recebe nova cobrança', HttpStatus.UNPROCESSABLE_ENTITY);

/** COB-01.5: erros de `calculatePlan`. */
export const planError = (error: { code: PlanErrorCode; message: string }) =>
  new DomainException(error.code, error.message, HttpStatus.UNPROCESSABLE_ENTITY);

export const chargeNotDraft = () =>
  new DomainException(
    'CHARGE_NOT_DRAFT',
    'Só cobrança em rascunho pode ser reenviada ao Asaas ou descartada',
    HttpStatus.CONFLICT,
  );

/** COB-12.3 */
export const retryDueDateInPast = () =>
  new DomainException(
    'DUE_DATE_IN_PAST',
    'O vencimento já passou e a cobrança não chegou ao Asaas. Descarte este rascunho e crie outra cobrança.',
    HttpStatus.UNPROCESSABLE_ENTITY,
  );

/** COB-12.1: mesmo código e status do erro do Asaas, com os rascunhos para "Tentar de novo"/"Descartar". */
export const asaasCreateFailed = (error: AsaasError, chargeIds: string[]) =>
  new DomainException(error.code, error.message, error.httpStatus, { chargeIds } satisfies ChargeCreateFailureDetails);

/** COB-08.3 */
export const chargeNotCancelable = () =>
  new DomainException('CHARGE_NOT_CANCELABLE', 'Só cobrança pendente ou vencida pode ser cancelada', HttpStatus.CONFLICT);

/** COB-09.1 */
export const chargeNotRefundable = () =>
  new DomainException('CHARGE_NOT_REFUNDABLE', 'Só cobrança paga pode ser estornada', HttpStatus.CONFLICT);

/** COB-09.3 */
export const refundExceedsValue = (balanceCents: number) =>
  new DomainException('REFUND_EXCEEDS_VALUE', 'O valor passa do saldo que ainda pode ser estornado', HttpStatus.UNPROCESSABLE_ENTITY, {
    balanceCents,
  });

export const subscriptionNotFound = () =>
  new DomainException('NOT_FOUND', 'Recorrência não encontrada', HttpStatus.NOT_FOUND);

/** COB-11 */
export const subscriptionNotCancelable = () =>
  new DomainException('SUBSCRIPTION_NOT_CANCELABLE', 'Esta recorrência já está encerrada', HttpStatus.CONFLICT);

export const subscriptionAlreadySent = () =>
  new DomainException('SUBSCRIPTION_ALREADY_SENT', 'Esta recorrência já foi criada no Asaas', HttpStatus.CONFLICT);
