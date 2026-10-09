import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { todayInSaoPaulo, type ReminderKind } from '@financeiro/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { enqueueUnique } from '../../queues/enqueue';
import { REMINDER_JOB_OPTIONS, REMINDER_SEND_JOB, REMINDERS_QUEUE, reminderJobId } from '../../queues/reminders';

/**
 * REG-04.2/04.3: mensagens de evento (emitida, paga, estornada, cancelada). Chamado por cobranças e
 * webhooks no lugar de um barramento de eventos; nunca derruba quem chamou (falha só gera log).
 */
@Injectable()
export class ReminderEnqueuer {
  private readonly logger = new Logger(ReminderEnqueuer.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(REMINDERS_QUEUE) private readonly queue: Queue,
  ) {}

  forEvent(chargeId: string, kind: Extract<ReminderKind, 'CREATED' | 'PAID' | 'REFUNDED' | 'CANCELED'>): void {
    this.enqueue(chargeId, kind).catch((error: unknown) =>
      this.logger.warn(`Mensagem ${kind} da cobrança ${chargeId} não enfileirada: ${error instanceof Error ? error.message : error}`),
    );
  }

  private async enqueue(chargeId: string, kind: ReminderKind) {
    const settings = await this.prisma.settings.findUnique({ where: { id: 1 }, select: { reminderChannels: true } });
    // WhatsApp entra na v1.1 (REG-07); o canal ASAAS tem agenda própria no Asaas.
    if (!(settings?.reminderChannels ?? []).includes('EMAIL')) return;
    const template = await this.prisma.reminderTemplate.findFirst({ where: { kind, channel: 'EMAIL', offsetDays: null, active: true } });
    if (!template) return;
    const data = { chargeId, kind, channel: 'EMAIL' as const, offsetDays: 0, referenceDate: todayInSaoPaulo() };
    await enqueueUnique(this.queue, REMINDER_SEND_JOB, data, reminderJobId(data), REMINDER_JOB_OPTIONS);
  }
}

@Global()
@Module({
  imports: [BullModule.registerQueue({ name: REMINDERS_QUEUE })],
  providers: [ReminderEnqueuer],
  exports: [ReminderEnqueuer],
})
export class ReminderQueueModule {}
