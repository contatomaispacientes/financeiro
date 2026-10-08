import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp, loginAs } from './test-app';

describe('Log de eventos (integração)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: string;
  let fin: string;
  const tag = `pay_log_${Date.now()}`;
  const http = () => request(app.getHttpServer());
  const old = new Date(Date.now() - 2 * 3600_000);

  const event = (data: Partial<{ processedAt: Date; result: string; error: string; attempts: number; receivedAt: Date }>, suffix: string) =>
    prisma.webhookEvent.create({
      data: { source: 'ASAAS', externalEventId: `evt_${randomUUID()}`, event: 'PAYMENT_RECEIVED', resourceId: `${tag}_${suffix}`, payload: { id: suffix }, ...data },
    });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    admin = (await loginAs(app, 'ADMIN')).auth;
    fin = (await loginAs(app, 'FINANCEIRO')).auth;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('[WHK-03.1] filtra por situação e recurso; só ADMIN', async () => {
    await event({ processedAt: new Date(), result: 'APPLIED' }, 'ok');
    await event({ processedAt: new Date(), result: 'IGNORED_TRANSITION' }, 'ign');
    await event({ error: 'Falhou', attempts: 5 }, 'err');

    const list = (state: string) => http().get('/api/v1/webhook-events').query({ state, resourceId: tag }).set('Authorization', admin);
    expect((await list('processed')).body.data.map((e: { resourceId: string }) => e.resourceId)).toEqual([`${tag}_ok`]);
    expect((await list('ignored')).body.data[0].state).toBe('ignored');
    expect((await list('error')).body.data[0]).toMatchObject({ state: 'error', attempts: 5, error: 'Falhou' });
    expect((await http().get('/api/v1/webhook-events').set('Authorization', fin)).status).toBe(403);
  });

  it('[WHK-03.2] reprocessa evento com erro após esgotar tentativas; recusa evento já aplicado', async () => {
    const failed = await event({ error: 'Falhou', attempts: 5 }, 're');
    const res = await http().post(`/api/v1/webhook-events/${failed.id}/reprocess`).set('Authorization', admin);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ attempts: 0, error: null, payload: { id: 're' } });

    const ok = await event({ processedAt: new Date(), result: 'APPLIED' }, 'done');
    const again = await http().post(`/api/v1/webhook-events/${ok.id}/reprocess`).set('Authorization', admin);
    expect(again.body.error.code).toBe('EVENT_ALREADY_PROCESSED');
  });

  it('[WHK-03.3] saúde alerta evento pendente há mais de 1 hora', async () => {
    await event({ receivedAt: old }, 'stale');
    const res = await http().get('/api/v1/webhook-events/health').set('Authorization', admin);
    expect(res.body.oldestPendingMinutes).toBeGreaterThanOrEqual(119);
    expect(res.body.alert).toContain('sem processar');
  });
});
