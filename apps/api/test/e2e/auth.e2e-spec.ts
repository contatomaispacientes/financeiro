import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TEST_PASSWORD, createTestApp, createUser, refreshCookieFrom } from './test-app';

describe('Auth (integração)', () => {
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

  async function login(email: string, password = TEST_PASSWORD) {
    return http().post('/api/v1/auth/login').send({ email, password });
  }

  describe('POST /auth/login', () => {
    it('[FND-02.1] devolve access token e define refresh em cookie httpOnly, secure, sameSite=strict', async () => {
      const user = await createUser(app, { role: 'ADMIN' });

      const res = await login(user.email.toUpperCase());

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.user).toEqual({
        id: user.id,
        name: user.name,
        email: user.email,
        role: 'ADMIN',
      });
      expect(res.body.user.passwordHash).toBeUndefined();

      const raw = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
        c.startsWith('refresh_token='),
      );
      expect(raw).toBeDefined();
      expect(raw).toMatch(/HttpOnly/i);
      expect(raw).toMatch(/Secure/i);
      expect(raw).toMatch(/SameSite=Strict/i);
      expect(raw).toMatch(/Path=\/api\/v1\/auth/);
      expect(raw).toMatch(/Max-Age=604800/);

      const payload = JSON.parse(
        Buffer.from(res.body.accessToken.split('.')[1], 'base64url').toString(),
      );
      expect(payload.exp - payload.iat).toBe(15 * 60);

      const stored = await prisma.refreshToken.findMany({ where: { userId: user.id } });
      expect(stored).toHaveLength(1);
      expect(stored[0]!.tokenHash).not.toBe(refreshCookieFrom(raw)!.split('=')[1]);
    });

    it('[FND-02.2] senha errada, e-mail inexistente e usuário inativo respondem igual: 401 INVALID_CREDENTIALS', async () => {
      const active = await createUser(app);
      const inactive = await createUser(app, { active: false });

      const responses = await Promise.all([
        login(active.email, 'senha-errada-123'),
        login('ninguem@teste.local'),
        login(inactive.email),
      ]);

      for (const res of responses) {
        expect(res.status).toBe(401);
        expect(res.body).toEqual({
          error: { code: 'INVALID_CREDENTIALS', message: 'E-mail ou senha inválidos' },
        });
        expect(refreshCookieFrom(res.headers['set-cookie'])).toBeUndefined();
      }
    });

    it('rejeita corpo inválido com 400 VALIDATION_ERROR', async () => {
      const res = await http().post('/api/v1/auth/login').send({ email: 'nao-e-email' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('[FND-02.5] bloqueia a 6ª tentativa no minuto para o mesmo IP + e-mail com 429 RATE_LIMITED', async () => {
      const user = await createUser(app);
      const other = await createUser(app);

      for (let i = 0; i < 5; i++) {
        const res = await login(user.email, 'senha-errada-123');
        expect(res.status).toBe(401);
      }

      const blocked = await login(user.email);
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('RATE_LIMITED');

      const otherEmail = await login(other.email);
      expect(otherEmail.status).toBe(200);
    });
  });

  describe('POST /auth/refresh', () => {
    it('[FND-02.3] emite novo par e revoga o refresh usado (rotação)', async () => {
      const user = await createUser(app);
      const first = refreshCookieFrom((await login(user.email)).headers['set-cookie'])!;

      const res = await http().post('/api/v1/auth/refresh').set('Cookie', first);

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.user.id).toBe(user.id);
      const second = refreshCookieFrom(res.headers['set-cookie']);
      expect(second).toBeDefined();
      expect(second).not.toBe(first);

      const tokens = await prisma.refreshToken.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(tokens).toHaveLength(2);
      expect(tokens[0]!.revokedAt).not.toBeNull();
      expect(tokens[1]!.revokedAt).toBeNull();

      const again = await http().post('/api/v1/auth/refresh').set('Cookie', second!);
      expect(again.status).toBe(200);
    });

    it('[FND-02.4] reuso de refresh revogado revoga todos os refresh do usuário', async () => {
      const user = await createUser(app);
      const stolen = refreshCookieFrom((await login(user.email)).headers['set-cookie'])!;
      const legit = refreshCookieFrom(
        (await http().post('/api/v1/auth/refresh').set('Cookie', stolen)).headers['set-cookie'],
      )!;

      const reuse = await http().post('/api/v1/auth/refresh').set('Cookie', stolen);
      expect(reuse.status).toBe(401);
      expect(reuse.body.error.code).toBe('UNAUTHORIZED');

      const afterTheft = await http().post('/api/v1/auth/refresh').set('Cookie', legit);
      expect(afterTheft.status).toBe(401);

      const live = await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } });
      expect(live).toBe(0);
    });

    it('[FND-02.4] dois refresh simultâneos com o mesmo token: só um vence e a família é revogada', async () => {
      const user = await createUser(app);
      const cookie = refreshCookieFrom((await login(user.email)).headers['set-cookie'])!;

      const [a, b] = await Promise.all([
        http().post('/api/v1/auth/refresh').set('Cookie', cookie),
        http().post('/api/v1/auth/refresh').set('Cookie', cookie),
      ]);

      expect([a.status, b.status].sort()).toEqual([200, 401]);
      const live = await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } });
      expect(live).toBe(0);
    });

    it('responde 401 sem cookie e para usuário desativado depois do login', async () => {
      const noCookie = await http().post('/api/v1/auth/refresh');
      expect(noCookie.status).toBe(401);

      const user = await createUser(app);
      const cookie = refreshCookieFrom((await login(user.email)).headers['set-cookie'])!;
      await prisma.user.update({ where: { id: user.id }, data: { active: false } });

      const res = await http().post('/api/v1/auth/refresh').set('Cookie', cookie);
      expect(res.status).toBe(401);
    });

    it('responde 401 para refresh expirado', async () => {
      const user = await createUser(app);
      const cookie = refreshCookieFrom((await login(user.email)).headers['set-cookie'])!;
      await prisma.refreshToken.updateMany({
        where: { userId: user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await http().post('/api/v1/auth/refresh').set('Cookie', cookie);
      expect(res.status).toBe(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('revoga o refresh atual e limpa o cookie', async () => {
      const user = await createUser(app);
      const cookie = refreshCookieFrom((await login(user.email)).headers['set-cookie'])!;

      const res = await http().post('/api/v1/auth/logout').set('Cookie', cookie);
      expect(res.status).toBe(204);
      expect(refreshCookieFrom(res.headers['set-cookie'])).toBe('refresh_token=');

      const after = await http().post('/api/v1/auth/refresh').set('Cookie', cookie);
      expect(after.status).toBe(401);
    });
  });

  describe('Rotas protegidas', () => {
    it('[FND-02.6] exige autenticação por padrão: GET /auth/me sem token → 401 UNAUTHORIZED', async () => {
      const res = await http().get('/api/v1/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('[FND-02.6] rejeita token adulterado', async () => {
      const user = await createUser(app);
      const { accessToken } = (await login(user.email)).body;
      const tampered = accessToken.slice(0, -2) + (accessToken.endsWith('a') ? 'bb' : 'aa');

      const res = await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${tampered}`);
      expect(res.status).toBe(401);
    });

    it('[FND-02.6] GET /auth/me com token válido devolve o usuário', async () => {
      const user = await createUser(app, { role: 'LEITURA' });
      const { accessToken } = (await login(user.email)).body;

      const res = await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: user.id, email: user.email, role: 'LEITURA' });
    });

    it('[FND-02.6] rotas públicas (health) não pedem token', async () => {
      const res = await http().get('/api/v1/health');
      expect(res.status).not.toBe(401);
    });
  });
});
