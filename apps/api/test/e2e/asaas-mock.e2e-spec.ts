import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { addDays, todayInSaoPaulo } from '@financeiro/shared';
import { PrismaService } from '../../src/prisma/prisma.service';
import { billingFixtures } from '../fixtures/billing';
import { createTestApp, loginAs } from './test-app';

/** Espera o webhook simulado passar pela fila e mudar o espelho. */
async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 10_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (ok(value) || Date.now() > until) return value;
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe('Asaas simulado (ADR-016)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fin: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp({
      ASAAS_ENV: 'mock',
      ASAAS_API_KEY: '',
      STORAGE_LOCAL_DIR: mkdtempSync(join(tmpdir(), 'asaas-mock-')),
    });
    prisma = app.get(PrismaService);
    fin = (await loginAs(app, 'FINANCEIRO')).auth;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('cria cobrança sem conta no Asaas, simula o pagamento e o status vira Pago pelo webhook', async () => {
    const customer = await billingFixtures(prisma).customer();
    const created = await http()
      .post('/api/v1/charges')
      .set('Authorization', fin)
      .send({
        customerId: customer.id,
        plan: {
          items: [{ description: 'Consultoria', quantity: 1, unitPriceCents: 25_000 }],
          type: 'SINGLE',
          billingType: 'PIX',
          dueDate: { mode: 'FIXED_DATE', date: addDays(todayInSaoPaulo(), 5) },
          finePct: 0,
          interestPct: 0,
        },
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const charge = created.body.charges[0];
    expect(charge).toMatchObject({ status: 'PENDING', pixPayload: expect.stringContaining('simulado') });
    expect(charge.asaasPaymentId).toMatch(/^pay_mock_/);

    const invoice = await http().get(`/api/v1/asaas-mock/fatura/${charge.asaasPaymentId}`);
    expect(invoice.text).toContain('Asaas simulado');

    const sim = await http().post(`/api/v1/asaas-mock/charges/${charge.id}/simulate`).set('Authorization', fin).send({ action: 'RECEIVE' });
    expect(sim.status).toBe(200);

    const paid = await waitFor(
      () => prisma.charge.findUniqueOrThrow({ where: { id: charge.id } }),
      (c) => c.status === 'PAID',
    );
    expect(paid).toMatchObject({ status: 'PAID', netValueCents: 25_000 - 99 });
    expect(paid.paidAt?.toISOString().slice(0, 10)).toBe(todayInSaoPaulo());
  });
});
