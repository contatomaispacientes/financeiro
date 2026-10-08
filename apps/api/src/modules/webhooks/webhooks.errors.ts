import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../common/filters/domain-exception.filter';

/** WHK-01.2 */
export const webhookUnauthorized = () =>
  new DomainException('WEBHOOK_UNAUTHORIZED', 'Token do webhook inválido', HttpStatus.UNAUTHORIZED);

/** WHK-01.5 */
export const webhookInvalidBody = () =>
  new DomainException('WEBHOOK_INVALID_BODY', 'Corpo do webhook inválido', HttpStatus.BAD_REQUEST);
