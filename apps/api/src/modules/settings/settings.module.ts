import { Module } from '@nestjs/common';
import { AsaasModule } from '../../integrations/asaas/asaas.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  imports: [AsaasModule],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
