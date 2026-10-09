import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../common/filters/domain-exception.filter';

export const contractNotFound = () => new DomainException('NOT_FOUND', 'Contrato não encontrado', HttpStatus.NOT_FOUND);
export const templateNotFound = () => new DomainException('NOT_FOUND', 'Modelo de contrato não encontrado', HttpStatus.NOT_FOUND);

/** CTR-01.3 */
export const templateUnknownVariable = (variables: string[]) =>
  new DomainException('TEMPLATE_UNKNOWN_VARIABLE', `Variável fora do catálogo: ${variables.join(', ')}`, HttpStatus.BAD_REQUEST, { variables });
export const templateInactive = () =>
  new DomainException('TEMPLATE_INACTIVE', 'O modelo está desativado', HttpStatus.UNPROCESSABLE_ENTITY);

export const contractNotDraft = () =>
  new DomainException('CONTRACT_NOT_DRAFT', 'Só contrato em rascunho pode ser editado, enviado ou descartado', HttpStatus.CONFLICT);
/** CTR-06.2, CTR-06.4 */
export const contractNotCancelable = () =>
  new DomainException(
    'CONTRACT_NOT_CANCELABLE',
    'Só contrato enviado e ainda não assinado pode ser cancelado. Assinado: cancele ou estorne a cobrança gerada.',
    HttpStatus.CONFLICT,
  );
/** CTR-02.6 */
export const contractMissingVariables = (missing: string[]) =>
  new DomainException('CONTRACT_MISSING_VARIABLES', `Faltam dados para o modelo: ${missing.join(', ')}`, HttpStatus.UNPROCESSABLE_ENTITY, { missing });
/** CTR-02.9 */
export const customerAddressRequired = () =>
  new DomainException(
    'CUSTOMER_ADDRESS_REQUIRED',
    'O cliente precisa de endereço completo (CEP, logradouro, número, bairro, cidade e UF) para receber contrato',
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
export const contractChargeAlreadyGenerated = () =>
  new DomainException('CONTRACT_CHARGE_ALREADY_GENERATED', 'A cobrança deste contrato já foi gerada', HttpStatus.CONFLICT);
export const contractNotSigned = () =>
  new DomainException('CONTRACT_NOT_SIGNED', 'A cobrança só é gerada depois que todos assinam', HttpStatus.CONFLICT);
export const signerNotPending = () =>
  new DomainException('SIGNER_NOT_PENDING', 'Este signatário não está aguardando assinatura', HttpStatus.CONFLICT);
export const signedFileMissing = () =>
  new DomainException('NOT_FOUND', 'O PDF assinado ainda não foi baixado do provedor', HttpStatus.NOT_FOUND);
