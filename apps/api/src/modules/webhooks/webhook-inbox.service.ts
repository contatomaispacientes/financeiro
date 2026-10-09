import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client.js';
import { enqueueUnique } from '../../queues/enqueue';
import {
  ASAAS_EVENT_JOB,
  ASAAS_EVENT_JOB_OPTIONS,
  ASAAS_EVENTS_QUEUE,
  webhookEventJobId,
} from '../../queues/asaas-events';
import { CONTRACT_EVENT_JOB, CONTRACT_EVENT_JOB_OPTIONS, CONTRACT_EVENTS_QUEUE } from '../../queues/contracts';

/** Origens que chegam por webhook, cada uma com a própria fila. */
export type InboxSource = 'ASAAS' | 'CONTRACT';

export interface InboxEvent {
  externalEventId: string;
  event: string;
  resourceId: string | null;
  payload: Prisma.InputJsonValue;
}

/** ADR-004: persiste o evento bruto uma única vez e só então enfileira o processamento. */
@Injectable()
export class WebhookInbox {
  private readonly logger = new Logger(WebhookInbox.name);
  private readonly queues: Record<InboxSource, { queue: Queue; job: string; opts: typeof ASAAS_EVENT_JOB_OPTIONS }>;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(ASAAS_EVENTS_QUEUE) asaasEvents: Queue,
    @InjectQueue(CONTRACT_EVENTS_QUEUE) contractEvents: Queue,
  ) {
    this.queues = {
      ASAAS: { queue: asaasEvents, job: ASAAS_EVENT_JOB, opts: ASAAS_EVENT_JOB_OPTIONS },
      CONTRACT: { queue: contractEvents, job: CONTRACT_EVENT_JOB, opts: CONTRACT_EVENT_JOB_OPTIONS },
    };
  }

  async store(source: InboxSource, input: InboxEvent): Promise<{ id: string; inserted: boolean }> {
    const id = randomUUID();
    // createMany + skipDuplicates = INSERT … ON CONFLICT DO NOTHING (único por source + external_event_id).
    const { count } = await this.prisma.webhookEvent.createMany({
      data: [{ id, source, ...input }],
      skipDuplicates: true,
    });
    if (count === 0) return { id, inserted: false };

    // Sem await: com o Redis fora do ar o add ficaria preso nas reconexões e o webhook não responderia
    // a tempo. O evento já está salvo; o sweeper (a cada 10 min) enfileira o que ficar para trás.
    const target = this.queues[source];
    enqueueUnique(target.queue, target.job, { webhookEventId: id }, webhookEventJobId(id), target.opts)
      .catch((error: unknown) =>
        this.logger.warn(`Evento ${id} salvo mas não enfileirado: ${error instanceof Error ? error.message : error}`),
      );
    return { id, inserted: true };
  }
}
