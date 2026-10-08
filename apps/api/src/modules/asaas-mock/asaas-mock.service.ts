import { HttpStatus, Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { DomainException } from '../../common/filters/domain-exception.filter';
import type { Prisma } from '../../generated/prisma/client.js';
import { ASAAS_CLIENT, type AsaasClient, type AsaasPayment } from '../../integrations/asaas/asaas.client';
import { MockAsaasClient, type MockSimulation } from '../../integrations/asaas/mock-asaas.client';
import { PrismaService } from '../../prisma/prisma.service';
import { WebhookInbox } from '../webhooks/webhook-inbox.service';

const notMock = () => new DomainException('NOT_FOUND', 'Disponível só com o Asaas simulado (ASAAS_ENV=mock)', HttpStatus.NOT_FOUND);

/** ADR-016: liga o Asaas simulado ao inbox de webhooks e expõe as simulações. */
@Injectable()
export class AsaasMockService implements OnModuleInit {
  constructor(
    @Inject(ASAAS_CLIENT) private readonly asaas: AsaasClient,
    private readonly inbox: WebhookInbox,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    if (!(this.asaas instanceof MockAsaasClient)) return;
    this.asaas.onEvent(async (evt) => {
      await this.inbox.store('ASAAS', {
        externalEventId: evt.id,
        event: evt.event,
        resourceId: evt.payment['id'] as string,
        payload: evt as unknown as Prisma.InputJsonValue,
      });
    });
  }

  private get mock(): MockAsaasClient {
    if (!(this.asaas instanceof MockAsaasClient)) throw notMock();
    return this.asaas;
  }

  async simulateCharge(chargeId: string, action: MockSimulation): Promise<AsaasPayment> {
    const mock = this.mock;
    const charge = await this.prisma.charge.findUnique({ where: { id: chargeId }, select: { asaasPaymentId: true } });
    if (!charge) throw new DomainException('NOT_FOUND', 'Cobrança não encontrada', HttpStatus.NOT_FOUND);
    if (!charge.asaasPaymentId) {
      throw new DomainException('CHARGE_NOT_IN_ASAAS', 'A cobrança ainda não está no Asaas', HttpStatus.CONFLICT);
    }
    return mock.simulate(charge.asaasPaymentId, action);
  }

  simulatePayment(paymentId: string, action: MockSimulation) {
    return this.mock.simulate(paymentId, action);
  }

  invoice(paymentId: string) {
    return this.mock.getPayment(paymentId);
  }
}
