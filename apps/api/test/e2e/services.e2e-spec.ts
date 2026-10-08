import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { billingFixtures } from '../fixtures/billing';
import { createTestApp, loginAs } from './test-app';

describe('Serviços (integração)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fin: string;
  let leitura: string;
  let customerId: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    fin = (await loginAs(app, 'FINANCEIRO')).auth;
    leitura = (await loginAs(app, 'LEITURA')).auth;
    customerId = (await billingFixtures(prisma).customer()).id;
  });

  afterAll(async () => {
    await app?.close();
  });

  /** Nomes únicos: o banco é compartilhado entre os arquivos de teste. */
  const uniqueName = (base: string) => `${base} ${randomUUID().slice(0, 8)}`;
  const create = (body: object, auth = fin) => http().post('/api/v1/services').set('Authorization', auth).send(body);
  const patch = (id: string, body: object) => http().patch(`/api/v1/services/${id}`).set('Authorization', fin).send(body);
  const remove = (id: string) => http().delete(`/api/v1/services/${id}`).set('Authorization', fin);
  const list = (query: Record<string, string>, auth = fin) =>
    http().get('/api/v1/services').query(query).set('Authorization', auth);

  async function newService(overrides: object = {}) {
    const res = await create({ name: uniqueName('Serviço'), defaultPriceCents: 10_000, ...overrides });
    expect(res.status).toBe(201);
    return res.body as { id: string; name: string };
  }

  function chargeWithItem(
    serviceId: string,
    extra: { groupKey?: string; subscriptionId?: string; unitPriceCents?: number; type?: 'SINGLE' | 'INSTALLMENT' } = {},
  ) {
    const unitPriceCents = extra.unitPriceCents ?? 10_000;
    return prisma.charge.create({
      data: {
        customerId,
        type: extra.type ?? 'SINGLE',
        billingType: 'PIX',
        valueCents: unitPriceCents,
        dueDate: new Date('2026-10-20T00:00:00Z'),
        description: 'Cobrança de teste',
        externalReference: `chg_${randomUUID()}`,
        groupKey: extra.groupKey,
        subscriptionId: extra.subscriptionId,
        items: { create: { serviceId, description: 'Item', quantity: 1, unitPriceCents, totalCents: unitPriceCents } },
      },
      include: { items: true },
    });
  }

  async function usageOf(id: string) {
    const res = await list({ status: 'all' });
    return (res.body.data as Array<{ id: string; usageCount: number }>).find((s) => s.id === id)?.usageCount;
  }

  it('[SRV-01.1] cria serviço ativo com descrição opcional', async () => {
    const name = uniqueName('Consultoria');
    const res = await create({ name: `  ${name}  `, defaultPriceCents: 150_000 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name, description: null, defaultPriceCents: 150_000, active: true });
  });

  it('[SRV-01.1] valida nome e preço em português', async () => {
    const res = await create({ name: 'X', defaultPriceCents: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        { path: 'name', message: 'Informe o nome (mínimo 2 caracteres)' },
        { path: 'defaultPriceCents', message: 'Informe um preço maior que zero' },
      ]),
    );
  });

  it('[SRV-01.2] nome igual a outro ativo, sem diferenciar maiúsculas → 409 SERVICE_DUPLICATE', async () => {
    const existing = await newService();
    const res = await create({ name: existing.name.toUpperCase(), defaultPriceCents: 5_000 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SERVICE_DUPLICATE');
  });

  it('[SRV-01.2] nome igual a um inativo é permitido; reativar ou renomear para nome ativo → SERVICE_DUPLICATE', async () => {
    const inactive = await newService({ active: false });
    const active = await newService({ name: inactive.name.toLowerCase() });

    expect((await patch(inactive.id, { active: true })).body.error.code).toBe('SERVICE_DUPLICATE');

    const other = await newService();
    const rename = await patch(other.id, { name: active.name });
    expect(rename.status).toBe(409);
    expect(rename.body.error.code).toBe('SERVICE_DUPLICATE');
  });

  it('[SRV-02.1][SRV-03.1] desativado sai do catálogo ativo e aparece nos filtros inativo/todos', async () => {
    const service = await newService();
    expect((await patch(service.id, { active: false })).body.active).toBe(false);

    const ids = async (status: string) =>
      ((await list({ status, search: service.name })).body.data as Array<{ id: string }>).map((s) => s.id);
    expect(await ids('active')).not.toContain(service.id);
    expect(await ids('inactive')).toEqual([service.id]);
    expect(await ids('all')).toEqual([service.id]);
  });

  it('[SRV-03.1] usageCount conta vendas: parcelada 3× conta 1, assinatura conta 1', async () => {
    const service = await newService();
    const groupKey = `grp_${randomUUID()}`;
    for (let i = 0; i < 3; i++) await chargeWithItem(service.id, { groupKey, type: 'INSTALLMENT' });
    await chargeWithItem(service.id);

    const subscription = await billingFixtures(prisma).subscription(customerId, 'ACTIVE');
    await prisma.subscriptionItem.create({
      data: { subscriptionId: subscription.id, serviceId: service.id, description: 'Item', quantity: 1, unitPriceCents: 50_000, totalCents: 50_000 },
    });
    // Cobranças geradas pela assinatura não contam de novo.
    await chargeWithItem(service.id, { subscriptionId: subscription.id });
    await chargeWithItem(service.id, { subscriptionId: subscription.id });

    expect(await usageOf(service.id)).toBe(3);
    expect(await usageOf((await newService()).id)).toBe(0);
  });

  it('[SRV-01.3][SRV-NF1] mudar o preço não altera itens já criados e audita antes/depois', async () => {
    const service = await newService({ defaultPriceCents: 10_000 });
    const charge = await chargeWithItem(service.id, { unitPriceCents: 10_000 });

    const res = await patch(service.id, { defaultPriceCents: 12_500 });
    expect(res.status).toBe(200);
    expect(res.body.defaultPriceCents).toBe(12_500);

    const item = await prisma.chargeItem.findUniqueOrThrow({ where: { id: charge.items[0]!.id } });
    expect(item.unitPriceCents).toBe(10_000);
    expect((await prisma.charge.findUniqueOrThrow({ where: { id: charge.id } })).valueCents).toBe(10_000);

    const log = await prisma.auditLog.findFirst({ where: { action: 'service.update', entityId: service.id } });
    expect(log?.data).toEqual({ before: { defaultPriceCents: 10_000 }, after: { defaultPriceCents: 12_500 } });
  });

  it('[SRV-02.2] exclui serviço nunca usado', async () => {
    const service = await newService();
    expect((await remove(service.id)).status).toBe(204);
    expect(await prisma.service.findUnique({ where: { id: service.id } })).toBeNull();
  });

  it('[SRV-02.2] não exclui serviço usado em item ou em plano de contrato → 409 SERVICE_IN_USE', async () => {
    const inCharge = await newService();
    await chargeWithItem(inCharge.id);

    const inContract = await newService();
    const template = await prisma.contractTemplate.create({
      data: { name: 'Modelo', provider: 'fake', providerTemplateId: 'fake-1', variableMap: {} },
    });
    await prisma.contract.create({
      data: {
        customerId,
        templateId: template.id,
        title: 'Contrato',
        provider: 'fake',
        variables: {},
        chargePlan: { items: [{ serviceId: inContract.id, description: 'Item', quantity: 1, unitPriceCents: 10_000 }] },
        totalCents: 10_000,
      },
    });

    for (const service of [inCharge, inContract]) {
      const res = await remove(service.id);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SERVICE_IN_USE');
      expect(await prisma.service.findUnique({ where: { id: service.id } })).not.toBeNull();
    }
  });

  it('LEITURA lista mas não altera o catálogo', async () => {
    expect((await list({}, leitura)).status).toBe(200);
    expect((await create({ name: uniqueName('Serviço'), defaultPriceCents: 1_000 }, leitura)).status).toBe(403);
  });
});
