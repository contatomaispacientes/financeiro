import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AsaasModule } from '../../integrations/asaas/asaas.module';
import { ASAAS_CUSTOMER_SYNC_QUEUE } from '../customers/asaas-customer-sync.processor';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  imports: [AsaasModule, BullModule.registerQueue({ name: ASAAS_CUSTOMER_SYNC_QUEUE })],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
