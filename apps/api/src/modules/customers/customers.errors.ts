import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../common/filters/domain-exception.filter';

export const customerNotFound = () =>
  new DomainException('NOT_FOUND', 'Cliente não encontrado', HttpStatus.NOT_FOUND);

/** CLI-01.3: inclui qual cliente já usa o documento (também se arquivado). */
export const customerDuplicate = (existing: { id: string; name: string; archivedAt: Date | null }) =>
  new DomainException(
    'CUSTOMER_DUPLICATE',
    existing.archivedAt
      ? `Já existe um cliente arquivado com este documento: ${existing.name}`
      : `Já existe um cliente com este documento: ${existing.name}`,
    HttpStatus.CONFLICT,
    { customerId: existing.id, name: existing.name, archived: existing.archivedAt !== null },
  );

/** CLI-04.4 */
export const customerHasOpenItems = (counts: { charges: number; subscriptions: number; contracts: number }) =>
  new DomainException(
    'CUSTOMER_HAS_OPEN_ITEMS',
    'Não dá para arquivar: há cobrança em aberto, assinatura ativa ou contrato em andamento',
    HttpStatus.CONFLICT,
    counts,
  );

export type DocumentLockReason = 'ASAAS_CUSTOMER' | 'CHARGES' | 'CONTRACTS';

/** CLI-04.3 */
export const customerDocumentLocked = (reasons: DocumentLockReason[]) =>
  new DomainException(
    'CUSTOMER_DOCUMENT_LOCKED',
    'O documento não pode mudar: o cliente já tem cadastro no Asaas, cobrança emitida ou contrato enviado',
    HttpStatus.CONFLICT,
    { reasons },
  );
