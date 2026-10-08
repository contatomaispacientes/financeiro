/**
 * Dados de demonstração para testar dashboard, fluxo, despesas e log sem chamar o Asaas.
 * Só para desenvolvimento: recusa rodar com NODE_ENV=production. Pode rodar de novo (não duplica).
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { addDays, addMonthsClamped, clampDay, todayInSaoPaulo } from '@financeiro/shared';

if (process.env['NODE_ENV'] === 'production') {
  console.error('seed-demo não roda em produção.');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env['DATABASE_URL']! }) });
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

async function main() {
  if (await prisma.charge.count({ where: { externalReference: { startsWith: 'demo_' } } })) {
    console.log('Dados de demonstração já existem.');
    return;
  }
  const today = todayInSaoPaulo();
  const month = today.slice(0, 7);
  const customers = await prisma.customer.findMany({ where: { archivedAt: null }, take: 6, orderBy: { name: 'asc' } });
  const services = await prisma.service.findMany({ where: { active: true }, take: 6 });
  if (!customers.length || !services.length) throw new Error('Rode antes o seed principal (pnpm db:seed).');

  let n = 0;
  async function charge(status: 'PAID' | 'PENDING' | 'OVERDUE' | 'CONFIRMED', due: string, paidAt: string | null) {
    const customer = customers[n % customers.length]!;
    const service = services[n % services.length]!;
    const qty = (n % 3) + 1;
    const value = service.defaultPriceCents * qty;
    const paid = status === 'PAID' || status === 'CONFIRMED';
    n++;
    return prisma.charge.create({
      data: {
        customerId: customer.id, type: 'SINGLE', status, billingType: n % 2 ? 'PIX' : 'BOLETO',
        valueCents: value, netValueCents: paid ? value - 199 : null, dueDate: d(due), paidAt: paidAt ? d(paidAt) : null,
        description: `${service.name} (${qty}x)`, externalReference: `demo_${randomUUID()}`, asaasPaymentId: `pay_demo${randomUUID().slice(0, 12)}`,
        invoiceUrl: 'https://sandbox.asaas.com/i/demo', finePct: 2, interestPct: 1,
        items: { create: { serviceId: service.id, description: service.name, quantity: qty, unitPriceCents: service.defaultPriceCents, totalCents: value } },
      },
    });
  }

  // Seis meses de histórico pago + mês atual com pagos, a vencer e vencidos.
  for (let i = 6; i >= 1; i--) {
    const m = addMonthsClamped(`${month}-01`, -i).slice(0, 7);
    for (const day of [5, 12, 20]) await charge('PAID', clampDay(m, day), clampDay(m, day + 1));
    await charge('OVERDUE', clampDay(m, 25), null).catch(() => undefined);
  }
  await charge('PAID', addDays(today, -3), addDays(today, -2));
  await charge('CONFIRMED', addDays(today, -1), addDays(today, -1));
  for (const offset of [2, 6, 10, 15]) await charge('PENDING', addDays(today, offset), null);
  const overdue = await charge('OVERDUE', addDays(today, -8), null);

  // Despesas: categorias do seed principal.
  const cats = Object.fromEntries((await prisma.expenseCategory.findMany()).map((c) => [c.name, c.id]));
  const recurring = [
    { description: 'Aluguel do escritório', category: 'Escritório', supplier: 'Imobiliária Centro', valueCents: 350_000, day: 5 },
    { description: 'Internet fibra', category: 'Infraestrutura', supplier: 'Operadora', valueCents: 19_990, day: 10 },
    { description: 'Contabilidade', category: 'Serviços', supplier: 'Escritório Contábil', valueCents: 89_000, day: 15 },
  ];
  for (const r of recurring) {
    const rec = await prisma.expenseRecurrence.create({
      data: { description: r.description, categoryId: cats[r.category]!, supplier: r.supplier, valueCents: r.valueCents, dayOfMonth: r.day, startMonth: addMonthsClamped(`${month}-01`, -6).slice(0, 7), lastGeneratedFor: month },
    });
    for (let i = 6; i >= 0; i--) {
      const m = addMonthsClamped(`${month}-01`, -i).slice(0, 7);
      const due = clampDay(m, r.day);
      const paid = due < today && !(i === 0 && r.day === 15);
      await prisma.expense.create({
        data: {
          description: r.description, categoryId: rec.categoryId, supplier: r.supplier, valueCents: r.valueCents, dueDate: d(due),
          status: paid ? 'PAID' : 'OPEN', paidAt: paid ? d(due) : null, paidValueCents: paid ? r.valueCents : null, paymentMethod: paid ? 'PIX' : null,
          recurrenceId: rec.id, referenceMonth: m,
        },
      });
    }
  }
  await prisma.expense.create({ data: { description: 'Licença de software', categoryId: cats['Ferramentas']!, supplier: 'SaaS Ltda', valueCents: 12_900, dueDate: d(addDays(today, 7)) } });
  await prisma.expense.create({ data: { description: 'Impostos (DAS)', categoryId: cats['Impostos']!, valueCents: 64_500, dueDate: d(addDays(today, -4)) } });

  // Eventos do Asaas (log): um aplicado, um ignorado e um com erro para testar "Reprocessar".
  const ev = (event: string, data: object) =>
    prisma.webhookEvent.create({ data: { source: 'ASAAS', externalEventId: `evt_demo_${randomUUID()}`, event, resourceId: overdue.asaasPaymentId, payload: { event, payment: { id: overdue.asaasPaymentId } }, ...data } });
  await ev('PAYMENT_CREATED', { processedAt: new Date(), result: 'APPLIED', attempts: 1 });
  await ev('PAYMENT_OVERDUE', { processedAt: new Date(), result: 'APPLIED', attempts: 1 });
  await ev('PAYMENT_BANK_SLIP_VIEWED', { processedAt: new Date(), result: 'IGNORED', attempts: 1 });
  await ev('PAYMENT_UPDATED', { attempts: 5, error: 'Exemplo de falha: tempo esgotado ao gravar (demonstração)' });

  console.log(`Demonstração criada: ${n} cobranças, despesas de 7 meses e 4 eventos.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
