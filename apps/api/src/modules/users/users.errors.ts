import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../common/filters/domain-exception.filter';

export const userNotFound = () =>
  new DomainException('NOT_FOUND', 'Usuário não encontrado', HttpStatus.NOT_FOUND);

export const emailInUse = () =>
  new DomainException('EMAIL_IN_USE', 'Já existe um usuário com este e-mail', HttpStatus.CONFLICT);

export const lastAdmin = () =>
  new DomainException(
    'LAST_ADMIN',
    'Não é possível remover o último administrador ativo',
    HttpStatus.CONFLICT,
  );
