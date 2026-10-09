import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ContractsProviderModule } from '../../integrations/contracts/contracts-provider.module';
import {
  CONTRACT_CHARGE_QUEUE,
  CONTRACT_EVENTS_QUEUE,
  CONTRACT_EXPIRATION_QUEUE,
  CONTRACT_FILE_QUEUE,
} from '../../queues/contracts';
import { ChargesModule } from '../charges/charges.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { ContractLifecycleService } from './contract-lifecycle.service';
import {
  ContractChargeProcessor,
  ContractEventsProcessor,
  ContractExpirationProcessor,
  ContractFileProcessor,
} from './contract.processors';
import { ContractTemplatesService } from './contract-templates.service';
import { ContractsController, ContractTemplatesController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { DevFakeSignController } from './dev-fake-sign.controller';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: CONTRACT_EVENTS_QUEUE },
      { name: CONTRACT_CHARGE_QUEUE },
      { name: CONTRACT_FILE_QUEUE },
      { name: CONTRACT_EXPIRATION_QUEUE },
    ),
    ContractsProviderModule,
    ChargesModule,
    WebhooksModule,
  ],
  controllers: [ContractTemplatesController, ContractsController, DevFakeSignController],
  providers: [
    ContractTemplatesService,
    ContractsService,
    ContractLifecycleService,
    ContractEventsProcessor,
    ContractChargeProcessor,
    ContractFileProcessor,
    ContractExpirationProcessor,
  ],
  exports: [ContractLifecycleService],
})
export class ContractsModule {}
