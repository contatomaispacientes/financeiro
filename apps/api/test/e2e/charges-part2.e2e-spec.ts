import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { addDays, todayInSaoPaulo, type ChargePlanInput } from '@financeiro/shared';
import { PrismaService } from '../../src/prisma/prisma.service';
import { billingFixtures } from '../fixtures/billing';
import { createTestApp, loginAs } from './test-app';

const due = addDays(todayInSaoPaulo(), 5);

function plan(overrides: Partial<ChargePlanInput> = {}): ChargePlanInput {
  return {
    items: [{ description: 'Mensalidade', quantity: 1, unitPriceCents: 30_000 }],
    type: 'SINGLE',
    billingType: 'PIX',
    dueDate: { mode: 'FIXED_DATE', date: due },
    finePct: 2,
    interestPct: 1,
    ...overrides,
  };
}

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 10_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (ok(value) || Date.now() > until) return value;
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** Parte 2 da spec 03 contra o Asaas simulado (ADR-016): o caminho real de webhook e fila. */
describe('Cobranças — parcelada, recorrente, lista, cancelar, estornar (integração)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fx: ReturnType<typeof billingFixtures>;
  let fin: string;
  let admin: string;
  const http = () => request(app.getHttpServer());

  const create = async (customerId: string, overrides: Partial<ChargePlanInput> = {}) => {
    const res = await http().post('/api/v1/charges').set('Authorization', fin).send({ customerId, plan: plan(overrides) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  };
  const pay = (chargeId: string) =>
    http().post(`/api/v1/asaas-mock/charges/${chargeId}/simulate`).set('Authorization', fin).send({ action: 'RECEIVE' }).expect(200);
  const chargeById = (id: string) => prisma.charge.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    app = await createTestApp({ ASAAS_ENV: 'mock', ASAAS_API_KEY: '', STORAGE_LOCAL_DIR: mkdtempSync(join(tmpdir(), 'cob2-')) });
    prisma = app.get(PrismaService);
    fx = billingFixtures(prisma);
    fin = (await loginAs(app, 'FINANCEIRO')).auth;
    admin = (await loginAs(app, 'ADMIN')).auth;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('[COB-03.1][COB-03.3] parcelada 3× cria um parcelamento e casa as parcelas, somando o total', async () => {
    const c = await fx.customer();
    const body = await create(c.id, { type: 'INSTALLMENT', installmentCount: 3, items: [{ description: 'Projeto', quantity: 1, unitPriceCents: 100_000 }] });
    expect(body.charges).toHaveLength(3);
    const charges = await prisma.charge.findMany({ where: { customerId: c.id }, orderBy: { installmentNumber: 'asc' } });
    expect(charges.map((x) => [x.installmentNumber, x.installmentCount, x.status])).toEqual([
      [1, 3, 'PENDING'],
      [2, 3, 'PENDING'],
      [3, 3, 'PENDING'],
    ]);
    expect(charges.reduce((s, x) => s + x.valueCents, 0)).toBe(100_000);
    expect(new Set(charges.map((x) => x.asaasInstallmentId)).size).toBe(1);
    expect(body.charges[0].installments).toHaveLength(3);
  });

  it('[COB-04.1][COB-04.2][COB-04.3] recorrente importa a 1ª cobrança e, paga, a do próximo ciclo chega pelo webhook', async () => {
    const c = await fx.customer();
    const body = await create(c.id, { type: 'RECURRING', cycle: 'MONTHLY' });
    expect(body.subscription).toMatchObject({ status: 'ACTIVE', cycle: 'MONTHLY', asaasSubscriptionId: expect.stringMatching(/^sub_mock_/) });
    expect(body.charges).toHaveLength(1);
    expect(body.charges[0]).toMatchObject({ origin: 'SUBSCRIPTION', type: 'RECURRING', status: 'PENDING', dueDate: due });
    expect(body.charges[0].items).toHaveLength(1);

    await pay(body.charges[0].id);
    const charges = await waitFor(
      () => prisma.charge.findMany({ where: { subscriptionId: body.subscription.id }, orderBy: { dueDate: 'asc' } }),
      (list) => list.length === 2 && list[0]!.status === 'PAID',
    );
    expect(charges.map((x) => x.status)).toEqual(['PAID', 'PENDING']);

    const list = await http().get('/api/v1/subscriptions').query({ customerId: c.id }).set('Authorization', fin);
    expect(list.body.data[0]).toMatchObject({ id: body.subscription.id, status: 'ACTIVE' });
  });

  it('[COB-06.1][COB-06.2] lista filtra por status, conta por status e soma o filtro', async () => {
    const c = await fx.customer();
    const a = (await create(c.id)).charges[0];
    await create(c.id, { items: [{ description: 'Outro', quantity: 1, unitPriceCents: 20_000 }] });
    await pay(a.id);
    await waitFor(() => chargeById(a.id), (x) => x.status === 'PAID');

    const res = await http().get('/api/v1/charges').query({ customerId: c.id, status: 'PENDING' }).set('Authorization', fin);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.summary).toEqual({ countByStatus: { PAID: 1, PENDING: 1 }, totalCents: 20_000 });
    expect(res.body.data[0]).toMatchObject({ customer: { id: c.id }, valueCents: 20_000, status: 'PENDING' });
  });

  it('[COB-08.1][COB-08.2][COB-08.3] cancela uma cobrança, recusa a paga e cancela as parcelas restantes', async () => {
    const c = await fx.customer();
    const single = (await create(c.id)).charges[0];
    const res = await http().post(`/api/v1/charges/${single.id}/cancel`).set('Authorization', fin).send({});
    expect(res.status).toBe(200);
    expect((await chargeById(single.id)).status).toBe('CANCELED');
    expect(await prisma.auditLog.count({ where: { action: 'charge.cancel', entityId: single.id } })).toBe(1);

    const parcels = (await create(c.id, { type: 'INSTALLMENT', installmentCount: 3, items: [{ description: 'P', quantity: 1, unitPriceCents: 90_000 }] })).charges;
    await pay(parcels[0].id);
    await waitFor(() => chargeById(parcels[0].id), (x) => x.status === 'PAID');

    const refused = await http().post(`/api/v1/charges/${parcels[0].id}/cancel`).set('Authorization', fin).send({ scope: 'SINGLE' });
    expect(refused.body.error.code).toBe('CHARGE_NOT_CANCELABLE');

    const rest = await http().post(`/api/v1/charges/${parcels[1].id}/cancel`).set('Authorization', fin).send({ scope: 'REMAINING_INSTALLMENTS' });
    expect(rest.body).toHaveLength(2);
    const after = await prisma.charge.findMany({ where: { groupKey: parcels[0].groupKey }, orderBy: { installmentNumber: 'asc' } });
    expect(after.map((x) => x.status)).toEqual(['PAID', 'CANCELED', 'CANCELED']);
  });

  it('[COB-09.1][COB-09.2][COB-09.3] estorno só ADMIN, respeita o saldo e o webhook confirma o parcial', async () => {
    const c = await fx.customer();
    const charge = (await create(c.id)).charges[0];
    await pay(charge.id);
    await waitFor(() => chargeById(charge.id), (x) => x.status === 'PAID');

    expect((await http().post(`/api/v1/charges/${charge.id}/refund`).set('Authorization', fin).send({})).status).toBe(403);
    const over = await http().post(`/api/v1/charges/${charge.id}/refund`).set('Authorization', admin).send({ valueCents: 30_001 });
    expect(over.body.error.code).toBe('REFUND_EXCEEDS_VALUE');

    const ok = await http().post(`/api/v1/charges/${charge.id}/refund`).set('Authorization', admin).send({ valueCents: 10_000 });
    expect(ok.status).toBe(200);
    expect(ok.body.refundRequestedAt).not.toBeNull();
    const refunded = await waitFor(() => chargeById(charge.id), (x) => x.status === 'PARTIALLY_REFUNDED');
    expect(refunded).toMatchObject({ status: 'PARTIALLY_REFUNDED', refundedCents: 10_000 });
  });

  it('[COB-11.1] cancelar recorrência marca CANCELED e cancela as cobranças em aberto', async () => {
    const c = await fx.customer();
    const body = await create(c.id, { type: 'RECURRING', cycle: 'WEEKLY' });
    const res = await http().post(`/api/v1/subscriptions/${body.subscription.id}/cancel`).set('Authorization', fin);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELED');
    expect((await chargeById(body.charges[0].id)).status).toBe('CANCELED');
  });
});
