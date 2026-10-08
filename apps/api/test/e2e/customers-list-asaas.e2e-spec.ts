import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import nock from 'nock';
import { formatDocument } from '@financeiro/shared';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CustomersService } from '../../src/modules/customers/customers.service';
import { billingFixtures } from '../fixtures/billing';
import { nextCpf } from '../fixtures/documents';
import { createTestApp, loginAs } from './test-app';

const ASAAS = 'https://api-sandbox.asaas.com';

describe('Clientes: lista, arquivo e Asaas (integração)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: CustomersService;
  let fx: ReturnType<typeof billingFixtures>;
  let fin: string;
  let leitura: string;
  const tag = `L${Date.now()}`;
  const http = () => request(app.getHttpServer());
  const list = (query: Record<string, string>, auth = fin) =>
    http().get('/api/v1/customers').query(query).set('Authorization', auth);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    service = app.get(CustomersService);
    fx = billingFixtures(prisma);
    fin = (await loginAs(app, 'FINANCEIRO')).auth;
    leitura = (await loginAs(app, 'LEITURA')).auth;
  });

  afterEach(() => nock.cleanAll());
  afterAll(async () => {
    await app?.close();
  });

  describe('[CLI-02] GET /customers', () => {
    it('busca sem acento, por documento mascarado, oculta arquivados e traz os totais', async () => {
      const jose = await fx.customer({ name: `José Ávila ${tag}` });
      await fx.customer({ name: `Josefa Arquivada ${tag}`, archivedAt: new Date() });
      await fx.charge(jose.id, 'PAID', 10_000);
      await fx.charge(jose.id, 'OVERDUE', 3_000);

      const byName = await list({ search: `jose avila ${tag}` });
      expect(byName.status).toBe(200);
      expect(byName.body.data).toEqual([
        expect.objectContaining({
          id: jose.id,
          document: jose.document,
          chargesCount: 2,
          paidCents: 10_000,
          openCents: 3_000,
          overdueCents: 3_000,
        }),
      ]);

      const byDocument = await list({ search: formatDocument(jose.document).slice(0, 7) });
      expect(byDocument.body.data.map((c: { id: string }) => c.id)).toContain(jose.id);

      const withArchived = await list({ search: tag, archived: 'true' });
      expect(withArchived.body.meta.total).toBe(2);
      expect((await list({ search: tag })).body.meta.total).toBe(1);
    });

    it('[CLI-02.4] LEITURA vê documento mascarado na lista', async () => {
      const c = await fx.customer({ name: `Mascarado ${tag}` });
      const res = await list({ search: `mascarado ${tag}` }, leitura);
      expect(res.body.data[0].document).not.toBe(c.document);
      expect(res.body.data[0].document).toMatch(/^\*\*\*\./);
    });

    it('[CLI-NF1] busca responde em menos de 300 ms com 5 mil clientes', async () => {
      await prisma.customer.createMany({
        data: Array.from({ length: 5_000 }, (_, i) => ({
          name: `Cliente Volume ${i} ${i % 7 === 0 ? 'Silva' : 'Souza'}`,
          personType: 'PF' as const,
          document: nextCpf(),
        })),
        skipDuplicates: true,
      });
      await list({ search: 'silva' }); // aquece o plano
      const timings: number[] = [];
      for (let i = 0; i < 3; i++) {
        const started = performance.now();
        const res = await list({ search: 'silva', pageSize: '20' });
        timings.push(performance.now() - started);
        expect(res.body.meta.total).toBeGreaterThan(500);
      }
      expect(Math.min(...timings)).toBeLessThan(300);
    });
  });

  describe('[CLI-04.4][CLI-04.5] arquivar e desarquivar', () => {
    it.each([
      ['cobrança em rascunho', 'charge'],
      ['contrato parcialmente assinado', 'contract'],
      ['assinatura ativa', 'subscription'],
    ] as const)('recusa com %s → CUSTOMER_HAS_OPEN_ITEMS', async (_label, kind) => {
      const c = await fx.customer();
      if (kind === 'charge') await fx.charge(c.id, 'DRAFT', 1_000);
      if (kind === 'contract') await fx.contract(c.id, 'PARTIALLY_SIGNED');
      if (kind === 'subscription') await fx.subscription(c.id, 'ACTIVE');

      const res = await http().post(`/api/v1/customers/${c.id}/archive`).set('Authorization', fin);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CUSTOMER_HAS_OPEN_ITEMS');
    });

    it('arquiva (com cobrança paga), some da lista padrão e desarquiva', async () => {
      const c = await fx.customer({ name: `Para Arquivar ${tag}` });
      await fx.charge(c.id, 'PAID', 1_000);

      const archived = await http().post(`/api/v1/customers/${c.id}/archive`).set('Authorization', fin);
      expect(archived.status).toBe(200);
      expect(archived.body.archivedAt).not.toBeNull();
      expect((await list({ search: `para arquivar ${tag}` })).body.data).toHaveLength(0);

      const back = await http().post(`/api/v1/customers/${c.id}/unarchive`).set('Authorization', fin);
      expect(back.body.archivedAt).toBeNull();
      expect(await prisma.auditLog.count({ where: { entityId: c.id, action: { in: ['customer.archive', 'customer.unarchive'] } } })).toBe(2);
    });
  });

  describe('[CLI-05] ensureAsaasCustomer', () => {
    it('já tem id: não chama o Asaas', async () => {
      const c = await fx.customer({ asaasCustomerId: 'cus_existente' });
      await expect(service.ensureAsaasCustomer(c.id)).resolves.toBe('cus_existente');
    });

    it('[CLI-05.1] acha pelo CPF/CNPJ e reutiliza', async () => {
      const c = await fx.customer();
      nock(ASAAS).get('/v3/customers').query({ cpfCnpj: c.document })
        .reply(200, { data: [{ id: 'cus_removido', deleted: true }, { id: 'cus_achado', deleted: false }] });

      await expect(service.ensureAsaasCustomer(c.id)).resolves.toBe('cus_achado');
      expect((await prisma.customer.findUnique({ where: { id: c.id } }))?.asaasCustomerId).toBe('cus_achado');
    });

    it('[CLI-05.1][CLI-05.2] cria uma única vez com duas chamadas simultâneas', async () => {
      const c = await fx.customer({ name: 'Cliente Concorrente' });
      await prisma.customer.update({
        where: { id: c.id },
        data: { phone: '11988887777', remindersEnabled: false },
      });
      const posts: unknown[] = [];
      nock(ASAAS).get('/v3/customers').query({ cpfCnpj: c.document }).once().reply(200, { data: [] });
      nock(ASAAS)
        .post('/v3/customers')
        .once()
        .delay(100)
        .reply(200, async (req: Request) => {
          posts.push(await req.json());
          return { id: 'cus_novo', name: 'Cliente Concorrente', cpfCnpj: c.document };
        });

      const ids = await Promise.all([service.ensureAsaasCustomer(c.id), service.ensureAsaasCustomer(c.id)]);

      expect(ids).toEqual(['cus_novo', 'cus_novo']);
      expect(posts).toHaveLength(1);
      expect(posts[0]).toMatchObject({
        name: 'Cliente Concorrente',
        cpfCnpj: c.document,
        mobilePhone: '11988887777',
        externalReference: c.id,
        notificationDisabled: true,
      });
    });
  });

  it('[CLI-04.2] duas edições seguidas: o Asaas recebe o estado da última', async () => {
    const c = await fx.customer({ asaasCustomerId: 'cus_sync' });
    const puts: Array<{ name: string }> = [];
    // Captura no reply, que só roda quando o caminho casa (o filtro de corpo do nock vê qualquer PUT).
    // nock 15: a função recebe só o Request (com 2 parâmetros vira estilo callback).
    nock(ASAAS)
      .put('/v3/customers/cus_sync')
      .times(2)
      .reply(200, async (req: Request) => {
        puts.push((await req.json()) as { name: string });
        return { id: 'cus_sync' };
      });

    await http().patch(`/api/v1/customers/${c.id}`).set('Authorization', fin).send({ name: 'Primeiro Nome' });
    await http().patch(`/api/v1/customers/${c.id}`).set('Authorization', fin).send({ name: 'Segundo Nome' });

    await expect.poll(() => puts.at(-1)?.name, { timeout: 10_000 }).toBe('Segundo Nome');
    expect(puts.length).toBeGreaterThanOrEqual(1);
  });
});
