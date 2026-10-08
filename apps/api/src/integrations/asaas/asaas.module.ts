import { Module } from '@nestjs/common';
import { ASAAS_CLIENT } from './asaas.client';
import { HttpAsaasClient } from './http-asaas.client';

@Module({
  providers: [{ provide: ASAAS_CLIENT, useClass: HttpAsaasClient }],
  exports: [ASAAS_CLIENT],
})
export class AsaasModule {}
