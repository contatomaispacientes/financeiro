import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import nock from 'nock';
import type { Env } from '../../../config/env.schema';
import { AsaasError, HttpAsaasClient } from '../http-asaas.client';
import createdPix from '../../../../test/fixtures/asaas/payments/created-pix.json';
import listEmpty from '../../../../test/fixtures/asaas/payments/list-empty.json';
import pixQrCode from '../../../../test/fixtures/asaas/payments/pix-qrcode.json';
import identificationField from '../../../../test/fixtures/asaas/payments/identification-field.json';
import deleted from '../../../../test/fixtures/asaas/payments/deleted.json';
import validationError from '../../../../test/fixtures/asaas/payments/error-validation.json';

const SANDBOX = 'https://api-sandbox.asaas.com';

function client() {
  const values: Partial<Env> = { ASAAS_ENV: 'sandbox', ASAAS_API_KEY: '$aact_test_key' };
  const config = { get: (key: keyof Env) => values[key] } as unknown as ConfigService<Env, true>;
  const c = new HttpAsaasClient(config);
  c.retryDelaysMs = [0, 0, 0];
  return c;
}

const input = {
  customer: 'cus_G7Dvo4iphUNk',
  billingType: 'PIX' as const,
  valueCents: 135_000,
  dueDate: '2026-10-20',
  description: 'Consultoria (2x) · Setup (1x)',
  externalReference: 'chg_00000000-0000-0000-0000-000000000000',
  finePct: 2,
  interestPct: 1,
};

describe('HttpAsaasClient — payments', () => {
  beforeAll(() => {
    Logger.overrideLogger(false);
    nock.disableNetConnect();
  });
  afterEach(() => nock.cleanAll());
  afterAll(() => nock.enableNetConnect());

  it('[COB-02.1][COB-02.3] createPayment envia reais, multa e juros nos campos próprios e devolve centavos', async () => {
    const bodies: unknown[] = [];
    nock(SANDBOX, { reqheaders: { access_token: '$aact_test_key' } })
      .post('/v3/payments')
      .reply(200, async (req: Request) => {
        bodies.push(await req.json());
        return createdPix;
      });

    const payment = await client().createPayment(input);

    expect(bodies).toEqual([
      {
        customer: 'cus_G7Dvo4iphUNk',
        billingType: 'PIX',
        value: 1350,
        dueDate: '2026-10-20',
        description: 'Consultoria (2x) · Setup (1x)',
        externalReference: input.externalReference,
        fine: { value: 2, type: 'PERCENTAGE' },
        interest: { value: 1 },
      },
    ]);
    expect(payment).toMatchObject({
      id: 'pay_080225913252',
      status: 'PENDING',
      valueCents: 135_000,
      netValueCents: 134_801,
      invoiceUrl: 'https://sandbox.asaas.com/i/080225913252',
      bankSlipUrl: null,
      deleted: false,
    });
  });

  it('createPayment sem multa nem juros não envia os campos', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    nock(SANDBOX)
      .post('/v3/payments')
      .reply(200, async (req: Request) => {
        bodies.push((await req.json()) as Record<string, unknown>);
        return createdPix;
      });
    await client().createPayment({ ...input, finePct: 0, interestPct: 0 });
    expect(bodies[0]).not.toHaveProperty('fine');
    expect(bodies[0]).not.toHaveProperty('interest');
  });

  it('[COB-12.2] POST /payments não é repetido em 503 (evita duplicar)', async () => {
    const scope = nock(SANDBOX).post('/v3/payments').times(2).reply(503);
    const error = await client().createPayment(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AsaasError);
    expect((error as AsaasError).code).toBe('ASAAS_UNAVAILABLE');
    expect(scope.pendingMocks()).toHaveLength(1);
  });

  it('400 → ASAAS_VALIDATION com a mensagem do Asaas', async () => {
    nock(SANDBOX).post('/v3/payments').reply(400, validationError);
    const error = (await client().createPayment(input).catch((e: unknown) => e)) as AsaasError;
    expect(error.code).toBe('ASAAS_VALIDATION');
    expect(error.message).toContain('não pode ser menor que R$ 5,00');
  });

  it('listPayments filtra por externalReference e converte a página', async () => {
    nock(SANDBOX)
      .get('/v3/payments')
      .query({ externalReference: 'chg_x', limit: '10' })
      .reply(200, { ...listEmpty, totalCount: 1, data: [createdPix] });

    const page = await client().listPayments({ externalReference: 'chg_x', limit: 10 });

    expect(page.totalCount).toBe(1);
    expect(page.data[0]).toMatchObject({ id: 'pay_080225913252', valueCents: 135_000 });
  });

  it('getPayment repete em 5xx (GET é seguro)', async () => {
    nock(SANDBOX).get('/v3/payments/pay_080225913252').reply(502);
    nock(SANDBOX).get('/v3/payments/pay_080225913252').reply(200, createdPix);
    await expect(client().getPayment('pay_080225913252')).resolves.toMatchObject({ id: 'pay_080225913252' });
  });

  it('[COB-05.1] Pix copia-e-cola/QR Code e linha digitável', async () => {
    nock(SANDBOX).get('/v3/payments/pay_1/pixQrCode').reply(200, pixQrCode);
    nock(SANDBOX).get('/v3/payments/pay_1/identificationField').reply(200, identificationField);
    const c = client();

    await expect(c.getPixQrCode('pay_1')).resolves.toEqual({
      encodedImage: pixQrCode.encodedImage,
      payload: pixQrCode.payload,
      expirationDate: pixQrCode.expirationDate,
    });
    await expect(c.getIdentificationField('pay_1')).resolves.toEqual({
      identificationField: identificationField.identificationField,
      barCode: identificationField.barCode,
    });
  });

  it('deletePayment chama DELETE /payments/{id}', async () => {
    const scope = nock(SANDBOX).delete('/v3/payments/pay_080225913252').reply(200, deleted);
    await client().deletePayment('pay_080225913252');
    expect(scope.isDone()).toBe(true);
  });
});
