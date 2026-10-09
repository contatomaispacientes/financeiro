import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { REMINDERS_QUEUE } from '../../queues/reminders';
import { ChargesModule } from '../charges/charges.module';
import { RemindersController } from './reminders.controller';
import { RemindersProcessor } from './reminders.processor';
import { RemindersService } from './reminders.service';

@Module({
  imports: [BullModule.registerQueue({ name: REMINDERS_QUEUE }), ChargesModule],
  controllers: [RemindersController],
  providers: [RemindersService, RemindersProcessor],
})
export class RemindersModule {}
