import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { requeue } from '../../queues/enqueue';
import {
  ASAAS_EVENT_JOB,
  ASAAS_EVENT_JOB_OPTIONS,
  ASAAS_EVENT_MAX_ATTEMPTS,
  ASAAS_EVENTS_QUEUE,
  ASAAS_EVENTS_SWEEPER_QUEUE,
  webhookEventJobId,
} from '../../queues/asaas-events';

const EVERY_MS = 10 * 60_000;
const GRACE_MS = 2 * 60_000;

/**
 * Reenfileira eventos salvos e não processados (ex.: Redis fora do ar na hora do webhook).
 * Job repetível do BullMQ a cada 10 min (overview.md › Filas).
 */
@Processor(ASAAS_EVENTS_SWEEPER_QUEUE)
export class AsaasEventsSweeper extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(AsaasEventsSweeper.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(ASAAS_EVENTS_SWEEPER_QUEUE) private readonly sweeperQueue: Queue,
    @InjectQueue(ASAAS_EVENTS_QUEUE) private readonly eventsQueue: Queue,
  ) {
    super();
  }

  onApplicationBootstrap() {
    // Sem await: não segura a subida da API se o Redis estiver fora (o health check acusa).
    this.sweeperQueue
      .upsertJobScheduler(ASAAS_EVENTS_SWEEPER_QUEUE, { every: EVERY_MS }, { name: 'sweep' })
      .catch((error: unknown) => this.logger.error(`Agendamento do sweeper falhou: ${error instanceof Error ? error.message : error}`));
  }

  process() {
    return this.sweep();
  }

  /** Retorna quantos eventos voltaram para a fila. */
  async sweep(): Promise<number> {
    const pending = await this.prisma.webhookEvent.findMany({
      where: {
        source: 'ASAAS',
        processedAt: null,
        attempts: { lt: ASAAS_EVENT_MAX_ATTEMPTS },
        receivedAt: { lt: new Date(Date.now() - GRACE_MS) },
      },
      select: { id: true },
      orderBy: { receivedAt: 'asc' },
      take: 500,
    });

    let queued = 0;
    for (const { id } of pending) {
      const job = { webhookEventId: id };
      if (await requeue(this.eventsQueue, ASAAS_EVENT_JOB, job, webhookEventJobId(id), ASAAS_EVENT_JOB_OPTIONS)) queued++;
    }
    if (queued) this.logger.warn(`${queued} evento(s) do Asaas reenfileirado(s) pelo sweeper`);
    return queued;
  }
}
