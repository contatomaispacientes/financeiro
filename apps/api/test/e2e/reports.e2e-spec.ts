import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { addMonthsToYearMonth, currentMonthInSaoPaulo } from '@financeiro/shared';
import { PrismaService } from '../../src/prisma/prisma.service';
import { billingFixtures } from '../fixtures/billing';
import { createTestApp, loginAs } from './test-app';

// Mês passado reservado a este arquivo: nenhum outro teste grava movimentos nele.
const MONTH = '2025-03';
const d = (day: string) => new Date(`${MONTH}-${day}T00:00:00Z`);

describe('Relatórios (integração)', () => {
  let app: INestApplication;
  let fin: string;
  let leitura: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    const prisma = app.get(PrismaService);
    fin = (await loginAs(app, 'FINANCEIRO')).auth;
    leitura = (await loginAs(app, 'LEITURA')).auth;

    const customer = await billingFixtures(prisma).customer({ name: 'Cliente Relatório' });
    const charge = await prisma.charge.create({
      data: {
        customerId: customer.id, type: 'SINGLE', status: 'PARTIALLY_REFUNDED', billingType: 'PIX',
        valueCents: 10_000, netValueCents: 9_700, refundedCents: 2_000, dueDate: d('05'), paidAt: d('10'),
        description: 'Consultoria (1x)', externalReference: `chg_${randomUUID()}`,
      },
    });
    await prisma.chargeRefund.create({ data: { chargeId: charge.id, kind: 'REFUND', valueCents: 2_000, refundedAt: d('20'), webhookEventId: randomUUID() } });
    const category = await prisma.expenseCategory.create({ data: { name: `Relatório ${Date.now()}` } });
    await prisma.expense.create({
      data: { description: 'Aluguel março', categoryId: category.id, valueCents: 3_000, dueDate: d('15'), status: 'PAID', paidAt: d('15'), paidValueCents: 3_000, paymentMethod: 'PIX' },
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('[FLX-02.1] mês passado: realizado com taxas e estornos; sem previsto', async () => {
    const res = await http().get('/api/v1/reports/cashflow').query({ from: MONTH, to: MONTH }).set('Authorization', fin);
    expect(res.status).toBe(200);
    expect(res.body.months[0]).toMatchObject({
      month: MONTH,
      inDoneCents: 10_000,
      feesCents: 300,
      refundsCents: 2_000,
      outDoneCents: 3_000 + 300 + 2_000,
      resultCents: 10_000 - 5_300,
      marginPct: 47,
      inForecastCents: 0,
      outForecastCents: 0,
      isFuture: false,
    });
  });

  it('[FLX-04.1][FLX-03.1] extrato em ordem de data e saídas por categoria com taxas e estornos', async () => {
    const statement = await http().get('/api/v1/reports/statement').query({ month: MONTH }).set('Authorization', fin);
    expect(statement.body.map((e: { date: string; kind: string; title: string; valueCents: number }) => [e.date, e.kind, e.title, e.valueCents])).toEqual([
      ['2025-03-10', 'IN', 'Cliente Relatório', 10_000],
      ['2025-03-10', 'OUT', 'Taxa Asaas', 300],
      ['2025-03-15', 'OUT', 'Aluguel março', 3_000],
      ['2025-03-20', 'OUT', 'Estorno', 2_000],
    ]);

    const byCategory = await http().get('/api/v1/reports/expenses-by-category').query({ month: MONTH }).set('Authorization', fin);
    expect(byCategory.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'Taxas Asaas', doneCents: 300 }),
        expect.objectContaining({ category: 'Estornos', doneCents: 2_000 }),
        expect.objectContaining({ doneCents: 3_000 }),
      ]),
    );
  });

  it('[FLX-06.1] CSV com BOM, ponto e vírgula e decimal com vírgula', async () => {
    const res = await http().get('/api/v1/reports/statement.csv').query({ month: MONTH }).set('Authorization', fin);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text.startsWith('﻿Data;Tipo;Descrição;Detalhe;Valor')).toBe(true);
    expect(res.text).toContain('10/03/2025;Entrada;Cliente Relatório;Consultoria (1x);100,00');
    expect(res.text).toContain('20/03/2025;Saída;Estorno;Cliente Relatório;-20,00');
  });

  it('[FLX-02.1] intervalo além de 3 meses à frente → 422 REPORT_RANGE_INVALID', async () => {
    const to = addMonthsToYearMonth(currentMonthInSaoPaulo(), 4);
    const res = await http().get('/api/v1/reports/cashflow').query({ to }).set('Authorization', fin);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('REPORT_RANGE_INVALID');
  });

  it('[FLX-01.1][FLX-01.4][FLX-05.1] dashboard com KPIs; LEITURA não vê eventos; inadimplência por faixa', async () => {
    const res = await http().get('/api/v1/reports/dashboard').query({ month: MONTH }).set('Authorization', leitura);
    expect(res.status).toBe(200);
    expect(res.body.kpis.receivedCents).toBe(10_000);
    expect(res.body.recentEvents).toEqual([]);
    expect(res.body.alerts).toEqual(expect.objectContaining({ staleDraftCharges: expect.any(Number) }));

    const aging = await http().get('/api/v1/reports/aging').set('Authorization', fin);
    expect(aging.body.buckets.map((b: { range: string }) => b.range)).toEqual(['1-15', '16-30', '31-60', '60+']);
    expect(aging.body.rateByMonth).toHaveLength(6);
  });
});
