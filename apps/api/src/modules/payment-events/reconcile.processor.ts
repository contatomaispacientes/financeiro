import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { ReconcileService } from './reconcile.service';

export const ASAAS_RECONCILE_QUEUE = 'asaas-reconcile';

/** WHK-04.1: todo dia às 06:00; WHK-NF3: limpeza mensal (dia 1, 04:00). Fuso de São Paulo. */
@Processor(ASAAS_RECONCILE_QUEUE)
export class ReconcileProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReconcileProcessor.name);

  constructor(
    private readonly reconcile: ReconcileService,
    @InjectQueue(ASAAS_RECONCILE_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  onApplicationBootstrap() {
    const fail = (error: unknown) => this.logger.error(`Agendamento falhou: ${error instanceof Error ? error.message : error}`);
    this.queue.upsertJobScheduler('reconcile-daily', { pattern: '0 6 * * *', tz: 'America/Sao_Paulo' }, { name: 'reconcile' }).catch(fail);
    this.queue.upsertJobScheduler('retention-monthly', { pattern: '0 4 1 * *', tz: 'America/Sao_Paulo' }, { name: 'retention' }).catch(fail);
  }

  async process(job: Job) {
    if (job.name === 'retention') {
      const removed = await this.reconcile.prune();
      if (removed) this.logger.log(`${removed} evento(s) antigo(s) removido(s)`);
      return;
    }
    const s = await this.reconcile.run('CRON');
    this.logger.log(`Reconciliação: ${s.checked} verificadas, ${s.fixed} corrigidas, ${s.imported} importadas, ${s.errors} erros`);
  }
}
