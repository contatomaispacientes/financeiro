import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { addDays, addMonthsClamped, clampDay, currentMonthInSaoPaulo, todayInSaoPaulo } from '@financeiro/shared';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ExpensesService } from '../../src/modules/expenses/expenses.service';
import { createTestApp, loginAs } from './test-app';

describe('Despesas (integração)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fin: string;
  let admin: string;
  let leitura: string;
  let categoryId: string;
  const today = todayInSaoPaulo();
  const http = () => request(app.getHttpServer());
  const post = (path: string, body: object = {}, auth = fin) => http().post(`/api/v1${path}`).set('Authorization', auth).send(body);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    fin = (await loginAs(app, 'FINANCEIRO')).auth;
    admin = (await loginAs(app, 'ADMIN')).auth;
    leitura = (await loginAs(app, 'LEITURA')).auth;
    categoryId = (await prisma.expenseCategory.create({ data: { name: `Cat ${Date.now()}` } })).id;
  });

  afterAll(async () => {
    await app?.close();
  });

  const expense = (over: object = {}) =>
    post('/expenses', { description: 'Aluguel', categoryId, valueCents: 150_000, dueDate: today, ...over });

  it('[DSP-01.1] lança despesa; valida campos e categoria inativa', async () => {
    const res = await expense({ supplier: 'Imobiliária' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'OPEN', late: false, valueCents: 150_000, supplier: 'Imobiliária' });

    expect((await expense({ valueCents: 0 })).status).toBe(400);
    const inactive = await prisma.expenseCategory.create({ data: { name: `Inativa ${Date.now()}`, active: false } });
    expect((await expense({ categoryId: inactive.id })).body.error.code).toBe('CATEGORY_INACTIVE');
    expect((await post('/expenses', { description: 'X', categoryId, valueCents: 1, dueDate: today }, leitura)).status).toBe(403);
  });

  it('[DSP-02.1][DSP-02.2][DSP-01.2][DSP-01.3] paga com padrões, desfaz, trava edição e cancela', async () => {
    const { id } = (await expense()).body;
    const paid = await post(`/expenses/${id}/pay`, { paymentMethod: 'PIX' });
    expect(paid.body).toMatchObject({ status: 'PAID', paidAt: today, paidValueCents: 150_000, paymentMethod: 'PIX' });
    expect((await post(`/expenses/${id}/pay`, { paymentMethod: 'PIX' })).body.error.code).toBe('EXPENSE_INVALID_STATE');

    const locked = await http().patch(`/api/v1/expenses/${id}`).set('Authorization', fin).send({ valueCents: 1 });
    expect(locked.body.error.code).toBe('EXPENSE_NOT_EDITABLE');
    expect((await http().patch(`/api/v1/expenses/${id}`).set('Authorization', fin).send({ notes: 'ok' })).status).toBe(200);

    expect((await post(`/expenses/${id}/unpay`)).body).toMatchObject({ status: 'OPEN', paidAt: null });
    expect((await post(`/expenses/${id}/cancel`)).body.status).toBe('CANCELED');
    expect(await prisma.auditLog.count({ where: { entityId: id, action: { in: ['expense.pay', 'expense.unpay', 'expense.cancel'] } } })).toBe(3);
  });

  it('[DSP-02.3][DSP-05.1][DSP-05.2] atrasada é derivada; filtros e KPIs do mês', async () => {
    const tag = `Filtro ${Date.now()}`;
    const late = (await expense({ description: tag, dueDate: addDays(today, -3), valueCents: 1_000 })).body;
    expect(late.late).toBe(true);
    await expense({ description: tag, dueDate: addDays(today, 5), valueCents: 2_000, supplier: 'Fornecedor X' });

    const onlyLate = await http().get('/api/v1/expenses').query({ state: 'late', search: tag }).set('Authorization', leitura);
    expect(onlyLate.body.data.map((e: { id: string }) => e.id)).toEqual([late.id]);
    const bySupplier = await http().get('/api/v1/expenses').query({ search: 'fornecedor x' }).set('Authorization', fin);
    expect(bySupplier.body.data.every((e: { supplier: string }) => e.supplier === 'Fornecedor X')).toBe(true);

    const { summary } = onlyLate.body;
    expect(summary.lateCents).toBeGreaterThanOrEqual(1_000);
    expect(summary.openCents).toBeGreaterThanOrEqual(summary.lateCents + 2_000);
    expect(summary.countByState.late).toBeGreaterThanOrEqual(1);
  });

  it('[DSP-03.1][DSP-03.2][DSP-03.3] recorrência gera a despesa do mês na criação e uma única vez', async () => {
    const month = currentMonthInSaoPaulo();
    const res = await post('/expense-recurrences', { description: `Internet ${Date.now()}`, categoryId, valueCents: 9_900, dayOfMonth: 31, startMonth: month });
    expect(res.status).toBe(201);
    expect(res.body.lastGeneratedFor).toBe(month);

    const service = app.get(ExpensesService);
    await service.generateFor(month);
    await service.generateFor(month);
    const generated = await prisma.expense.findMany({ where: { recurrenceId: res.body.id } });
    expect(generated).toHaveLength(1);
    expect(generated[0]!.dueDate.toISOString().slice(0, 10)).toBe(clampDay(month, 31));

    // DSP-03.4/03.5: pausar impede novas gerações; despesas já geradas não mudam.
    await http().patch(`/api/v1/expense-recurrences/${res.body.id}`).set('Authorization', fin).send({ active: false, valueCents: 1 });
    const next = addMonthsClamped(`${month}-01`, 1).slice(0, 7);
    await service.generateFor(next);
    expect(await prisma.expense.count({ where: { recurrenceId: res.body.id } })).toBe(1);
    expect((await prisma.expense.findFirst({ where: { recurrenceId: res.body.id } }))!.valueCents).toBe(9_900);
  });

  it('[DSP-03.6] "repetir todo mês" cria recorrência e despesa juntas', async () => {
    const res = await expense({ description: `Contador ${Date.now()}`, repeatMonthly: true });
    expect(res.body.recurrenceId).toBeTruthy();
    const rec = await prisma.expenseRecurrence.findUnique({ where: { id: res.body.recurrenceId } });
    expect(rec).toMatchObject({ startMonth: today.slice(0, 7), dayOfMonth: Number(today.slice(8, 10)), valueCents: 150_000 });
  });

  it('[DSP-04.1] categorias: ADMIN cria e renomeia; em uso não exclui; FINANCEIRO não altera', async () => {
    const created = await post('/expense-categories', { name: `Nova ${Date.now()}` }, admin);
    expect(created.status).toBe(201);
    expect((await post('/expense-categories', { name: 'Outra' }, fin)).status).toBe(403);
    const del = await http().delete(`/api/v1/expense-categories/${categoryId}`).set('Authorization', admin);
    expect(del.body.error.code).toBe('CATEGORY_IN_USE');
    expect((await http().delete(`/api/v1/expense-categories/${created.body.id}`).set('Authorization', admin)).status).toBe(204);
  });
});
