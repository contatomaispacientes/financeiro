import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ContractsProviderModule } from '../../integrations/contracts/contracts-provider.module';
import { ASAAS_EVENTS_QUEUE } from '../../queues/asaas-events';
import { CONTRACT_EVENTS_QUEUE } from '../../queues/contracts';
import { AsaasWebhookGuard } from './asaas-webhook.guard';
import { ContractWebhookReceiver } from './contract-webhook.receiver';
import { WebhookInbox } from './webhook-inbox.service';
import { WebhooksController } from './webhooks.controller';
import { WebhookEventsController } from './webhook-events.controller';
import { WebhookEventsService } from './webhook-events.service';

@Module({
  imports: [BullModule.registerQueue({ name: ASAAS_EVENTS_QUEUE }, { name: CONTRACT_EVENTS_QUEUE }), ContractsProviderModule],
  controllers: [WebhooksController, WebhookEventsController],
  providers: [WebhookInbox, AsaasWebhookGuard, WebhookEventsService, ContractWebhookReceiver],
  exports: [WebhookInbox, ContractWebhookReceiver],
})
export class WebhooksModule {}
