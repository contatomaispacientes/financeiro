import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { ASAAS_EVENTS_QUEUE, type AsaasEventJobData } from '../../queues/asaas-events';
import { PaymentEventProcessor } from './payment-event-processor.service';

/** WHK-02.1, WHK-02.5: um job por evento; falha relança para o BullMQ tentar de novo (5×, backoff exponencial). */
@Processor(ASAAS_EVENTS_QUEUE, { concurrency: 1 }) // um por vez preserva a ordem de entrega do Asaas
export class AsaasEventsProcessor extends WorkerHost {
  private readonly logger = new Logger(AsaasEventsProcessor.name);

  constructor(private readonly events: PaymentEventProcessor) {
    super();
  }

  async process(job: Job<AsaasEventJobData>) {
    const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    try {
      return await this.events.apply(job.data.webhookEventId, { lastAttempt });
    } catch (error) {
      if (lastAttempt) {
        this.logger.warn(`Evento ${job.data.webhookEventId} não processado após ${job.attemptsMade + 1} tentativas`);
      }
      throw error;
    }
  }
}
