import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { addDays, todayInSaoPaulo } from '@financeiro/shared';
import { PrismaService } from '../../src/prisma/prisma.service';
import { billingFixtures } from '../fixtures/billing';
import { createTestApp, loginAs } from './test-app';

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 10_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (ok(value) || Date.now() > until) return value;
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** WHK-04 contra o Asaas simulado: webhook "perdido" é corrigido pela reconciliação. */
describe('Reconciliação (integração)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp({ ASAAS_ENV: 'mock', ASAAS_API_KEY: '', STORAGE_LOCAL_DIR: mkdtempSync(join(tmpdir(), 'reconcile-')) });
    prisma = app.get(PrismaService);
    admin = (await loginAs(app, 'ADMIN')).auth;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('[WHK-04.1][WHK-04.3][WHK-04.4][COB-07.2] corrige status e valor divergentes com eventos RECONCILE', async () => {
    const customer = await billingFixtures(prisma).customer();
    const created = await http()
      .post('/api/v1/charges')
      .set('Authorization', admin)
      .send({
        customerId: customer.id,
        plan: { items: [{ description: 'Serviço', quantity: 1, unitPriceCents: 40_000 }], type: 'SINGLE', billingType: 'PIX', dueDate: { mode: 'FIXED_DATE', date: addDays(todayInSaoPaulo(), 5) }, finePct: 0, interestPct: 0 },
      });
    const id = created.body.charges[0].id as string;
    await http().post(`/api/v1/asaas-mock/charges/${id}/simulate`).set('Authorization', admin).send({ action: 'RECEIVE' }).expect(200);
    await waitFor(() => prisma.charge.findUniqueOrThrow({ where: { id } }), (c) => c.status === 'PAID');

    // Webhook "perdido": o espelho volta a pendente e com valor errado.
    await prisma.charge.update({ where: { id }, data: { status: 'PENDING', paidAt: null, valueCents: 1 } });

    const run = await http().post('/api/v1/reconcile').set('Authorization', admin);
    // O banco é compartilhado entre os arquivos de teste: cobranças de outros testes não existem no simulador (contam como erro).
    expect(run.body).toMatchObject({ checked: expect.any(Number), fixed: expect.any(Number) });
    expect(run.body.fixed).toBeGreaterThanOrEqual(1);
    const fixed = await prisma.charge.findUniqueOrThrow({ where: { id } });
    expect(fixed.status).toBe('PAID');
    expect(await prisma.webhookEvent.count({ where: { source: 'RECONCILE', resourceId: fixed.asaasPaymentId } })).toBeGreaterThanOrEqual(1);

    // Só o valor diverge: PAYMENT_UPDATED pelo "Atualizar do Asaas".
    await prisma.charge.update({ where: { id }, data: { valueCents: 1 } });
    const sync = await http().post(`/api/v1/charges/${id}/sync`).set('Authorization', admin);
    expect(sync.body).toEqual({ changed: true });
    expect((await prisma.charge.findUniqueOrThrow({ where: { id } })).valueCents).toBe(40_000);
  });
});
