import { Module } from '@nestjs/common';
import { AsaasModule } from '../../integrations/asaas/asaas.module';
import { CustomersModule } from '../customers/customers.module';
import { SubscriptionsController } from '../subscriptions/subscriptions.controller';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { ChargesController } from './charges.controller';
import { ChargesService } from './charges.service';

@Module({
  imports: [AsaasModule, CustomersModule],
  controllers: [ChargesController, SubscriptionsController],
  providers: [ChargesService, SubscriptionsService],
  exports: [ChargesService, SubscriptionsService],
})
export class ChargesModule {}
