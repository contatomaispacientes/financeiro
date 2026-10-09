import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import * as argon2 from 'argon2';
import { DEFAULT_REMINDER_TEMPLATES, REMINDER_KINDS } from '@financeiro/shared';

const adapter = new PrismaPg({
  connectionString: process.env['DATABASE_URL']!,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Seeding...');

  // 1. Admin user
  const production = process.env['NODE_ENV'] === 'production';
  const adminEmail = (process.env['SEED_ADMIN_EMAIL'] ?? 'admin@financeiro.local').toLowerCase();
  const adminPassword = process.env['SEED_ADMIN_PASSWORD'] ?? (production ? undefined : 'admin12345678');
  if (!adminPassword) throw new Error('Defina SEED_ADMIN_PASSWORD (mín. 10 caracteres) para criar o admin.');
  const passwordHash = await argon2.hash(adminPassword, { type: argon2.argon2id });

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      name: 'Administrador',
      email: adminEmail,
      passwordHash,
      role: 'ADMIN',
    },
  });
  console.log('  ✓ Admin user');

  // 2. Settings
  await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      companyName: 'Minha Empresa',
      defaultDueDays: 3,
      defaultFinePct: 2,
      defaultInterestPct: 1,
      reminderDaysBefore: 3,
      reminderOnDueDate: true,
      reminderDaysAfter: [1, 7],
      reminderChannels: ['ASAAS'],
      contractChargeDueDays: 3,
    },
  });
  console.log('  ✓ Settings');

  // 3. Expense categories
  const categories = [
    'Pessoal',
    'Impostos',
    'Escritório',
    'Ferramentas',
    'Infraestrutura',
    'Serviços',
    'Marketing',
    'Outros',
  ];
  for (const name of categories) {
    await prisma.expenseCategory.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log('  ✓ Expense categories');

  // 4–6. Exemplos só fora de produção
  if (!production) {
    // 4. Services
    const services = [
      { name: 'Consultoria Financeira', defaultPriceCents: 50000 },
      { name: 'Planejamento Tributário', defaultPriceCents: 80000 },
      { name: 'Gestão de Cobranças', defaultPriceCents: 30000 },
      { name: 'Assessoria Contábil', defaultPriceCents: 120000 },
      { name: 'Análise de Crédito', defaultPriceCents: 25000 },
      { name: 'Treinamento Financeiro', defaultPriceCents: 150000 },
    ];
    for (const svc of services) {
      const existing = await prisma.service.findFirst({ where: { name: svc.name } });
      if (!existing) {
        await prisma.service.create({ data: svc });
      }
    }
    console.log('  ✓ Services');
  
    // 5. Customers (fictitious)
    const customers = [
      { name: 'Maria Silva', personType: 'PF' as const, document: '52998224725', email: 'maria@example.com', phone: '11999990001' },
      { name: 'João Santos', personType: 'PF' as const, document: '87748248800', email: 'joao@example.com', phone: '11999990002' },
      { name: 'Ana Oliveira', personType: 'PF' as const, document: '45316849890', email: 'ana@example.com', phone: '11999990003' },
      { name: 'Tech Solutions Ltda', personType: 'PJ' as const, document: '11222333000181', email: 'contato@techsol.com', phone: '11999990004' },
      { name: 'Comércio Rápido ME', personType: 'PJ' as const, document: '33025941000125', email: 'financeiro@comercio.com', phone: '11999990005' },
      { name: 'Indústria Brasil SA', personType: 'PJ' as const, document: '45997418000153', email: 'fiscal@industria.com', phone: '11999990006' },
    ];
    for (const cust of customers) {
      const existing = await prisma.customer.findFirst({ where: { document: cust.document } });
      if (!existing) {
        await prisma.customer.create({ data: cust });
      }
    }
    console.log('  ✓ Customers');
  }

  // 6. Modelo do provedor simulado: em dev e também em produção com CONTRACT_PROVIDER=fake (demonstração).
  if (!production || process.env['CONTRACT_PROVIDER'] === 'fake') {
    const existing = await prisma.contractTemplate.findFirst({
      where: { provider: 'fake', name: 'Contrato Padrão (Teste)' },
    });
    // Variáveis do catálogo (docs/integrations/contratos-provider.md); atualiza o mapeamento antigo.
    const variableMap = {
      nome_cliente: 'cliente.nome',
      documento_cliente: 'cliente.documento',
      endereco_cliente: 'cliente.endereco',
      servicos: 'servicos.lista',
      valor_total: 'cobranca.valor_total',
      forma_pagamento: 'cobranca.forma',
      condicao: 'cobranca.condicao',
      vencimento: 'cobranca.vencimento',
      empresa: 'empresa.nome',
      data: 'contrato.data',
    };
    if (!existing) {
      await prisma.contractTemplate.create({
        data: { name: 'Contrato Padrão (Teste)', provider: 'fake', providerTemplateId: 'fake-template-001', variableMap },
      });
    } else {
      await prisma.contractTemplate.update({ where: { id: existing.id }, data: { variableMap } });
    }
    console.log('  ✓ Contract template (fake)');
  }

  // 7. Mensagens da régua (REG-08.5): uma geral por tipo, com os textos padrão do shared.
  // Linhas antigas com a sintaxe {{…}} (fora do catálogo) são trocadas pelo padrão.
  await prisma.reminderTemplate.deleteMany({ where: { offsetDays: { not: null }, body: { contains: '{{' } } });
  for (const kind of REMINDER_KINDS) {
    const d = DEFAULT_REMINDER_TEMPLATES[kind];
    const exists = await prisma.reminderTemplate.findFirst({ where: { kind, channel: 'EMAIL', offsetDays: null } });
    if (!exists) {
      await prisma.reminderTemplate.create({ data: { kind, channel: 'EMAIL', subject: d.subject, body: d.body, active: d.active } });
    } else if (exists.body.includes('{{')) {
      await prisma.reminderTemplate.update({ where: { id: exists.id }, data: { subject: d.subject, body: d.body } });
    }
  }
  console.log('  ✓ Reminder templates');

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
