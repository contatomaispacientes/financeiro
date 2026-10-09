import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AsaasModule } from '../../integrations/asaas/asaas.module';
import { ASAAS_EVENTS_QUEUE, ASAAS_EVENTS_SWEEPER_QUEUE } from '../../queues/asaas-events';
import { AsaasEventsProcessor } from './asaas-events.processor';
import { AsaasEventsSweeper } from './asaas-events.sweeper';
import { PaymentEventProcessor } from './payment-event-processor.service';
import { ReconcileController } from './reconcile.controller';
import { ASAAS_RECONCILE_QUEUE, ReconcileProcessor } from './reconcile.processor';
import { ReconcileService } from './reconcile.service';

@Module({
  imports: [
    AsaasModule,
    BullModule.registerQueue({ name: ASAAS_EVENTS_QUEUE }, { name: ASAAS_EVENTS_SWEEPER_QUEUE }, { name: ASAAS_RECONCILE_QUEUE }),
  ],
  controllers: [ReconcileController],
  providers: [PaymentEventProcessor, AsaasEventsProcessor, AsaasEventsSweeper, ReconcileService, ReconcileProcessor],
  exports: [PaymentEventProcessor],
})
export class PaymentEventsModule {}
