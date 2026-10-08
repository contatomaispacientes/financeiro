import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../common/filters/domain-exception.filter';

/** WHK-02.2: evento chegou antes de a cobrança existir (ou sair do rascunho); o BullMQ tenta de novo. */
export const resourceNotYetKnown = () =>
  new DomainException('RESOURCE_NOT_YET_KNOWN', 'Cobrança ainda não encontrada; nova tentativa em instantes', HttpStatus.CONFLICT);

/** Estorno parcial sem a lista `refunds` no payload: não dá para saber o valor deste estorno. */
export const refundValueUnknown = () =>
  new DomainException('REFUND_VALUE_UNKNOWN', 'Valor do estorno parcial ausente no evento', HttpStatus.UNPROCESSABLE_ENTITY);
