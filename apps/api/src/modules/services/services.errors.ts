import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../common/filters/domain-exception.filter';

export const serviceNotFound = () =>
  new DomainException('NOT_FOUND', 'Serviço não encontrado', HttpStatus.NOT_FOUND);

/** SRV-01.2 */
export const serviceDuplicate = () =>
  new DomainException('SERVICE_DUPLICATE', 'Já existe um serviço ativo com este nome', HttpStatus.CONFLICT);

/** SRV-02.2 */
export const serviceInUse = () =>
  new DomainException(
    'SERVICE_IN_USE',
    'Este serviço já foi usado em cobranças, assinaturas ou contratos e não pode ser excluído. Desative-o para tirá-lo do catálogo.',
    HttpStatus.CONFLICT,
  );
