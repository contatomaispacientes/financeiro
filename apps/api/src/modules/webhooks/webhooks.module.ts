import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ASAAS_EVENTS_QUEUE } from '../../queues/asaas-events';
import { AsaasWebhookGuard } from './asaas-webhook.guard';
import { WebhookInbox } from './webhook-inbox.service';
import { WebhooksController } from './webhooks.controller';
import { WebhookEventsController } from './webhook-events.controller';
import { WebhookEventsService } from './webhook-events.service';

@Module({
  imports: [BullModule.registerQueue({ name: ASAAS_EVENTS_QUEUE })],
  controllers: [WebhooksController, WebhookEventsController],
  providers: [WebhookInbox, AsaasWebhookGuard, WebhookEventsService],
  exports: [WebhookInbox],
})
export class WebhooksModule {}
