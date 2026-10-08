import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import nock from 'nock';
import { addDays, ChargePlanSchema, todayInSaoPaulo, type ChargePlanInput } from '@financeiro/shared';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ChargesService } from '../../src/modules/charges/charges.service';
import type { DomainException } from '../../src/common/filters/domain-exception.filter';
import { billingFixtures } from '../fixtures/billing';
import createdPix from '../fixtures/asaas/payments/created-pix.json';
import createdBoleto from '../fixtures/asaas/payments/created-boleto.json';
import listEmpty from '../fixtures/asaas/payments/list-empty.json';
import pixQrCode from '../fixtures/asaas/payments/pix-qrcode.json';
import identificationField from '../fixtures/asaas/payments/identification-field.json';
import { createTestApp, loginAs } from './test-app';

const ASAAS = 'https://api-sandbox.asaas.com';
const due = addDays(todayInSaoPaulo(), 10);

/** Subtotal R$ 1.400,00 − desconto R$ 50,00 = R$ 1.350,00. */
function plan(overrides: Partial<ChargePlanInput> = {}): ChargePlanInput {
  return {
    items: [
      { description: 'Consultoria', quantity: 2, unitPriceCents: 60_000 },
      { description: 'Setup', quantity: 1, unitPriceCents: 20_000 },
    ],
    type: 'SINGLE',
    billingType: 'PIX',
    dueDate: { mode: 'FIXED_DATE', date: due },
    discountCents: 5_000,
    finePct: 2,
    interestPct: 1,
    ...overrides,
  };
}

function mockListPayments(data: unknown[] = []) {
  return nock(ASAAS).get('/v3/payments').query(true).reply(200, { ...listEmpty, totalCount: data.length, data });
}

/** POST /payments ecoa os campos enviados sobre a fixture; corpo capturado no reply (ADR-014). */
function mockCreatePayment(fixture: typeof createdPix, id: string, bodies: Array<Record<string, unknown>> = []) {
  return nock(ASAAS)
    .post('/v3/payments')
    .reply(200, async (req: Request) => {
      const body = (await req.json()) as Record<string, unknown>;
      bodies.push(body);
      return { ...fixture, ...body, id };
    });
}

describe('Cobranças avulsas (integração)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: ChargesService;
  let fx: ReturnType<typeof billingFixtures>;
  let fin: string;
  let leitura: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    service = app.get(ChargesService);
    fx = billingFixtures(prisma);
    fin = (await loginAs(app, 'FINANCEIRO')).auth;
    leitura = (await loginAs(app, 'LEITURA')).auth;
  });

  afterEach(() => nock.cleanAll());
  afterAll(async () => {
    await app?.close();
  });

  it('[COB-01.4] prévia: totais, requisições ao Asaas e nenhum efeito colateral', async () => {
    const c = await fx.customer();

    const res = await http().post('/api/v1/charges/preview').set('Authorization', fin).send({ customerId: c.id, plan: plan() });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      subtotalCents: 140_000,
      discountCents: 5_000,
      totalCents: 135_000,
      firstDueDate: due,
      installments: [{ number: 1, dueDate: due, valueCents: 135_000 }],
      description: 'Consultoria (2x) · Setup (1x)',
      customerWillBeCreated: true,
    });
    const requests = res.body.asaasRequests as Array<{ method: string; path: string; body?: unknown }>;
    expect(requests.map((r) => `${r.method} ${r.path.split('?')[0]}`)).toEqual([
      'GET /customers',
      'POST /customers',
      'POST /payments',
    ]);
    expect(requests[2]?.body).toMatchObject({ value: 1350, dueDate: due, fine: { value: 2, type: 'PERCENTAGE' }, interest: { value: 1 } });
    expect(await prisma.charge.count({ where: { customerId: c.id } })).toBe(0);
  });

  it('[COB-02.1][COB-02.2][COB-02.3][COB-02.4][COB-05.2][COB-NF2] avulsa Pix: cria o cliente no Asaas no meio e espelha', async () => {
    const c = await fx.customer();
    const bodies: Array<Record<string, unknown>> = [];
    nock(ASAAS).get('/v3/customers').query({ cpfCnpj: c.document }).reply(200, { data: [] });
    nock(ASAAS).post('/v3/customers').reply(200, { id: 'cus_novo_cob', name: c.name, cpfCnpj: c.document });
    mockListPayments();
    mockCreatePayment(createdPix, 'pay_feliz', bodies);
    nock(ASAAS).get('/v3/payments/pay_feliz/pixQrCode').reply(200, pixQrCode);

    const res = await http().post('/api/v1/charges').set('Authorization', fin).send({ customerId: c.id, plan: plan() });

    expect(res.status).toBe(201);
    const [charge] = res.body.charges;
    expect(bodies).toEqual([
      {
        customer: 'cus_novo_cob',
        billingType: 'PIX',
        value: 1350,
        dueDate: due,
        description: 'Consultoria (2x) · Setup (1x)',
        externalReference: `chg_${charge.id}`,
        fine: { value: 2, type: 'PERCENTAGE' },
        interest: { value: 1 },
      },
    ]);
    expect(charge).toMatchObject({
      status: 'PENDING',
      origin: 'MANUAL',
      valueCents: 135_000,
      discountCents: 5_000,
      asaasPaymentId: 'pay_feliz',
      invoiceUrl: createdPix.invoiceUrl,
      pixPayload: pixQrCode.payload,
      lastError: null,
    });
    expect(charge.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ description: 'Consultoria', quantity: 2, unitPriceCents: 60_000, totalCents: 120_000 }),
        expect.objectContaining({ description: 'Setup', quantity: 1, unitPriceCents: 20_000, totalCents: 20_000 }),
      ]),
    );
    expect((await prisma.customer.findUnique({ where: { id: c.id } }))?.asaasCustomerId).toBe('cus_novo_cob');
    expect(await prisma.auditLog.count({ where: { action: 'charge.create', entityId: charge.id } })).toBe(1);
    expect(nock.pendingMocks()).toEqual([]);
  });

  it.each([
    ['DISCOUNT_EXCEEDS_SUBTOTAL', { discountCents: 999_999 }],
    ['CHARGE_TOTAL_ZERO', { items: [{ description: 'Brinde', quantity: 1, unitPriceCents: 0 }], discountCents: 0 }],
    ['DUE_DATE_IN_PAST', { dueDate: { mode: 'FIXED_DATE' as const, date: addDays(todayInSaoPaulo(), -1) } }],
    ['CHARGE_BELOW_MINIMUM', { items: [{ description: 'Taxa', quantity: 1, unitPriceCents: 100 }], discountCents: 0 }],
    ['END_DATE_BEFORE_FIRST_DUE', { type: 'RECURRING' as const, cycle: 'MONTHLY' as const, endDate: due }],
  ])('[COB-01.5] recusa %s com 422 sem criar nada', async (code, overrides) => {
    const c = await fx.customer({ asaasCustomerId: `cus_${randomUUID()}` });
    const res = await http().post('/api/v1/charges').set('Authorization', fin).send({ customerId: c.id, plan: plan(overrides) });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe(code);
    expect(await prisma.charge.count({ where: { customerId: c.id } })).toBe(0);
  });

  it('[COB-01.6] cliente arquivado → CUSTOMER_ARCHIVED na prévia e na criação', async () => {
    const c = await fx.customer({ archivedAt: new Date() });
    for (const path of ['/api/v1/charges/preview', '/api/v1/charges']) {
      const res = await http().post(path).set('Authorization', fin).send({ customerId: c.id, plan: plan() });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('CUSTOMER_ARCHIVED');
    }
  });

  it('LEITURA não gera prévia nem cobrança', async () => {
    const c = await fx.customer();
    for (const path of ['/api/v1/charges/preview', '/api/v1/charges']) {
      const res = await http().post(path).set('Authorization', leitura).send({ customerId: c.id, plan: plan() });
      expect(res.status).toBe(403);
    }
  });

  it('[COB-12.1][COB-12.2] Asaas fora → DRAFT com erro; retry acha a cobrança já criada e não duplica', async () => {
    const c = await fx.customer({ asaasCustomerId: 'cus_retry' });
    mockListPayments();
    nock(ASAAS).post('/v3/payments').reply(502);

    const res = await http()
      .post('/api/v1/charges')
      .set('Authorization', fin)
      .send({ customerId: c.id, plan: plan({ billingType: 'BOLETO' }) });

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('ASAAS_UNAVAILABLE');
    const [id] = res.body.error.details.chargeIds as string[];
    const draft = await prisma.charge.findUniqueOrThrow({ where: { id } });
    expect(draft.status).toBe('DRAFT');
    expect(draft.lastError).toBeTruthy();

    // Asaas ainda fora: 200 com o rascunho e o erro, para a tela oferecer de novo.
    mockListPayments();
    nock(ASAAS).post('/v3/payments').reply(503);
    const stillDraft = await http().post(`/api/v1/charges/${id}/retry`).set('Authorization', fin);
    expect(stillDraft.status).toBe(200);
    expect(stillDraft.body).toMatchObject({ status: 'DRAFT', asaasPaymentId: null });
    expect(stillDraft.body.lastError).toBeTruthy();

    // O Asaas tinha gravado (ex.: resposta perdida): o retry reaproveita em vez de criar outra.
    mockListPayments([{ ...createdBoleto, id: 'pay_retry', externalReference: draft.externalReference, dueDate: due }]);
    nock(ASAAS).get('/v3/payments/pay_retry/identificationField').reply(200, identificationField);

    const retried = await http().post(`/api/v1/charges/${id}/retry`).set('Authorization', fin);

    expect(retried.status).toBe(200);
    expect(retried.body).toMatchObject({
      status: 'PENDING',
      asaasPaymentId: 'pay_retry',
      bankSlipUrl: createdBoleto.bankSlipUrl,
      identificationField: identificationField.identificationField,
      lastError: null,
    });
    expect(nock.pendingMocks()).toEqual([]);

    const again = await http().post(`/api/v1/charges/${id}/retry`).set('Authorization', fin);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('CHARGE_NOT_DRAFT');
  });

  it('[COB-12.2] mesma idempotencyKey 3×: um registro local e uma cobrança no Asaas', async () => {
    const c = await fx.customer({ asaasCustomerId: 'cus_idem' });
    const key = `ctr_${randomUUID()}`;
    const ctx = { origin: 'CONTRACT' as const, idempotencyKey: key };
    const parsed = ChargePlanSchema.parse(plan());

    mockListPayments();
    nock(ASAAS).post('/v3/payments').reply(503);
    const failure = (await service.createFromPlan(c.id, parsed, ctx).catch((e: unknown) => e)) as DomainException;
    expect(failure.code).toBe('ASAAS_UNAVAILABLE');

    const bodies: Array<Record<string, unknown>> = [];
    mockListPayments();
    mockCreatePayment(createdPix, 'pay_idem', bodies);
    nock(ASAAS).get('/v3/payments/pay_idem/pixQrCode').reply(200, pixQrCode);
    const [id] = await service.createFromPlan(c.id, parsed, ctx);

    await expect(service.createFromPlan(c.id, parsed, ctx)).resolves.toEqual([id]);
    expect(failure.details).toEqual({ chargeIds: [id] });
    expect(bodies.map((b) => b.externalReference)).toEqual([key]);
    expect(await prisma.charge.findMany({ where: { customerId: c.id }, select: { origin: true, status: true } })).toEqual([
      { origin: 'CONTRACT', status: 'PENDING' },
    ]);
  });

  it('[COB-12.3] retry de rascunho vencido que não chegou ao Asaas → DUE_DATE_IN_PAST', async () => {
    const c = await fx.customer({ asaasCustomerId: 'cus_vencido' });
    const draft = await fx.charge(c.id, 'DRAFT', 10_000, { dueDate: addDays(todayInSaoPaulo(), -2) });
    mockListPayments();

    const res = await http().post(`/api/v1/charges/${draft.id}/retry`).set('Authorization', fin);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('DUE_DATE_IN_PAST');
    expect((await prisma.charge.findUnique({ where: { id: draft.id } }))?.status).toBe('DRAFT');
  });

  it('[COB-12.1] descartar: DRAFT → CANCELED só local; fora de DRAFT → CHARGE_NOT_DRAFT', async () => {
    const c = await fx.customer();
    const draft = await fx.charge(c.id, 'DRAFT', 10_000);
    const pending = await fx.charge(c.id, 'PENDING', 10_000);

    expect((await http().post(`/api/v1/charges/${draft.id}/discard`).set('Authorization', leitura)).status).toBe(403);
    const res = await http().post(`/api/v1/charges/${draft.id}/discard`).set('Authorization', fin);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELED');
    expect(await prisma.auditLog.count({ where: { action: 'charge.discard', entityId: draft.id } })).toBe(1);

    const other = await http().post(`/api/v1/charges/${pending.id}/discard`).set('Authorization', fin);
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe('CHARGE_NOT_DRAFT');
  });

  it('[COB-07.1][COB-05.1] detalhe com itens e eventos; payment-info busca no Asaas o que falta e grava', async () => {
    const c = await fx.customer();
    const charge = await prisma.charge.create({
      data: {
        customerId: c.id,
        type: 'SINGLE',
        status: 'PENDING',
        billingType: 'UNDEFINED',
        valueCents: 50_000,
        dueDate: new Date(`${due}T00:00:00Z`),
        description: 'Manutenção (1x)',
        externalReference: `chg_${randomUUID()}`,
        asaasPaymentId: 'pay_detalhe',
        invoiceUrl: 'https://sandbox.asaas.com/i/detalhe',
        items: { create: [{ description: 'Manutenção', quantity: 1, unitPriceCents: 50_000, totalCents: 50_000 }] },
      },
    });
    await prisma.webhookEvent.createMany({
      data: [
        { source: 'ASAAS', externalEventId: `evt_${randomUUID()}`, event: 'PAYMENT_CREATED', resourceId: 'pay_detalhe', payload: {}, receivedAt: new Date('2026-10-08T12:00:00Z'), processedAt: new Date(), result: 'APPLIED' },
        { source: 'ASAAS', externalEventId: `evt_${randomUUID()}`, event: 'PAYMENT_CHECKOUT_VIEWED', resourceId: 'pay_detalhe', payload: {}, receivedAt: new Date('2026-10-08T13:00:00Z') },
        { source: 'ASAAS', externalEventId: `evt_${randomUUID()}`, event: 'PAYMENT_CREATED', resourceId: 'pay_outra', payload: {} },
      ],
    });

    const detail = await http().get(`/api/v1/charges/${charge.id}`).set('Authorization', leitura);

    expect(detail.status).toBe(200);
    expect(detail.body.customer.document).toMatch(/^\*\*\*\./);
    expect(detail.body.items).toEqual([expect.objectContaining({ description: 'Manutenção', totalCents: 50_000 })]);
    expect(detail.body.events.map((e: { event: string }) => e.event)).toEqual(['PAYMENT_CHECKOUT_VIEWED', 'PAYMENT_CREATED']);

    nock(ASAAS).get('/v3/payments/pay_detalhe/pixQrCode').reply(200, pixQrCode);
    nock(ASAAS).get('/v3/payments/pay_detalhe/identificationField').reply(200, identificationField);

    const info = await http().get(`/api/v1/charges/${charge.id}/payment-info`).set('Authorization', leitura);

    expect(info.status).toBe(200);
    expect(info.body).toEqual({
      invoiceUrl: 'https://sandbox.asaas.com/i/detalhe',
      bankSlipUrl: null,
      pixPayload: pixQrCode.payload,
      pixQrCodeBase64: pixQrCode.encodedImage,
      identificationField: identificationField.identificationField,
    });
    expect(await prisma.charge.findUnique({ where: { id: charge.id } })).toMatchObject({
      pixPayload: pixQrCode.payload,
      identificationField: identificationField.identificationField,
    });
  });
});
