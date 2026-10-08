import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../common/filters/domain-exception.filter';

export const invalidCredentials = () =>
  new DomainException('INVALID_CREDENTIALS', 'E-mail ou senha inválidos', HttpStatus.UNAUTHORIZED);

export const sessionExpired = () =>
  new DomainException('UNAUTHORIZED', 'Sessão expirada. Entre novamente.', HttpStatus.UNAUTHORIZED);
