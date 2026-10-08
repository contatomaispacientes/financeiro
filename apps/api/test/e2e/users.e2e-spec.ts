import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  TEST_PASSWORD,
  createTestApp,
  createUser,
  loginAs,
  refreshCookieFrom,
} from './test-app';

describe('Usuários e papéis (integração)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const login = (email: string, password = TEST_PASSWORD) =>
    http().post('/api/v1/auth/login').send({ email, password });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('[FND-03.2] matriz: configurações, usuários e auditoria só para ADMIN', () => {
    const someId = '00000000-0000-4000-8000-000000000000';
    const routes: Array<[string, (auth: string) => request.Test]> = [
      ['GET /users', (a) => http().get('/api/v1/users').set('Authorization', a)],
      ['GET /users/:id', (a) => http().get(`/api/v1/users/${someId}`).set('Authorization', a)],
      [
        'POST /users',
        (a) =>
          http()
            .post('/api/v1/users')
            .set('Authorization', a)
            .send({ name: 'X', email: 'x@y.com', role: 'LEITURA', password: '1234567890' }),
      ],
      [
        'PATCH /users/:id',
        (a) => http().patch(`/api/v1/users/${someId}`).set('Authorization', a).send({ name: 'Novo' }),
      ],
      [
        'POST /users/:id/reset-password',
        (a) =>
          http()
            .post(`/api/v1/users/${someId}/reset-password`)
            .set('Authorization', a)
            .send({ newPassword: 'nova-senha-123' }),
      ],
      ['GET /audit-logs', (a) => http().get('/api/v1/audit-logs').set('Authorization', a)],
    ];

    it.each(routes)('[FND-03.3] %s → 403 FORBIDDEN para FINANCEIRO e LEITURA', async (_name, call) => {
      for (const role of ['FINANCEIRO', 'LEITURA'] as const) {
        const { auth } = await loginAs(app, role);
        const res = await call(auth);
        expect(res.status, role).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
    });

    it.each(routes)('%s → liberado para ADMIN', async (_name, call) => {
      const { auth } = await loginAs(app, 'ADMIN');
      const res = await call(auth);
      expect(res.status).not.toBe(403);
      expect(res.status).not.toBe(401);
    });
  });

  describe('[FND-03.1] CRUD de usuários', () => {
    it('cria usuário (sem expor hash) e ele consegue entrar', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const email = `Novo.${Date.now()}@Teste.local`;

      const res = await http()
        .post('/api/v1/users')
        .set('Authorization', admin.auth)
        .send({ name: 'Novo Usuário', email, role: 'FINANCEIRO', password: 'senha-forte-1' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        name: 'Novo Usuário',
        email: email.toLowerCase(),
        role: 'FINANCEIRO',
        active: true,
        lastLoginAt: null,
      });
      expect(res.body.passwordHash).toBeUndefined();
      expect((await login(email, 'senha-forte-1')).status).toBe(200);

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'user.create', entityId: res.body.id },
      });
      expect(audit?.userId).toBe(admin.user.id);
      expect(JSON.stringify(audit?.data)).not.toContain('senha-forte-1');
    });

    it('recusa e-mail repetido (sem diferenciar maiúsculas) com 409 EMAIL_IN_USE', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const existing = await createUser(app);

      const res = await http()
        .post('/api/v1/users')
        .set('Authorization', admin.auth)
        .send({ name: 'Dup', email: existing.email.toUpperCase(), role: 'LEITURA', password: 'senha-forte-1' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('EMAIL_IN_USE');

      const other = await createUser(app);
      const patch = await http()
        .patch(`/api/v1/users/${other.id}`)
        .set('Authorization', admin.auth)
        .send({ email: existing.email });
      expect(patch.status).toBe(409);
      expect(patch.body.error.code).toBe('EMAIL_IN_USE');
    });

    it('valida senha mínima de 10 caracteres', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const res = await http()
        .post('/api/v1/users')
        .set('Authorization', admin.auth)
        .send({ name: 'Curta', email: `c${Date.now()}@teste.local`, role: 'LEITURA', password: 'curta' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('lista paginado e detalha; 404 para id inexistente', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const list = await http().get('/api/v1/users?pageSize=2').set('Authorization', admin.auth);
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(2);
      expect(list.body.meta).toMatchObject({ page: 1, pageSize: 2 });
      expect(list.body.meta.total).toBeGreaterThanOrEqual(2);

      const one = await http().get(`/api/v1/users/${admin.user.id}`).set('Authorization', admin.auth);
      expect(one.body.email).toBe(admin.user.email);

      const missing = await http()
        .get('/api/v1/users/00000000-0000-4000-8000-000000000000')
        .set('Authorization', admin.auth);
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('NOT_FOUND');
    });

    it('edita e audita só o que mudou (antes/depois)', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const target = await createUser(app, { role: 'LEITURA' });

      const res = await http()
        .patch(`/api/v1/users/${target.id}`)
        .set('Authorization', admin.auth)
        .send({ name: target.name, role: 'FINANCEIRO' });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe('FINANCEIRO');

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'user.update', entityId: target.id },
      });
      expect(audit?.data).toEqual({ before: { role: 'LEITURA' }, after: { role: 'FINANCEIRO' } });
    });

    it('desativar bloqueia o login e derruba as sessões abertas', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const target = await createUser(app);
      const cookie = refreshCookieFrom((await login(target.email)).headers['set-cookie'])!;

      const res = await http()
        .patch(`/api/v1/users/${target.id}`)
        .set('Authorization', admin.auth)
        .send({ active: false });
      expect(res.status).toBe(200);

      expect((await login(target.email)).status).toBe(401);
      expect((await http().post('/api/v1/auth/refresh').set('Cookie', cookie)).status).toBe(401);
    });

    it('redefine a senha: a antiga para de funcionar e as sessões caem', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const target = await createUser(app);
      const cookie = refreshCookieFrom((await login(target.email)).headers['set-cookie'])!;

      const res = await http()
        .post(`/api/v1/users/${target.id}/reset-password`)
        .set('Authorization', admin.auth)
        .send({ newPassword: 'outra-senha-456' });
      expect(res.status).toBe(204);

      expect((await login(target.email)).status).toBe(401);
      expect((await login(target.email, 'outra-senha-456')).status).toBe(200);
      expect((await http().post('/api/v1/auth/refresh').set('Cookie', cookie)).status).toBe(401);

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'user.reset_password', entityId: target.id },
      });
      expect(audit?.userId).toBe(admin.user.id);
      expect(audit?.data).toBeNull();
    });
  });

  describe('[FND-03.4] último ADMIN ativo', () => {
    // Deixa só os admins criados no próprio teste ativos.
    beforeEach(async () => {
      await prisma.user.updateMany({ where: { role: 'ADMIN' }, data: { active: false } });
    });

    async function onlyAdmin() {
      const admin = await loginAs(app, 'ADMIN');
      await prisma.user.updateMany({
        where: { role: 'ADMIN', id: { not: admin.user.id } },
        data: { active: false },
      });
      return admin;
    }

    it('não deixa desativar o último admin ativo (409 LAST_ADMIN)', async () => {
      const admin = await onlyAdmin();
      const res = await http()
        .patch(`/api/v1/users/${admin.user.id}`)
        .set('Authorization', admin.auth)
        .send({ active: false });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('LAST_ADMIN');
    });

    it('não deixa rebaixar o último admin ativo', async () => {
      const admin = await onlyAdmin();
      const res = await http()
        .patch(`/api/v1/users/${admin.user.id}`)
        .set('Authorization', admin.auth)
        .send({ role: 'FINANCEIRO' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('LAST_ADMIN');
    });

    it('permite desativar um admin quando sobra outro ativo', async () => {
      const admin = await onlyAdmin();
      const other = await createUser(app, { role: 'ADMIN' });
      const res = await http()
        .patch(`/api/v1/users/${other.id}`)
        .set('Authorization', admin.auth)
        .send({ active: false });
      expect(res.status).toBe(200);
    });

    it('dois admins desativando um ao outro ao mesmo tempo: só um consegue', async () => {
      const a = await onlyAdmin();
      const b = await loginAs(app, 'ADMIN');

      const [ra, rb] = await Promise.all([
        http().patch(`/api/v1/users/${b.user.id}`).set('Authorization', a.auth).send({ active: false }),
        http().patch(`/api/v1/users/${a.user.id}`).set('Authorization', b.auth).send({ active: false }),
      ]);

      expect([ra.status, rb.status].sort()).toEqual([200, 409]);
      expect(await prisma.user.count({ where: { role: 'ADMIN', active: true } })).toBe(1);
    });
  });
});
