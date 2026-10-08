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

/** Origens que chegam por webhook; contratos (spec 07) entram aqui com a própria fila. */
export type InboxSource = 'ASAAS';

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
  private readonly queues: Record<InboxSource, Queue>;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(ASAAS_EVENTS_QUEUE) asaasEvents: Queue,
  ) {
    this.queues = { ASAAS: asaasEvents };
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
    enqueueUnique(this.queues[source], ASAAS_EVENT_JOB, { webhookEventId: id }, webhookEventJobId(id), ASAAS_EVENT_JOB_OPTIONS)
      .catch((error: unknown) =>
        this.logger.warn(`Evento ${id} salvo mas não enfileirado: ${error instanceof Error ? error.message : error}`),
      );
    return { id, inserted: true };
  }
}
