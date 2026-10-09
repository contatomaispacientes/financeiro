import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { REMINDER_DAILY_JOB, REMINDERS_QUEUE, type ReminderJobData } from '../../queues/reminders';
import { RemindersService } from './reminders.service';

/** REG-03.1: cron 09:00 (São Paulo) planeja o dia; cada lembrete é um job próprio com 3 tentativas. */
@Processor(REMINDERS_QUEUE, { concurrency: 2 })
export class RemindersProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(RemindersProcessor.name);

  constructor(
    private readonly reminders: RemindersService,
    @InjectQueue(REMINDERS_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  onApplicationBootstrap() {
    this.queue
      .upsertJobScheduler('reminders-daily', { pattern: '0 9 * * *', tz: 'America/Sao_Paulo' }, { name: REMINDER_DAILY_JOB })
      .catch((error: unknown) => this.logger.error(`Agendamento da régua falhou: ${error instanceof Error ? error.message : error}`));
  }

  async process(job: Job<ReminderJobData>) {
    if (job.name === REMINDER_DAILY_JOB) {
      const { queued } = await this.reminders.runDaily();
      if (queued) this.logger.log(`${queued} lembrete(s) enfileirado(s)`);
      return;
    }
    await this.reminders.send(job.data);
  }
}
