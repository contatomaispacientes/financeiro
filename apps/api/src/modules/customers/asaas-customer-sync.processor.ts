import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { ASAAS_CLIENT, type AsaasClient } from '../../integrations/asaas/asaas.client';
import { asaasNotificationDisabled, toAsaasCustomer } from './customers.mapper';

export const ASAAS_CUSTOMER_SYNC_QUEUE = 'asaas-customer-sync';

/**
 * CLI-04.2: leva o estado ATUAL do cliente ao Asaas. Sem jobId fixo (ADR-010): cada edição enfileira
 * um job, e como o job relê o banco ao rodar, o último PUT sempre leva os dados mais recentes.
 */
@Processor(ASAAS_CUSTOMER_SYNC_QUEUE, { concurrency: 1 })
export class AsaasCustomerSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(AsaasCustomerSyncProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ASAAS_CLIENT) private readonly asaas: AsaasClient,
  ) {
    super();
  }

  async process(job: Job<{ customerId: string }>): Promise<void> {
    const customer = await this.prisma.customer.findUnique({ where: { id: job.data.customerId } });
    if (!customer?.asaasCustomerId) return;

    const settings = await this.prisma.settings.findUnique({ where: { id: 1 } });
    const disabled = asaasNotificationDisabled(customer, settings?.reminderChannels ?? ['ASAAS']);
    try {
      await this.asaas.updateCustomer(customer.asaasCustomerId, toAsaasCustomer(customer, disabled));
      if (customer.asaasSyncError) {
        await this.prisma.customer.update({ where: { id: customer.id }, data: { asaasSyncError: null } });
      }
    } catch (error) {
      const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (lastAttempt) {
        const message = error instanceof Error ? error.message : 'Falha ao sincronizar com o Asaas';
        await this.prisma.customer.update({ where: { id: customer.id }, data: { asaasSyncError: message } });
        this.logger.warn(`Cliente ${customer.id} não sincronizado com o Asaas após ${job.attemptsMade + 1} tentativas`);
      }
      throw error;
    }
  }
}
