import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ASAAS_EVENTS_QUEUE, ASAAS_EVENTS_SWEEPER_QUEUE } from '../../queues/asaas-events';
import { AsaasEventsProcessor } from './asaas-events.processor';
import { AsaasEventsSweeper } from './asaas-events.sweeper';
import { PaymentEventProcessor } from './payment-event-processor.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: ASAAS_EVENTS_QUEUE }, { name: ASAAS_EVENTS_SWEEPER_QUEUE }),
  ],
  providers: [PaymentEventProcessor, AsaasEventsProcessor, AsaasEventsSweeper],
  exports: [PaymentEventProcessor],
})
export class PaymentEventsModule {}
