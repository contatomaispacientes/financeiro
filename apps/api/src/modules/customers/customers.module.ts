import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AsaasModule } from '../../integrations/asaas/asaas.module';
import { ASAAS_CUSTOMER_SYNC_QUEUE, AsaasCustomerSyncProcessor } from './asaas-customer-sync.processor';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  imports: [AsaasModule, BullModule.registerQueue({ name: ASAAS_CUSTOMER_SYNC_QUEUE })],
  controllers: [CustomersController],
  providers: [CustomersService, AsaasCustomerSyncProcessor],
  exports: [CustomersService],
})
export class CustomersModule {}
