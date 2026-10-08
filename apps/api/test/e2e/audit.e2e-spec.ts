import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TEST_PASSWORD, createTestApp, createUser, loginAs } from './test-app';

describe('Auditoria (integração)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('[FND-05.1] login', () => {
    it('registra login com sucesso', async () => {
      const user = await createUser(app);
      await http().post('/api/v1/auth/login').send({ email: user.email, password: TEST_PASSWORD });

      const log = await prisma.auditLog.findFirst({ where: { action: 'auth.login', userId: user.id } });
      expect(log).toMatchObject({ entity: 'user', entityId: user.id });
    });

    it('registra falhas com o motivo, sem a senha digitada', async () => {
      const user = await createUser(app);
      const inactive = await createUser(app, { active: false });
      const ghost = `fantasma${Date.now()}@teste.local`;

      await http().post('/api/v1/auth/login').send({ email: user.email, password: 'senha-errada-999' });
      await http().post('/api/v1/auth/login').send({ email: inactive.email, password: TEST_PASSWORD });
      await http().post('/api/v1/auth/login').send({ email: ghost, password: 'qualquer-coisa' });

      const failures = await prisma.auditLog.findMany({
        where: { action: 'auth.login_failed', createdAt: { gte: new Date(Date.now() - 60_000) } },
      });
      const reasonFor = (email: string) =>
        failures.find((f) => (f.data as { email: string }).email === email)?.data;

      expect(reasonFor(user.email)).toEqual({ email: user.email, reason: 'WRONG_PASSWORD' });
      expect(reasonFor(inactive.email)).toEqual({ email: inactive.email, reason: 'INACTIVE' });
      expect(reasonFor(ghost)).toEqual({ email: ghost, reason: 'UNKNOWN_EMAIL' });
      expect(JSON.stringify(failures)).not.toMatch(/senha-errada-999|qualquer-coisa/);
    });
  });

  describe('[FND-05.2] GET /audit-logs', () => {
    const entity = `teste_${Date.now()}`;
    let actorId: string;
    let actorName: string;
    let auth: string;

    beforeAll(async () => {
      const admin = await loginAs(app, 'ADMIN');
      auth = admin.auth;
      actorId = admin.user.id;
      actorName = admin.user.name;

      // 10/01 02:30Z = 09/01 23:30 em São Paulo: borda entre os dois dias.
      await prisma.auditLog.createMany({
        data: [
          { action: 'x.a', entity, userId: actorId, createdAt: new Date('2026-01-09T12:00:00Z') },
          { action: 'x.b', entity, userId: actorId, createdAt: new Date('2026-01-10T02:30:00Z') },
          { action: 'x.c', entity, userId: null, createdAt: new Date('2026-01-10T15:00:00Z') },
          { action: 'x.d', entity, userId: actorId, createdAt: new Date('2026-01-12T15:00:00Z') },
        ],
      });
    });

    const get = (qs: string) => http().get(`/api/v1/audit-logs?entity=${entity}&${qs}`).set('Authorization', auth);

    it('filtra por entidade, ordena do mais recente e traz o nome do usuário', async () => {
      const res = await get('');
      expect(res.status).toBe(200);
      expect(res.body.data.map((r: { action: string }) => r.action)).toEqual(['x.d', 'x.c', 'x.b', 'x.a']);
      expect(res.body.data[0]).toMatchObject({ userId: actorId, userName: actorName });
      expect(res.body.data[1]).toMatchObject({ userId: null, userName: null });
      expect(res.body.meta.total).toBe(4);
    });

    it('filtra por usuário', async () => {
      const res = await get(`userId=${actorId}`);
      expect(res.body.data.map((r: { action: string }) => r.action)).toEqual(['x.d', 'x.b', 'x.a']);
    });

    it('filtra por período usando o dia de São Paulo (datas inclusivas)', async () => {
      const day9 = await get('from=2026-01-09&to=2026-01-09');
      expect(day9.body.data.map((r: { action: string }) => r.action)).toEqual(['x.b', 'x.a']);

      const from10 = await get('from=2026-01-10');
      expect(from10.body.data.map((r: { action: string }) => r.action)).toEqual(['x.d', 'x.c']);
    });

    it('pagina', async () => {
      const res = await get('page=2&pageSize=3');
      expect(res.body.data.map((r: { action: string }) => r.action)).toEqual(['x.a']);
      expect(res.body.meta).toEqual({ page: 2, pageSize: 3, total: 4 });
    });

    it('valida filtros', async () => {
      const bad = await get('from=10/01/2026');
      expect(bad.status).toBe(400);
      const inverted = await get('from=2026-02-01&to=2026-01-01');
      expect(inverted.status).toBe(400);
    });
  });
});
