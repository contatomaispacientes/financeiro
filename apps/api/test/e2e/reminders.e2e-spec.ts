import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { addDays, DEFAULT_REMINDER_TEMPLATES, todayInSaoPaulo, type ReminderKind } from '@financeiro/shared';
import type { Settings } from '../../src/generated/prisma/client.js';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RemindersService } from '../../src/modules/reminders/reminders.service';
import { nextCpf } from '../fixtures/documents';
import { createTestApp, loginAs } from './test-app';

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 10_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (ok(value) || Date.now() > until) return value;
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** Spec 08 com SMTP_HOST=json (não envia, só registra) e o Asaas simulado. */
describe('Régua de cobrança (integração)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: string;
  let fin: string;
  let previous: Settings | null;
  const http = () => request(app.getHttpServer());
  const today = todayInSaoPaulo();

  const customer = (email: string | null) => prisma.customer.create({ data: { name: 'Cliente Régua', personType: 'PF', document: nextCpf(), email } });
  const charge = (customerId: string, dueDate: string, status: 'PENDING' | 'OVERDUE' = 'PENDING') =>
    prisma.charge.create({
      data: {
        customerId,
        type: 'SINGLE',
        status,
        billingType: 'PIX',
        valueCents: 15_000,
        dueDate: new Date(`${dueDate}T00:00:00Z`),
        description: 'Mensalidade (1x)',
        externalReference: `chg_${crypto.randomUUID()}`,
        invoiceUrl: 'https://exemplo/fatura',
      },
    });
  const logs = (chargeId: string) => prisma.reminderLog.findMany({ where: { chargeId, OR: [{ error: null }, { error: { not: 'IN_PROGRESS' } }] } });

  beforeAll(async () => {
    app = await createTestApp({ ASAAS_ENV: 'mock', ASAAS_API_KEY: '', STORAGE_LOCAL_DIR: mkdtempSync(join(tmpdir(), 'regua-')) });
    prisma = app.get(PrismaService);
    admin = (await loginAs(app, 'ADMIN')).auth;
    fin = (await loginAs(app, 'FINANCEIRO')).auth;
    previous = await prisma.settings.findUnique({ where: { id: 1 } });
    const regua = { reminderChannels: ['ASAAS', 'EMAIL'], reminderDaysBefore: 3, reminderOnDueDate: true, reminderDaysAfter: [1, 7] };
    await prisma.settings.upsert({ where: { id: 1 }, create: { id: 1, ...regua }, update: regua });
    for (const kind of Object.keys(DEFAULT_REMINDER_TEMPLATES) as ReminderKind[]) {
      const d = DEFAULT_REMINDER_TEMPLATES[kind];
      const data = { subject: d.subject, body: d.body, active: true };
      const row = await prisma.reminderTemplate.findFirst({ where: { kind, channel: 'EMAIL', offsetDays: null } });
      if (row) await prisma.reminderTemplate.update({ where: { id: row.id }, data });
      else await prisma.reminderTemplate.create({ data: { ...data, kind, channel: 'EMAIL' } });
    }
  });

  afterAll(async () => {
    if (previous) {
      const { id: _, updatedAt: __, ...rest } = previous;
      await prisma.settings.update({ where: { id: 1 }, data: rest });
    }
    await app?.close();
  });

  it('[REG-01.4] recusa variável desconhecida e variável fora do tipo', async () => {
    const put = (body: string) =>
      http().put('/api/v1/reminder-templates').set('Authorization', admin).send({ kind: 'CREATED', channel: 'EMAIL', subject: 'Oi', body });
    expect((await put('Olá {apelido}')).body.error.code).toBe('REMINDER_UNKNOWN_VARIABLE');
    expect((await put('Atraso {dias_atraso}')).body.error.code).toBe('REMINDER_VARIABLE_NOT_AVAILABLE');
  });

  it('[REG-03.1][REG-03.2][REG-03.4] plano do dia envia uma vez; cliente sem e-mail fica SKIPPED', async () => {
    const withEmail = await customer('cliente@exemplo.com');
    const noEmail = await customer(null);
    const a = await charge(withEmail.id, addDays(today, 3));
    const b = await charge(noEmail.id, addDays(today, 3));
    const late = await charge(withEmail.id, addDays(today, -7), 'OVERDUE');

    const service = app.get(RemindersService);
    await service.runDaily();
    await service.runDaily(); // rodar de novo não duplica (REG-03.2)

    const sent = await waitFor(() => logs(a.id), (l) => l.length === 1 && l[0]!.status === 'SENT');
    expect(sent).toMatchObject([{ kind: 'BEFORE_DUE', offsetDays: -3, status: 'SENT' }]);
    expect(await waitFor(() => logs(b.id), (l) => l.length === 1)).toMatchObject([{ status: 'SKIPPED', error: 'Cliente sem e-mail' }]);
    expect(await waitFor(() => logs(late.id), (l) => l.length === 1)).toMatchObject([{ kind: 'AFTER_DUE', offsetDays: 7, status: 'SENT' }]);
    await new Promise((r) => setTimeout(r, 500));
    expect(await logs(a.id)).toHaveLength(1);
  });

  it('[REG-04.2][REG-04.3][COB-10] emitida e paga avisam o cliente; envio manual registra MANUAL', async () => {
    const c = await customer('pagador@exemplo.com');
    const created = await http()
      .post('/api/v1/charges')
      .set('Authorization', fin)
      .send({
        customerId: c.id,
        plan: { items: [{ description: 'Consultoria', quantity: 1, unitPriceCents: 20_000 }], type: 'SINGLE', billingType: 'PIX', dueDate: { mode: 'FIXED_DATE', date: addDays(today, 5) }, finePct: 0, interestPct: 0 },
      });
    const id = created.body.charges[0].id as string;
    await waitFor(() => logs(id), (l) => l.some((x) => x.kind === 'CREATED' && x.status === 'SENT'));

    const manual = await http().post(`/api/v1/charges/${id}/send`).set('Authorization', fin).send({});
    expect(manual.body.sentAt).toBeTruthy();

    await http().post(`/api/v1/asaas-mock/charges/${id}/simulate`).set('Authorization', fin).send({ action: 'RECEIVE' }).expect(200);
    const all = await waitFor(() => logs(id), (l) => l.some((x) => x.kind === 'PAID'));
    expect(all.map((x) => x.kind).sort()).toEqual(['CREATED', 'MANUAL', 'PAID']);

    const noEmail = await customer(null);
    const other = await charge(noEmail.id, addDays(today, 5));
    expect((await http().post(`/api/v1/charges/${other.id}/send`).set('Authorization', fin).send({})).body.error.code).toBe('CUSTOMER_WITHOUT_EMAIL');
  });
});
