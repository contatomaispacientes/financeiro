import { Module } from '@nestjs/common';
import { AsaasModule } from '../../integrations/asaas/asaas.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { AsaasMockController } from './asaas-mock.controller';
import { AsaasMockService } from './asaas-mock.service';

@Module({
  imports: [AsaasModule, WebhooksModule],
  controllers: [AsaasMockController],
  providers: [AsaasMockService],
})
export class AsaasMockModule {}
