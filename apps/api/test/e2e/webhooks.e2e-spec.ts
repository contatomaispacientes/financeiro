import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import type { ChargeStatus } from '@financeiro/shared';
import { PrismaService } from '../../src/prisma/prisma.service';
import type { Prisma } from '../../src/generated/prisma/client.js';
import { PaymentEventProcessor } from '../../src/modules/payment-events/payment-event-processor.service';
import { AsaasEventsSweeper } from '../../src/modules/payment-events/asaas-events.sweeper';
import { ASAAS_EVENTS_QUEUE, ASAAS_EVENTS_SWEEPER_QUEUE } from '../../src/queues/asaas-events';
import { billingFixtures } from '../fixtures/billing';
import { createTestApp } from './test-app';

const URL = '/api/v1/webhooks/asaas';
const TOKEN = 'webhook-token-for-tests-only-0123456789';
const FIXTURES = join(__dirname, '../fixtures/asaas/webhooks');

type Json = Prisma.InputJsonValue | null;
type Body = { id: string; event: string; dateCreated: string; payment: Record<string, Json> };

/** Fixture do Asaas com id de evento único e campos do `payment` sobrescritos. */
function webhook(name: string, payment: Record<string, Json> = {}): Body {
  const body = JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as Body;
  return { ...body, id: `evt_${randomUUID()}`, payment: { ...body.payment, ...payment } };
}

const day = (date: string) => new Date(`${date}T00:00:00Z`);

describe('Webhook do Asaas (integração)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fx: ReturnType<typeof billingFixtures>;
  let customerId: string;
  const http = () => request(app.getHttpServer());

  const send = async (body: unknown, token: string | null = TOKEN) => {
    const req = http().post(URL);
    if (token) req.set('asaas-access-token', token);
    return req.send(body as object);
  };

  const eventOf = (externalEventId: string) =>
    prisma.webhookEvent.findUniqueOrThrow({ where: { source_externalEventId: { source: 'ASAAS', externalEventId } } });

  /** Envia e espera o worker marcar o evento como processado. */
  const deliver = async (body: Body) => {
    expect((await send(body)).status).toBe(200);
    await expect
      .poll(async () => (await eventOf(body.id)).processedAt !== null, { timeout: 10_000 })
      .toBe(true);
    return eventOf(body.id);
  };

  const charge = async (status: ChargeStatus, valueCents = 10_000) => {
    const c = await fx.charge(customerId, status, valueCents);
    return prisma.charge.update({ where: { id: c.id }, data: { asaasPaymentId: `pay_${randomUUID()}` } });
  };
  const reload = (id: string) => prisma.charge.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    fx = billingFixtures(prisma);
    customerId = (await fx.customer()).id;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('[WHK-01] recebimento', () => {
    it('[WHK-01.2] token ausente ou errado → 401 sem persistir', async () => {
      const body = webhook('payment-received');
      for (const token of [null, 'token-errado', `${TOKEN}x`]) {
        const res = await send(body, token);
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('WEBHOOK_UNAUTHORIZED');
      }
      expect(await prisma.webhookEvent.count({ where: { externalEventId: body.id } })).toBe(0);
    });

    it('[WHK-01.5] corpo sem id ou event → 400', async () => {
      for (const body of [{ event: 'PAYMENT_RECEIVED' }, { id: `evt_${randomUUID()}` }]) {
        const res = await send(body);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('WEBHOOK_INVALID_BODY');
      }
    });

    it('[WHK-01.1][WHK-01.3][WHK-02.5] persiste o corpo bruto, responde 200 e enfileira evt_<id> com 5 tentativas', async () => {
      const c = await charge('PENDING');
      const body = webhook('payment-created', { id: c.asaasPaymentId, externalReference: c.externalReference });

      const started = performance.now();
      const res = await send(body);
      expect(performance.now() - started).toBeLessThan(1_000);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ received: true });

      const evt = await eventOf(body.id);
      expect(evt).toMatchObject({ event: 'PAYMENT_CREATED', resourceId: c.asaasPaymentId, payload: body });

      const queue = app.get<Queue>(getQueueToken(ASAAS_EVENTS_QUEUE), { strict: false });
      await expect.poll(() => queue.getJob(`evt_${evt.id}`).then((j) => j?.opts), { timeout: 5_000 }).toMatchObject({
        attempts: 5,
        backoff: { type: 'exponential', delay: 10_000 },
      });
    });

    it('[WHK-01.4] evento repetido → 200, um único registro e processado uma vez', async () => {
      const c = await charge('PENDING');
      const body = webhook('payment-received', { id: c.asaasPaymentId });

      await deliver(body);
      expect((await send(body)).status).toBe(200);

      expect(await prisma.webhookEvent.count({ where: { externalEventId: body.id } })).toBe(1);
      expect(await eventOf(body.id)).toMatchObject({ attempts: 1, result: 'APPLIED' });
    });
  });

  describe('[WHK-02] processamento', () => {
    it('[WHK-02.1][WHK-02.4] PAYMENT_RECEIVED → PAID com data de pagamento, valor líquido e last_event_at', async () => {
      const c = await charge('PENDING');
      const evt = await deliver(webhook('payment-received', { id: c.asaasPaymentId }));

      expect(evt).toMatchObject({ result: 'APPLIED', error: null });
      expect(await reload(c.id)).toMatchObject({
        status: 'PAID',
        paidAt: day('2026-10-20'),
        netValueCents: 9_901,
        invoiceUrl: 'https://sandbox.asaas.com/i/080225913252',
        lastEventAt: new Date('2026-10-20T19:45:03Z'), // 16:45:03 em Brasília
      });
    });

    it.each([
      ['payment-overdue', 'PENDING', 'OVERDUE'],
      ['payment-confirmed', 'PENDING', 'CONFIRMED'],
      ['payment-deleted', 'OVERDUE', 'CANCELED'],
      ['payment-restored', 'CANCELED', 'PENDING'],
    ] as const)('[WHK-02.1] %s: %s → %s', async (fixture, from, to) => {
      const c = await charge(from);
      expect(await deliver(webhook(fixture, { id: c.asaasPaymentId }))).toMatchObject({ result: 'APPLIED' });
      expect((await reload(c.id)).status).toBe(to);
    });

    it('[WHK-02.4] cartão confirmado grava a data da confirmação', async () => {
      const c = await charge('PENDING');
      await deliver(webhook('payment-confirmed', { id: c.asaasPaymentId }));
      expect(await reload(c.id)).toMatchObject({ paidAt: day('2026-10-12'), billingType: 'CREDIT_CARD', netValueCents: 9_651 });
    });

    it('[WHK-02.3][WHK-02.7] estornos parciais sucessivos e depois o total', async () => {
      const c = await charge('PAID');
      const done = (...values: number[]) => values.map((value) => ({ value, status: 'DONE' }));

      await deliver(webhook('payment-partially-refunded', { id: c.asaasPaymentId, refunds: done(30) }));
      expect(await reload(c.id)).toMatchObject({ status: 'PARTIALLY_REFUNDED', refundedCents: 3_000 });

      await deliver(webhook('payment-partially-refunded', { id: c.asaasPaymentId, refunds: done(30, 20) }));
      expect(await reload(c.id)).toMatchObject({ status: 'PARTIALLY_REFUNDED', refundedCents: 5_000 });

      await deliver(webhook('payment-refunded', { id: c.asaasPaymentId }));
      expect(await reload(c.id)).toMatchObject({ status: 'REFUNDED', refundedCents: 10_000 });

      const refunds = await prisma.chargeRefund.findMany({ where: { chargeId: c.id }, orderBy: { createdAt: 'asc' } });
      expect(refunds.map((r) => [r.kind, r.valueCents, r.refundedAt])).toEqual([
        ['REFUND', 3_000, day('2026-10-22')],
        ['REFUND', 2_000, day('2026-10-22')],
        ['REFUND', 5_000, day('2026-10-23')],
      ]);
    });

    it('[WHK-02.7] chargeback lança saída e a reversão lança entrada (ADR-011)', async () => {
      const c = await charge('CONFIRMED');

      await deliver(webhook('payment-chargeback-requested', { id: c.asaasPaymentId }));
      expect((await reload(c.id)).status).toBe('CHARGEBACK');

      await deliver(webhook('payment-received', { id: c.asaasPaymentId, billingType: 'CREDIT_CARD' }));
      expect((await reload(c.id)).status).toBe('PAID');

      const refunds = await prisma.chargeRefund.findMany({ where: { chargeId: c.id }, orderBy: { createdAt: 'asc' } });
      expect(refunds.map((r) => [r.kind, r.valueCents])).toEqual([
        ['CHARGEBACK', 10_000],
        ['CHARGEBACK_REVERSAL', 10_000],
      ]);
    });

    it('[WHK-02.3] transição fora do mapa → IGNORED_TRANSITION sem alterar a cobrança', async () => {
      const c = await charge('PAID');
      const evt = await deliver(webhook('payment-overdue', { id: c.asaasPaymentId }));
      expect(evt).toMatchObject({ result: 'IGNORED_TRANSITION', error: null });
      expect(await reload(c.id)).toMatchObject({ status: 'PAID', lastEventAt: null });
    });

    it('[WHK-02.2] localiza por externalReference e grava o id do Asaas', async () => {
      const c = await fx.charge(customerId, 'PENDING', 10_000);
      const payId = `pay_${randomUUID()}`;
      await deliver(webhook('payment-created', { id: payId, externalReference: c.externalReference }));
      expect(await reload(c.id)).toMatchObject({ status: 'PENDING', asaasPaymentId: payId, invoiceUrl: expect.any(String) });
    });

    it('[WHK-02.2] parcela localizada por group_key + número (grp_x → grp_x:n)', async () => {
      const group = `grp_${randomUUID()}`;
      const parcels = [];
      for (const n of [1, 2]) {
        const c = await fx.charge(customerId, 'PENDING', 5_000);
        parcels.push(
          await prisma.charge.update({
            where: { id: c.id },
            data: { type: 'INSTALLMENT', groupKey: group, externalReference: `${group}:${n}`, installmentNumber: n, installmentCount: 2 },
          }),
        );
      }
      const payId = `pay_${randomUUID()}`;
      await deliver(
        webhook('payment-received', { id: payId, externalReference: group, installment: 'ins_000012345', installmentNumber: 2 }),
      );

      expect(await reload(parcels[1]!.id)).toMatchObject({ status: 'PAID', asaasPaymentId: payId, asaasInstallmentId: 'ins_000012345' });
      expect(await reload(parcels[0]!.id)).toMatchObject({ status: 'PENDING', asaasPaymentId: null });
    });

    it('[WHK-02.2][WHK-02.5] sem cobrança: recente → erro e nova tentativa; depois de 5 min → UNKNOWN_RESOURCE', async () => {
      const processor = app.get(PaymentEventProcessor);
      const body = webhook('payment-received', { id: `pay_${randomUUID()}`, externalReference: `chg_${randomUUID()}` });
      const evt = await prisma.webhookEvent.create({
        data: { source: 'ASAAS', externalEventId: body.id, event: body.event, resourceId: String(body.payment.id), payload: body },
      });

      await expect(processor.apply(evt.id, { lastAttempt: false })).rejects.toMatchObject({ code: 'RESOURCE_NOT_YET_KNOWN' });
      expect(await eventOf(body.id)).toMatchObject({ attempts: 1, error: 'RESOURCE_NOT_YET_KNOWN', processedAt: null });

      await prisma.webhookEvent.update({ where: { id: evt.id }, data: { receivedAt: new Date(Date.now() - 6 * 60_000) } });
      await expect(processor.apply(evt.id, { lastAttempt: false })).resolves.toBe('UNKNOWN_RESOURCE');
      expect(await eventOf(body.id)).toMatchObject({ attempts: 2, error: null, result: 'UNKNOWN_RESOURCE' });
    });
  });

  it('[WHK-02.5] sweeper reenfileira evento salvo e não enfileirado, agendado a cada 10 min', async () => {
    const c = await charge('PENDING');
    const body = webhook('payment-overdue', { id: c.asaasPaymentId });
    await prisma.webhookEvent.create({
      data: {
        source: 'ASAAS',
        externalEventId: body.id,
        event: body.event,
        resourceId: c.asaasPaymentId,
        payload: body,
        receivedAt: new Date(Date.now() - 3 * 60_000),
      },
    });

    expect(await app.get(AsaasEventsSweeper).sweep()).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => (await reload(c.id)).status, { timeout: 10_000 }).toBe('OVERDUE');

    const sweeperQueue = app.get<Queue>(getQueueToken(ASAAS_EVENTS_SWEEPER_QUEUE), { strict: false });
    await expect.poll(() => sweeperQueue.getJobSchedulers(), { timeout: 5_000 }).toEqual([
      expect.objectContaining({ every: 600_000 }),
    ]);
  });
});
