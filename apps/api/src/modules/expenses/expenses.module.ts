import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EXPENSE_RECURRENCE_QUEUE, ExpenseRecurrenceProcessor } from './expense-recurrence.processor';
import { ExpenseCategoriesController, ExpenseRecurrencesController, ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

@Module({
  imports: [BullModule.registerQueue({ name: EXPENSE_RECURRENCE_QUEUE })],
  controllers: [ExpensesController, ExpenseRecurrencesController, ExpenseCategoriesController],
  providers: [ExpensesService, ExpenseRecurrenceProcessor],
  exports: [ExpensesService],
})
export class ExpensesModule {}
