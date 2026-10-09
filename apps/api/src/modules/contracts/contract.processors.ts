import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import {
  CONTRACT_CHARGE_QUEUE,
  CONTRACT_EVENTS_QUEUE,
  CONTRACT_EXPIRATION_QUEUE,
  CONTRACT_FILE_QUEUE,
} from '../../queues/contracts';
import { ContractLifecycleService } from './contract-lifecycle.service';

/** CTR-04: um job por evento do provedor, em ordem. */
@Processor(CONTRACT_EVENTS_QUEUE, { concurrency: 1 })
export class ContractEventsProcessor extends WorkerHost {
  constructor(private readonly lifecycle: ContractLifecycleService) {
    super();
  }

  process(job: Job<{ webhookEventId: string }>) {
    return this.lifecycle.applyEvent(job.data.webhookEventId);
  }
}

/** CTR-05: gera a cobrança; falha relança para o BullMQ tentar de novo (5×). */
@Processor(CONTRACT_CHARGE_QUEUE)
export class ContractChargeProcessor extends WorkerHost {
  private readonly logger = new Logger(ContractChargeProcessor.name);

  constructor(private readonly lifecycle: ContractLifecycleService) {
    super();
  }

  async process(job: Job<{ contractId: string }>) {
    try {
      await this.lifecycle.generateCharge(job.data.contractId);
    } catch (error) {
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        this.logger.warn(`Contrato ${job.data.contractId}: cobrança não gerada após ${job.attemptsMade + 1} tentativas`);
      }
      throw error;
    }
  }
}

/** CTR-04.3 */
@Processor(CONTRACT_FILE_QUEUE)
export class ContractFileProcessor extends WorkerHost {
  constructor(private readonly lifecycle: ContractLifecycleService) {
    super();
  }

  process(job: Job<{ contractId: string }>) {
    return this.lifecycle.downloadSignedFile(job.data.contractId);
  }
}

/** CTR-06.3: todo dia às 07:00 (São Paulo). */
@Processor(CONTRACT_EXPIRATION_QUEUE)
export class ContractExpirationProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(ContractExpirationProcessor.name);

  constructor(
    private readonly lifecycle: ContractLifecycleService,
    @InjectQueue(CONTRACT_EXPIRATION_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  onApplicationBootstrap() {
    this.queue
      .upsertJobScheduler(CONTRACT_EXPIRATION_QUEUE, { pattern: '0 7 * * *', tz: 'America/Sao_Paulo' }, { name: 'expire' })
      .catch((error: unknown) => this.logger.error(`Agendamento da expiração falhou: ${error instanceof Error ? error.message : error}`));
  }

  async process() {
    const expired = await this.lifecycle.expireOverdue();
    if (expired) this.logger.log(`${expired} contrato(s) expirado(s)`);
  }
}
