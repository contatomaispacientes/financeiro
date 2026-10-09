import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import {
  CONTRACT_PROVIDER,
  ContractProviderError,
  type ContractProvider,
} from './contract-provider';
import { FakeContractProvider } from './fake-contract.provider';

/** Clicksign entra nas tarefas 12–13 da spec 07 (precisa do sandbox); até lá, falha clara. */
function clicksignPending(): ContractProvider {
  const fail = () => Promise.reject(new ContractProviderError('Clicksign ainda não configurado neste sistema. Use CONTRACT_PROVIDER=fake.'));
  return {
    name: 'clicksign',
    createDocument: fail,
    getDocument: fail,
    cancelDocument: fail,
    resendToSigner: fail,
    downloadSignedFile: fail,
    verifyWebhook: () => false,
    parseWebhook: () => [],
  };
}

/** CTR-08.1: o provedor sai de CONTRACT_PROVIDER, sem mudar o domínio. */
@Module({
  providers: [
    {
      provide: CONTRACT_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('CONTRACT_PROVIDER', { infer: true }) === 'fake' ? new FakeContractProvider(config) : clicksignPending(),
    },
  ],
  exports: [CONTRACT_PROVIDER],
})
export class ContractsProviderModule {}
