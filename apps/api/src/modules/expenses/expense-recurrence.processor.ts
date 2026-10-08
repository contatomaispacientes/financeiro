import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { currentMonthInSaoPaulo } from '@financeiro/shared';
import { ExpensesService } from './expenses.service';

export const EXPENSE_RECURRENCE_QUEUE = 'expense-recurrence';

/** DSP-03.2: todo dia às 05:00 (São Paulo) gera as despesas do mês; a unicidade garante uma por mês. */
@Processor(EXPENSE_RECURRENCE_QUEUE)
export class ExpenseRecurrenceProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(ExpenseRecurrenceProcessor.name);

  constructor(
    private readonly expenses: ExpensesService,
    @InjectQueue(EXPENSE_RECURRENCE_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  onApplicationBootstrap() {
    this.queue
      .upsertJobScheduler(EXPENSE_RECURRENCE_QUEUE, { pattern: '0 5 * * *', tz: 'America/Sao_Paulo' }, { name: 'generate' })
      .catch((error: unknown) => this.logger.error(`Agendamento das recorrências falhou: ${error instanceof Error ? error.message : error}`));
  }

  async process(): Promise<void> {
    const month = currentMonthInSaoPaulo();
    const created = await this.expenses.generateFor(month);
    if (created) this.logger.log(`${created} despesa(s) recorrente(s) gerada(s) para ${month}`);
  }
}
