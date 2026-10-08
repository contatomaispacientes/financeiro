import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import nock from 'nock';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp, loginAs } from './test-app';

const ASAAS_SANDBOX = 'https://api-sandbox.asaas.com';

describe('Configurações (integração)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Awaited<ReturnType<typeof loginAs>>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    admin = await loginAs(app, 'ADMIN');
  });

  afterEach(() => {
    nock.cleanAll();
  });

  afterAll(async () => {
    await app?.close();
  });

  const patch = (auth: string, body: object) =>
    http().patch('/api/v1/settings').set('Authorization', auth).send(body);

  describe('[FND-04.1] GET/PATCH /settings', () => {
    it('qualquer papel lê os padrões; percentuais saem como número', async () => {
      const { auth } = await loginAs(app, 'LEITURA');
      const res = await http().get('/api/v1/settings').set('Authorization', auth);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        defaultDueDays: expect.any(Number),
        defaultFinePct: expect.any(Number),
        defaultInterestPct: expect.any(Number),
        reminderDaysAfter: expect.any(Array),
        reminderChannels: expect.any(Array),
      });
    });

    it('[FND-03.3] só ADMIN altera', async () => {
      for (const role of ['FINANCEIRO', 'LEITURA'] as const) {
        const { auth } = await loginAs(app, role);
        const res = await patch(auth, { defaultDueDays: 5 });
        expect(res.status, role).toBe(403);
      }
    });

    it('[FND-04.4] altera e audita só o que mudou, com antes e depois', async () => {
      await patch(admin.auth, { defaultFinePct: 2, defaultDueDays: 3, companyDocument: null });

      const res = await patch(admin.auth, {
        defaultFinePct: 2.5,
        defaultDueDays: 3,
        companyDocument: '11.222.333/0001-81',
      });

      expect(res.status).toBe(200);
      expect(res.body.defaultFinePct).toBe(2.5);
      expect(res.body.companyDocument).toBe('11222333000181');

      const log = await prisma.auditLog.findFirst({
        where: { action: 'settings.update' },
        orderBy: { createdAt: 'desc' },
      });
      expect(log).toMatchObject({ userId: admin.user.id, entity: 'settings', entityId: '1' });
      expect(log?.data).toEqual({
        before: { defaultFinePct: 2, companyDocument: null },
        after: { defaultFinePct: 2.5, companyDocument: '11222333000181' },
      });
    });

    it('não audita quando nada muda', async () => {
      await patch(admin.auth, { defaultDueDays: 7 });
      const count = await prisma.auditLog.count({ where: { action: 'settings.update' } });

      await patch(admin.auth, { defaultDueDays: 7 });

      expect(await prisma.auditLog.count({ where: { action: 'settings.update' } })).toBe(count);
    });

    it('permite limpar campos opcionais com null', async () => {
      await patch(admin.auth, { companyName: 'Empresa X' });
      const res = await patch(admin.auth, { companyName: null });
      expect(res.body.companyName).toBeNull();
    });

    it.each([
      ['multa acima de 10%', { defaultFinePct: 11 }],
      ['CNPJ inválido', { companyDocument: '11222333000182' }],
      ['régua sem canal', { reminderChannels: [] }],
      ['mais de 5 lembretes após o vencimento', { reminderDaysAfter: [1, 2, 3, 4, 5, 6] }],
      ['corpo vazio', {}],
    ])('rejeita %s com 400 VALIDATION_ERROR', async (_label, body) => {
      const res = await patch(admin.auth, body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  it('[FND-06.1] GET /settings/environment: qualquer papel vê o ambiente do Asaas (selo do menu)', async () => {
    const { auth } = await loginAs(app, 'LEITURA');
    const res = await http().get('/api/v1/settings/environment').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ asaasEnv: 'sandbox', minChargeCents: 500 });
  });

  describe('[FND-04.2] GET /settings/integrations', () => {
    it('mostra o estado das integrações sem revelar segredos', async () => {
      const res = await http().get('/api/v1/settings/integrations').set('Authorization', admin.auth);

      expect(res.status).toBe(200);
      expect(res.body.asaas).toMatchObject({
        env: 'sandbox',
        apiKeyConfigured: true,
        webhookTokenConfigured: true,
        webhookPath: '/api/v1/webhooks/asaas',
      });
      expect(res.body.contracts).toMatchObject({
        provider: 'fake',
        accessTokenConfigured: false,
        hmacSecretConfigured: false,
      });
      expect(res.body.mail).toMatchObject({ configured: true, port: expect.any(Number) });

      const raw = JSON.stringify(res.body);
      for (const secret of ['ASAAS_API_KEY', 'ASAAS_WEBHOOK_TOKEN', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
        expect(raw).not.toContain(process.env[secret]!);
      }
    });

    it('[FND-03.3] só ADMIN vê', async () => {
      const { auth } = await loginAs(app, 'FINANCEIRO');
      const res = await http().get('/api/v1/settings/integrations').set('Authorization', auth);
      expect(res.status).toBe(403);
    });
  });

  describe('[FND-04.3] POST /settings/integrations/asaas/test', () => {
    const test = () =>
      http().post('/api/v1/settings/integrations/asaas/test').set('Authorization', admin.auth);
    const status = () =>
      http().get('/api/v1/settings/integrations').set('Authorization', admin.auth);

    it('sucesso: mostra latência e passa a aparecer como último teste', async () => {
      const scope = nock(ASAAS_SANDBOX, { reqheaders: { access_token: process.env['ASAAS_API_KEY']! } })
        .get('/v3/finance/balance')
        .reply(200, { balance: 100 });

      const res = await test();

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true, latencyMs: expect.any(Number), error: null });
      expect(scope.isDone()).toBe(true);

      const { body } = await status();
      expect(body.asaas.lastTest).toMatchObject({ ok: true, testedBy: admin.user.name });
    });

    it('erro: mostra o motivo e atualiza o último teste', async () => {
      nock(ASAAS_SANDBOX).get('/v3/finance/balance').reply(401, { errors: [] });

      const res = await test();

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toMatchObject({ code: 'ASAAS_AUTH', message: expect.any(String) });

      const { body } = await status();
      expect(body.asaas.lastTest).toMatchObject({ ok: false, error: { code: 'ASAAS_AUTH' } });
    });

    it('[FND-03.3] só ADMIN testa', async () => {
      const { auth } = await loginAs(app, 'FINANCEIRO');
      const res = await http().post('/api/v1/settings/integrations/asaas/test').set('Authorization', auth);
      expect(res.status).toBe(403);
    });
  });
});
