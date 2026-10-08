import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HealthController } from './health.controller';

@Module({
  imports: [BullModule.registerQueue({ name: 'maintenance' })],
  controllers: [HealthController],
})
export class HealthModule {}
