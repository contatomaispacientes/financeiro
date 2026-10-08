import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import nock from 'nock';
import type { Env } from '../../../config/env.schema';
import { HttpAsaasClient } from '../http-asaas.client';

const SANDBOX = 'https://api-sandbox.asaas.com';
const PRODUCTION = 'https://api.asaas.com';

function clientFor(env: 'sandbox' | 'production' = 'sandbox') {
  const values: Partial<Env> = { ASAAS_ENV: env, ASAAS_API_KEY: '$aact_test_key' };
  const config = { get: (key: keyof Env) => values[key] } as unknown as ConfigService<Env, true>;
  return new HttpAsaasClient(config);
}

describe('HttpAsaasClient.ping', () => {
  beforeAll(() => {
    Logger.overrideLogger(false);
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  it('[FND-04.3] sucesso: chama GET /v3/finance/balance no sandbox com a chave no header', async () => {
    const scope = nock(SANDBOX, {
      reqheaders: { access_token: '$aact_test_key', 'user-agent': /^financeiro\// },
    })
      .get('/v3/finance/balance')
      .reply(200, { balance: 0 });

    const result = await clientFor().ping();

    expect(result).toEqual({ ok: true, latencyMs: expect.any(Number), error: null });
    expect(scope.isDone()).toBe(true);
  });

  it('usa a URL de produção quando ASAAS_ENV=production', async () => {
    const scope = nock(PRODUCTION).get('/v3/finance/balance').reply(200, {});
    expect((await clientFor('production').ping()).ok).toBe(true);
    expect(scope.isDone()).toBe(true);
  });

  it('[FND-04.3] chave recusada (401) → ASAAS_AUTH', async () => {
    nock(SANDBOX).get('/v3/finance/balance').reply(401, { errors: [{ code: 'invalid_access_token' }] });
    const result = await clientFor().ping();
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('ASAAS_AUTH');
  });

  it('[FND-04.3] erro 5xx → ASAAS_UNAVAILABLE, sem retry', async () => {
    const scope = nock(SANDBOX).get('/v3/finance/balance').times(1).reply(503);
    const result = await clientFor().ping();
    expect(result.error?.code).toBe('ASAAS_UNAVAILABLE');
    expect(scope.isDone()).toBe(true);
    expect(nock.pendingMocks()).toHaveLength(0);
  });

  it('429 → ASAAS_RATE_LIMITED', async () => {
    nock(SANDBOX).get('/v3/finance/balance').reply(429);
    expect((await clientFor().ping()).error?.code).toBe('ASAAS_RATE_LIMITED');
  });

  it('[FND-04.3] timeout → ASAAS_UNAVAILABLE', async () => {
    nock(SANDBOX).get('/v3/finance/balance').delay(500).reply(200, {});
    const client = clientFor();
    client.timeoutMs = 50;

    const result = await client.ping();

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('ASAAS_UNAVAILABLE');
  });

  it('falha de rede → ASAAS_UNAVAILABLE', async () => {
    nock(SANDBOX).get('/v3/finance/balance').replyWithError('ECONNRESET');
    expect((await clientFor().ping()).error?.code).toBe('ASAAS_UNAVAILABLE');
  });
});
