import { Module } from '@nestjs/common';
import { AsaasModule } from '../../integrations/asaas/asaas.module';
import { CustomersModule } from '../customers/customers.module';
import { ChargesController } from './charges.controller';
import { ChargesService } from './charges.service';

@Module({
  imports: [AsaasModule, CustomersModule],
  controllers: [ChargesController],
  providers: [ChargesService],
  exports: [ChargesService],
})
export class ChargesModule {}
