import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import nock from 'nock';
import { inject } from 'vitest';
import { configureApp } from '../../src/app.setup';
import { PrismaService } from '../../src/prisma/prisma.service';

export const TEST_PASSWORD = 'senha-de-teste-123';

export async function createTestApp(): Promise<INestApplication> {
  // Só o servidor local do supertest; Asaas e afins precisam de `nock` explícito no teste.
  nock.disableNetConnect();
  nock.enableNetConnect(/^(127\.0\.0\.1|localhost)(:\d+)?$/);

  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: inject('databaseUrl'),
    REDIS_URL: inject('redisUrl'),
    JWT_ACCESS_SECRET: 'access-secret-for-tests-only-0123456789',
    JWT_REFRESH_SECRET: 'refresh-secret-for-tests-only-0123456789',
    ASAAS_ENV: 'sandbox',
    ASAAS_API_KEY: 'test-key',
    ASAAS_WEBHOOK_TOKEN: 'webhook-token-for-tests-only-0123456789',
  });

  // Importado depois do env: o AppModule lê NODE_ENV ao ser avaliado.
  const { AppModule } = await import('../../src/app.module');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app);
  await app.init();
  return app;
}

let counter = 0;

export async function createUser(
  app: INestApplication,
  overrides: { role?: 'ADMIN' | 'FINANCEIRO' | 'LEITURA'; active?: boolean } = {},
) {
  counter += 1;
  const prisma = app.get(PrismaService);
  return prisma.user.create({
    data: {
      name: `Usuário ${counter}`,
      email: `user${counter}-${Date.now()}@teste.local`,
      passwordHash: await argon2.hash(TEST_PASSWORD, { type: argon2.argon2id }),
      role: overrides.role ?? 'FINANCEIRO',
      active: overrides.active ?? true,
    },
  });
}

export async function loginAs(
  app: INestApplication,
  role: 'ADMIN' | 'FINANCEIRO' | 'LEITURA',
): Promise<{ user: Awaited<ReturnType<typeof createUser>>; token: string; auth: string }> {
  const user = await createUser(app, { role });
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: TEST_PASSWORD });
  if (res.status !== 200) throw new Error(`login falhou: ${res.status} ${JSON.stringify(res.body)}`);
  return { user, token: res.body.accessToken, auth: `Bearer ${res.body.accessToken}` };
}

export function refreshCookieFrom(setCookie: string[] | string | undefined): string | undefined {
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const raw = cookies.find((c) => c.startsWith('refresh_token='));
  return raw?.split(';')[0];
}
