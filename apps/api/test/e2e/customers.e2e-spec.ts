import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { formatDocument } from '@financeiro/shared';
import { PrismaService } from '../../src/prisma/prisma.service';
import { billingFixtures } from '../fixtures/billing';
import { nextCpf } from '../fixtures/documents';
import { createTestApp, loginAs } from './test-app';

const CNPJ = '11222333000181';

describe('Clientes (integração)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fin: string;
  let admin: string;
  let leitura: string;
  let fx: ReturnType<typeof billingFixtures>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    fx = billingFixtures(prisma);
    fin = (await loginAs(app, 'FINANCEIRO')).auth;
    admin = (await loginAs(app, 'ADMIN')).auth;
    leitura = (await loginAs(app, 'LEITURA')).auth;
  });

  afterAll(async () => {
    await app?.close();
  });

  const create = (body: object, auth = fin) => http().post('/api/v1/customers').set('Authorization', auth).send(body);
  const patch = (id: string, body: object, auth = fin) =>
    http().patch(`/api/v1/customers/${id}`).set('Authorization', auth).send(body);
  const get = (id: string, auth = fin) => http().get(`/api/v1/customers/${id}`).set('Authorization', auth);

  describe('POST /customers', () => {
    it('[CLI-01.1][CLI-01.4] cria PF com CPF mascarado: guarda só dígitos e deriva o tipo', async () => {
      const cpf = nextCpf();
      const res = await create({ name: 'Maria Teste', document: formatDocument(cpf) });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        name: 'Maria Teste',
        document: cpf,
        personType: 'PF',
        email: null,
        phone: null,
        address: null,
        remindersEnabled: true,
        asaasCustomerId: null,
        archivedAt: null,
      });
      expect((await prisma.customer.findUnique({ where: { id: res.body.id } }))?.document).toBe(cpf);
    });

    it('[CLI-01.1] CNPJ vira PJ', async () => {
      await prisma.customer.deleteMany({ where: { document: CNPJ } });
      const res = await create({ name: 'Empresa Teste Ltda', document: '11.222.333/0001-81' });
      expect(res.status).toBe(201);
      expect(res.body.personType).toBe('PJ');
    });

    it('[CLI-01.2] aceita e normaliza os campos opcionais', async () => {
      const res = await create({
        name: 'Cliente Completo',
        document: nextCpf(),
        email: ' Cliente@Exemplo.COM ',
        phone: '(11) 98888-7777',
        address: {
          postalCode: '01310-100',
          street: 'Av. Paulista',
          number: '1000',
          complement: 'Sala 1',
          district: 'Bela Vista',
          city: 'São Paulo',
          state: 'sp',
        },
        notes: 'Prefere boleto',
        remindersEnabled: false,
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        email: 'cliente@exemplo.com',
        phone: '11988887777',
        address: { postalCode: '01310100', state: 'SP', complement: 'Sala 1' },
        notes: 'Prefere boleto',
        remindersEnabled: false,
      });
    });

    it('[CLI-01.1] valida em português e não cria nada', async () => {
      const before = await prisma.customer.count();
      const res = await create({ name: 'X', document: '123.456.789-00' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([
          { path: 'name', message: 'Informe o nome (mínimo 2 caracteres)' },
          { path: 'document', message: 'CPF ou CNPJ inválido' },
        ]),
      );
      expect(await prisma.customer.count()).toBe(before);
    });

    it('[CLI-01.3] documento repetido → 409 CUSTOMER_DUPLICATE dizendo qual cliente é', async () => {
      const existing = await fx.customer({ name: 'Cliente Original' });
      const res = await create({ name: 'Outro Nome', document: formatDocument(existing.document) });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({
        code: 'CUSTOMER_DUPLICATE',
        message: 'Já existe um cliente com este documento: Cliente Original',
        details: { customerId: existing.id, name: 'Cliente Original', archived: false },
      });
    });

    it('[CLI-01.3] vale também para cliente arquivado', async () => {
      const archived = await fx.customer({ name: 'Cliente Antigo', archivedAt: new Date() });
      const res = await create({ name: 'Novo', document: archived.document });
      expect(res.status).toBe(409);
      expect(res.body.error.details).toMatchObject({ customerId: archived.id, archived: true });
      expect(res.body.error.message).toContain('arquivado');
    });

    it('[CLI-01.3] dois cadastros simultâneos do mesmo documento: um entra, o outro recebe CUSTOMER_DUPLICATE', async () => {
      const document = nextCpf();
      const [a, b] = await Promise.all([
        create({ name: 'Corrida A', document }),
        create({ name: 'Corrida B', document }),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect([a, b].find((r) => r.status === 409)?.body.error.code).toBe('CUSTOMER_DUPLICATE');
      expect(await prisma.customer.count({ where: { document } })).toBe(1);
    });

    it('[CLI-NF2] auditoria da criação sem o documento completo', async () => {
      const cpf = nextCpf();
      const res = await create({ name: 'Auditado', document: cpf });
      const log = await prisma.auditLog.findFirst({ where: { action: 'customer.create', entityId: res.body.id } });
      expect(log?.data).toMatchObject({ name: 'Auditado', personType: 'PF' });
      expect(JSON.stringify(log?.data)).not.toContain(cpf);
    });

    it('[FND-03.3] LEITURA não cadastra', async () => {
      const res = await create({ name: 'Bloqueado', document: nextCpf() }, leitura);
      expect(res.status).toBe(403);
    });
  });

  describe('GET /customers/lookup', () => {
    it('[CLI-01.3] informa se o documento já existe, aceitando máscara', async () => {
      const existing = await fx.customer({ name: 'Achável' });
      const found = await http()
        .get('/api/v1/customers/lookup')
        .query({ document: formatDocument(existing.document) })
        .set('Authorization', fin);
      expect(found.body).toEqual({ exists: true, customerId: existing.id, name: 'Achável', archived: false });

      const missing = await http().get('/api/v1/customers/lookup').query({ document: nextCpf() }).set('Authorization', fin);
      expect(missing.body).toEqual({ exists: false });
    });

    it('documento inválido → 400; LEITURA → 403', async () => {
      const invalid = await http().get('/api/v1/customers/lookup').query({ document: '123' }).set('Authorization', fin);
      expect(invalid.status).toBe(400);
      const forbidden = await http().get('/api/v1/customers/lookup').query({ document: nextCpf() }).set('Authorization', leitura);
      expect(forbidden.status).toBe(403);
    });
  });

  describe('GET /customers/:id', () => {
    it('[CLI-03.1] ficha com totais, cobranças recentes, assinaturas ativas e contratos', async () => {
      const c = await fx.customer({ name: 'Cliente com Histórico' });
      await fx.charge(c.id, 'PAID', 10_000, { dueDate: '2026-08-10' });
      await fx.charge(c.id, 'PARTIALLY_REFUNDED', 6_000, { refundedCents: 1_000, dueDate: '2026-08-20' });
      await fx.charge(c.id, 'PENDING', 4_000, { dueDate: '2026-11-10' });
      await fx.charge(c.id, 'OVERDUE', 2_500, { dueDate: '2026-09-10' });
      await fx.charge(c.id, 'DRAFT', 9_999);
      await fx.charge(c.id, 'CANCELED', 7_000);
      await fx.subscription(c.id, 'ACTIVE');
      await fx.subscription(c.id, 'CANCELED');
      await fx.contract(c.id, 'SIGNED');

      const res = await get(c.id);

      expect(res.status).toBe(200);
      expect(res.body.totals).toEqual({ chargesCount: 4, paidCents: 15_000, openCents: 6_500, overdueCents: 2_500 });
      expect(res.body.recentCharges).toHaveLength(6);
      expect(res.body.recentCharges[0]).toMatchObject({ status: 'CANCELED', dueDate: '2026-10-20' });
      expect(res.body.subscriptions).toEqual([
        expect.objectContaining({ status: 'ACTIVE', cycle: 'MONTHLY', nextDueDate: '2026-11-05', valueCents: 50_000 }),
      ]);
      expect(res.body.contracts).toEqual([expect.objectContaining({ status: 'SIGNED', totalCents: 100_000 })]);
    });

    it('[CLI-02.4] LEITURA vê o documento mascarado; FINANCEIRO vê completo', async () => {
      const c = await fx.customer();
      expect((await get(c.id)).body.document).toBe(c.document);
      const masked = (await get(c.id, leitura)).body.document;
      expect(masked).toMatch(/^\*\*\*\.\d{3}\.\d{3}-\*\*$/);
      expect(masked).not.toContain(c.document);
    });

    it('404 para cliente inexistente', async () => {
      const res = await get('00000000-0000-4000-8000-000000000000');
      expect(res.status).toBe(404);
      expect(res.body.error).toMatchObject({ code: 'NOT_FOUND', message: 'Cliente não encontrado' });
    });
  });

  describe('PATCH /customers/:id', () => {
    it('[CLI-04.1] edita só o que veio; não religa a régua', async () => {
      const c = await fx.customer({ name: 'Antes' });
      await prisma.customer.update({ where: { id: c.id }, data: { remindersEnabled: false, email: 'a@b.com' } });

      const res = await patch(c.id, { name: 'Depois' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ name: 'Depois', remindersEnabled: false, email: 'a@b.com' });
    });

    it('[CLI-04.1] null apaga e-mail e endereço', async () => {
      const c = await fx.customer();
      await patch(c.id, {
        email: 'x@y.com',
        address: { postalCode: '01310100', street: 'Rua A', number: '1', district: 'Centro', city: 'Santos', state: 'SP' },
      });
      const res = await patch(c.id, { email: null, address: null });
      expect(res.body).toMatchObject({ email: null, address: null });
      expect((await prisma.customer.findUnique({ where: { id: c.id } }))?.address).toBeNull();
    });

    it('[CLI-04.3] troca o documento quando não há trava e recalcula PF/PJ', async () => {
      const c = await fx.customer();
      await fx.charge(c.id, 'DRAFT', 1_000); // rascunho não foi emitido: não trava
      await prisma.customer.deleteMany({ where: { document: CNPJ } });

      const res = await patch(c.id, { document: '11.222.333/0001-81' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ document: CNPJ, personType: 'PJ' });
    });

    it.each([
      ['cadastro no Asaas', 'ASAAS_CUSTOMER'],
      ['cobrança emitida', 'CHARGES'],
      ['contrato enviado', 'CONTRACTS'],
    ] as const)('[CLI-04.3] documento travado por %s → 409 CUSTOMER_DOCUMENT_LOCKED', async (_label, reason) => {
      const c = await fx.customer(reason === 'ASAAS_CUSTOMER' ? { asaasCustomerId: `cus_${Date.now()}` } : {});
      if (reason === 'CHARGES') await fx.charge(c.id, 'PENDING', 1_000);
      if (reason === 'CONTRACTS') await fx.contract(c.id, 'PARTIALLY_SIGNED');

      const res = await patch(c.id, { document: nextCpf() });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({ code: 'CUSTOMER_DOCUMENT_LOCKED', details: { reasons: [reason] } });
      expect((await prisma.customer.findUnique({ where: { id: c.id } }))?.document).toBe(c.document);
    });

    it('[CLI-04.3] reenviar o mesmo documento num cliente travado não é troca', async () => {
      const c = await fx.customer({ asaasCustomerId: `cus_same_${Date.now()}` });
      const res = await patch(c.id, { document: formatDocument(c.document), name: 'Só o nome' });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Só o nome');
    });

    it('[CLI-01.3] trocar para documento de outro cliente → CUSTOMER_DUPLICATE', async () => {
      const a = await fx.customer({ name: 'Dono do documento' });
      const b = await fx.customer();
      const res = await patch(b.id, { document: a.document });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({ code: 'CUSTOMER_DUPLICATE', details: { customerId: a.id } });
    });

    it('[CLI-NF2] auditoria com antes/depois e documento mascarado', async () => {
      const c = await fx.customer({ name: 'Nome Velho' });
      const newCpf = nextCpf();
      await patch(c.id, { name: 'Nome Novo', document: newCpf, phone: '11977776666' }, admin);

      const log = await prisma.auditLog.findFirst({ where: { action: 'customer.update', entityId: c.id } });
      expect(log?.data).toMatchObject({
        before: { name: 'Nome Velho', phone: null },
        after: { name: 'Nome Novo', phone: '11977776666' },
      });
      const raw = JSON.stringify(log?.data);
      expect(raw).not.toContain(c.document);
      expect(raw).not.toContain(newCpf);
      expect(raw).toContain('***.');
    });

    it('PATCH sem mudança não gera auditoria; LEITURA não edita', async () => {
      const c = await fx.customer({ name: 'Igual' });
      await patch(c.id, { name: 'Igual' });
      expect(await prisma.auditLog.count({ where: { action: 'customer.update', entityId: c.id } })).toBe(0);
      expect((await patch(c.id, { name: 'Outro' }, leitura)).status).toBe(403);
    });
  });
});
