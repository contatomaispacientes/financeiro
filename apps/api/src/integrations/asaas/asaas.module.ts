import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { ASAAS_CLIENT } from './asaas.client';
import { HttpAsaasClient } from './http-asaas.client';
import { MockAsaasClient } from './mock-asaas.client';

@Module({
  providers: [
    {
      provide: ASAAS_CLIENT,
      inject: [ConfigService],
      // ADR-016: ASAAS_ENV=mock troca a API real pelo simulador local.
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('ASAAS_ENV', { infer: true }) === 'mock' ? new MockAsaasClient(config) : new HttpAsaasClient(config),
    },
  ],
  exports: [ASAAS_CLIENT],
})
export class AsaasModule {}
