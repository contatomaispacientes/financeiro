import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { DomainException } from '../../common/filters/domain-exception.filter';
import type { Prisma } from '../../generated/prisma/client.js';
import { CONTRACT_PROVIDER, type ContractProvider } from '../../integrations/contracts/contract-provider';
import { WebhookInbox } from './webhook-inbox.service';

const unauthorized = () => new DomainException('WEBHOOK_UNAUTHORIZED', 'Assinatura do webhook inválida', HttpStatus.UNAUTHORIZED);
const unknownProvider = () => new DomainException('NOT_FOUND', 'Provedor de contratos desconhecido', HttpStatus.NOT_FOUND);

/**
 * CTR-04.5: verifica o `Content-Hmac` sobre o corpo bruto, normaliza e persiste cada evento no inbox
 * (origem CONTRACT). Inválido → 401 sem gravar.
 */
@Injectable()
export class ContractWebhookReceiver {
  private readonly logger = new Logger(ContractWebhookReceiver.name);

  constructor(
    @Inject(CONTRACT_PROVIDER) private readonly provider: ContractProvider,
    private readonly inbox: WebhookInbox,
  ) {}

  async receive(providerName: string, headers: Record<string, string | string[] | undefined>, rawBody: Buffer | undefined) {
    if (providerName !== this.provider.name) throw unknownProvider();
    if (!rawBody || !this.provider.verifyWebhook(headers, rawBody)) {
      this.logger.warn(`Webhook de contratos (${providerName}) com assinatura inválida`);
      throw unauthorized();
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw unauthorized();
    }
    for (const event of this.provider.parseWebhook(body)) {
      await this.inbox.store('CONTRACT', {
        externalEventId: event.eventId,
        event: event.type,
        resourceId: 'providerDocumentId' in event ? event.providerDocumentId : null,
        payload: event as unknown as Prisma.InputJsonValue,
      });
    }
  }
}
