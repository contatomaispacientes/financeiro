import { HttpStatus } from '@nestjs/common';
import type { AuthMethod, ContractProviderName } from '@financeiro/shared';
import { DomainException } from '../../common/filters/domain-exception.filter';

export const CONTRACT_PROVIDER = Symbol('CONTRACT_PROVIDER');

/** Ids já criados no provedor em tentativas anteriores (o Clicksign cria em várias chamadas). */
export interface ProviderProgress {
  envelopeId?: string;
  documentId?: string;
  /** contract_signers.id → id no provedor */
  signerIds?: Record<string, string>;
  requirementsDone?: boolean;
  activated?: boolean;
}

export interface CreateDocumentInput {
  externalId: string;
  title: string;
  templateId: string;
  fields: Record<string, string>;
  signers: Array<{
    externalId: string;
    name: string;
    email: string;
    phone?: string;
    document?: string;
    role: 'CLIENT' | 'COMPANY';
    order: number;
    authMethod: AuthMethod;
  }>;
  expiresAt?: Date;
  locale: 'pt-BR';
  resume?: ProviderProgress;
  onProgress?: (p: ProviderProgress) => Promise<void>;
}

export interface ProviderDocument {
  providerEnvelopeId?: string;
  providerDocumentId: string;
  status: 'PENDING' | 'SIGNED' | 'REFUSED' | 'EXPIRED' | 'CANCELED';
  signers: Array<{ externalId: string; providerSignerId: string; signUrl?: string; status: 'PENDING' | 'SIGNED' | 'REFUSED'; signedAt?: Date }>;
}

export type NormalizedContractEvent =
  | { type: 'SIGNER_SIGNED'; eventId: string; providerDocumentId: string; providerSignerId?: string; signerEmail?: string; at: string }
  | { type: 'SIGNER_REFUSED'; eventId: string; providerDocumentId: string; providerSignerId?: string; signerEmail?: string; at: string; reason?: string }
  | { type: 'DOCUMENT_COMPLETED'; eventId: string; providerDocumentId: string; at: string; signedFileUrl?: string }
  | { type: 'DOCUMENT_EXPIRED'; eventId: string; providerDocumentId: string; at: string }
  | { type: 'DOCUMENT_CANCELED'; eventId: string; providerDocumentId: string; at: string }
  | { type: 'IGNORED'; eventId: string; raw: string };

/** Contrato com o provedor de assinatura (docs/integrations/contratos-provider.md, ADR-005). */
export interface ContractProvider {
  readonly name: ContractProviderName;
  createDocument(input: CreateDocumentInput): Promise<ProviderDocument>;
  getDocument(providerDocumentId: string): Promise<ProviderDocument>;
  cancelDocument(providerDocumentId: string): Promise<void>;
  resendToSigner(providerDocumentId: string, providerSignerId: string): Promise<void>;
  downloadSignedFile(providerDocumentId: string): Promise<{ contentType: string; data: Buffer }>;
  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): boolean;
  parseWebhook(body: unknown): NormalizedContractEvent[];
}

/** CTR-03.3: falha no provedor mantém o rascunho e mostra a mensagem. */
export class ContractProviderError extends DomainException {
  constructor(message: string) {
    super('CONTRACT_PROVIDER_ERROR', message, HttpStatus.BAD_GATEWAY);
  }
}
