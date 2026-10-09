import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { addDays, todayInSaoPaulo, toSaoPauloDate, type ChargePlanInput } from '@financeiro/shared';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CONTRACT_PROVIDER } from '../../src/integrations/contracts/contract-provider';
import type { FakeContractProvider } from '../../src/integrations/contracts/fake-contract.provider';
import { ContractLifecycleService } from '../../src/modules/contracts/contract-lifecycle.service';
import { billingFixtures } from '../fixtures/billing';
import { createTestApp, loginAs } from './test-app';

const address = { postalCode: '01310100', street: 'Av. Paulista', number: '1000', district: 'Bela Vista', city: 'São Paulo', state: 'SP' };
const plan: ChargePlanInput = {
  items: [{ description: 'Gestão de redes', quantity: 1, unitPriceCents: 120_000 }],
  type: 'SINGLE',
  billingType: 'PIX',
  dueDate: { mode: 'DAYS_AFTER_SIGNATURE', days: 3 },
  finePct: 2,
  interestPct: 1,
};

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 15_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (ok(value) || Date.now() > until) return value;
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** Spec 07 com o FakeProvider e o Asaas simulado: rascunho → envio → assinaturas → cobrança. */
describe('Contratos (integração)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fake: FakeContractProvider;
  let fin: string;
  let admin: string;
  let templateId: string;
  const http = () => request(app.getHttpServer());

  const newContract = async (customerId: string, overrides: object = {}) => {
    const res = await http()
      .post('/api/v1/contracts')
      .set('Authorization', fin)
      .send({
        customerId,
        templateId,
        title: 'Contrato de prestação de serviços',
        chargePlan: plan,
        signers: [
          { role: 'CLIENT', name: 'Cliente', email: 'cliente@exemplo.com' },
          { role: 'COMPANY', name: 'Empresa', email: 'empresa@exemplo.com', signOrder: 2 },
        ],
        ...overrides,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as { id: string };
  };
  const sign = (doc: string, signer: string, action = 'sign') =>
    http().post(`/api/v1/dev/fake-sign/${doc}/${signer}`).type('form').send({ action }).expect(303);

  beforeAll(async () => {
    app = await createTestApp({
      ASAAS_ENV: 'mock',
      ASAAS_API_KEY: '',
      CONTRACT_PROVIDER: 'fake',
      STORAGE_LOCAL_DIR: mkdtempSync(join(tmpdir(), 'contratos-')),
    });
    prisma = app.get(PrismaService);
    fake = app.get(CONTRACT_PROVIDER);
    fin = (await loginAs(app, 'FINANCEIRO')).auth;
    admin = (await loginAs(app, 'ADMIN')).auth;

    const unknown = await http()
      .post('/api/v1/contract-templates')
      .set('Authorization', admin)
      .send({ name: 'Modelo', provider: 'fake', providerTemplateId: 't-1', variableMap: { nome: 'cliente.apelido' } });
    expect(unknown.body.error.code).toBe('TEMPLATE_UNKNOWN_VARIABLE');

    const created = await http()
      .post('/api/v1/contract-templates')
      .set('Authorization', admin)
      .send({ name: 'Modelo', provider: 'fake', providerTemplateId: 't-1', variableMap: { nome: 'cliente.nome', valor: 'cobranca.valor_total', vencimento: 'cobranca.vencimento' } });
    templateId = created.body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('[CTR-02.9][CTR-02.3] envio exige endereço completo; signatários sem a empresa são recusados', async () => {
    const noAddress = await billingFixtures(prisma).customer();
    const { id } = await newContract(noAddress.id);
    const res = await http().post(`/api/v1/contracts/${id}/send`).set('Authorization', fin);
    expect(res.body.error.code).toBe('CUSTOMER_ADDRESS_REQUIRED');

    const bad = await http()
      .post('/api/v1/contracts')
      .set('Authorization', fin)
      .send({ customerId: noAddress.id, templateId, title: 'X contrato', chargePlan: plan, signers: [{ role: 'CLIENT', name: 'A', email: 'a@x.com' }, { role: 'CLIENT', name: 'B', email: 'b@x.com' }] });
    expect(bad.status).toBe(400);
  });

  it('[CTR-03.1][CTR-03.3][CTR-04.1][CTR-04.2][CTR-04.3][CTR-05.1][CTR-05.3] envia retomando a falha, assina e gera a cobrança uma vez', async () => {
    const customer = await prisma.customer.create({ data: { name: 'Cliente Contrato', personType: 'PF', document: `9${Date.now()}`.slice(0, 11), address } });
    const { id } = await newContract(customer.id);

    const preview = await http().post(`/api/v1/contracts/${id}/preview`).set('Authorization', fin);
    expect(preview.body.fields).toMatchObject({ nome: 'Cliente Contrato', vencimento: '3 dias após a assinatura' });

    fake.failOnceAt('signers');
    const failed = await http().post(`/api/v1/contracts/${id}/send`).set('Authorization', fin);
    expect(failed.body.error.code).toBe('CONTRACT_PROVIDER_ERROR');
    const draft = await prisma.contract.findUniqueOrThrow({ where: { id } });
    expect(draft).toMatchObject({ status: 'DRAFT', providerError: expect.stringContaining('signers') });

    const sent = await http().post(`/api/v1/contracts/${id}/send`).set('Authorization', fin);
    expect(sent.body.status).toBe('SENT');
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id }, include: { signers: { orderBy: { signOrder: 'asc' } } } });
    expect(contract.providerEnvelopeId).toBe(draft.providerEnvelopeId); // retomou, sem envelope novo
    expect(contract.signers.every((s) => s.signUrl)).toBe(true);

    const doc = contract.providerDocumentId!;
    await sign(doc, contract.signers[0]!.providerSignerId!);
    await waitFor(() => prisma.contract.findUniqueOrThrow({ where: { id } }), (c) => c.status === 'PARTIALLY_SIGNED');
    await sign(doc, contract.signers[1]!.providerSignerId!);

    const signed = await waitFor(
      () => prisma.contract.findUniqueOrThrow({ where: { id } }),
      (c) => c.chargeGeneratedAt !== null && c.signedFileKey !== null,
    );
    expect(signed.status).toBe('SIGNED');
    const charges = await prisma.charge.findMany({ where: { contractId: id } });
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({ origin: 'CONTRACT', status: 'PENDING', valueCents: 120_000 });
    expect(charges[0]!.dueDate.toISOString().slice(0, 10)).toBe(addDays(toSaoPauloDate(signed.signedAt!), 3));

    // CTR-05.3: reprocessar não gera de novo
    await app.get(ContractLifecycleService).generateCharge(id);
    expect(await prisma.charge.count({ where: { contractId: id } })).toBe(1);
    const again = await http().post(`/api/v1/contracts/${id}/generate-charge`).set('Authorization', fin);
    expect(again.body.error.code).toBe('CONTRACT_CHARGE_ALREADY_GENERATED');

    const file = await http().get(`/api/v1/contracts/${id}/signed-file`).set('Authorization', fin);
    expect((await http().get(file.body.url)).headers['content-type']).toBe('application/pdf');
  });

  it('[CTR-05.2] geração tardia com "dias após a assinatura" vencido usa hoje + prazo das configurações', async () => {
    const customer = await prisma.customer.create({ data: { name: 'Cliente Tardio', personType: 'PF', document: `8${Date.now()}`.slice(0, 11), address } });
    const { id } = await newContract(customer.id);
    await prisma.contract.update({ where: { id }, data: { status: 'SIGNED', signedAt: new Date(Date.now() - 10 * 86_400_000) } });
    await app.get(ContractLifecycleService).generateCharge(id);
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    const charge = await prisma.charge.findFirstOrThrow({ where: { contractId: id } });
    expect(charge.dueDate.toISOString().slice(0, 10)).toBe(addDays(todayInSaoPaulo(), settings?.contractChargeDueDays ?? 3));
    expect(await prisma.auditLog.count({ where: { action: 'contract.due_date_adjusted', entityId: id } })).toBe(1);
  });

  it('[CTR-04.4][CTR-04.5][CTR-06.2] recusa, webhook sem HMAC válido e cancelamento', async () => {
    const customer = await prisma.customer.create({ data: { name: 'Cliente Recusa', personType: 'PF', document: `7${Date.now()}`.slice(0, 11), address } });
    const a = await newContract(customer.id);
    await http().post(`/api/v1/contracts/${a.id}/send`).set('Authorization', fin).expect(200);
    const ca = await prisma.contract.findUniqueOrThrow({ where: { id: a.id }, include: { signers: true } });
    await sign(ca.providerDocumentId!, ca.signers.find((s) => s.role === 'CLIENT')!.providerSignerId!, 'refuse');
    await waitFor(() => prisma.contract.findUniqueOrThrow({ where: { id: a.id } }), (c) => c.status === 'REFUSED');

    const before = await prisma.webhookEvent.count({ where: { source: 'CONTRACT' } });
    const forged = await http()
      .post('/api/v1/webhooks/contracts/fake')
      .set('Content-Hmac', 'sha256=deadbeef')
      .send({ events: [{ type: 'DOCUMENT_COMPLETED', eventId: 'x', providerDocumentId: ca.providerDocumentId, at: new Date().toISOString() }] });
    expect(forged.status).toBe(401);
    expect(await prisma.webhookEvent.count({ where: { source: 'CONTRACT' } })).toBe(before);

    const b = await newContract(customer.id);
    await http().post(`/api/v1/contracts/${b.id}/send`).set('Authorization', fin).expect(200);
    const canceled = await http().post(`/api/v1/contracts/${b.id}/cancel`).set('Authorization', fin).send({ reason: 'Desistiu' });
    expect(canceled.body.status).toBe('CANCELED');
    const signedOne = await http().post(`/api/v1/contracts/${b.id}/cancel`).set('Authorization', fin).send({});
    expect(signedOne.body.error.code).toBe('CONTRACT_NOT_CANCELABLE');
  });
});
