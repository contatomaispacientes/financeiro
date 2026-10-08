import { randomUUID } from 'node:crypto';
import type { ChargeStatus, ContractStatus, SubscriptionStatus } from '@financeiro/shared';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { nextCpf } from './documents';

/** Fábricas diretas no banco para testes de módulos que só leem cobranças/contratos/assinaturas. */
export function billingFixtures(prisma: PrismaService) {
  return {
    customer(overrides: Partial<{ name: string; document: string; asaasCustomerId: string; archivedAt: Date }> = {}) {
      return prisma.customer.create({
        data: { name: 'Cliente de Teste', personType: 'PF', document: nextCpf(), ...overrides },
      });
    },

    charge(customerId: string, status: ChargeStatus, valueCents: number, extra: { dueDate?: string; refundedCents?: number } = {}) {
      return prisma.charge.create({
        data: {
          customerId,
          type: 'SINGLE',
          status,
          billingType: 'PIX',
          valueCents,
          refundedCents: extra.refundedCents ?? 0,
          dueDate: new Date(`${extra.dueDate ?? '2026-10-20'}T00:00:00Z`),
          description: `Cobrança ${status}`,
          externalReference: `chg_${randomUUID()}`,
        },
      });
    },

    async contract(customerId: string, status: ContractStatus) {
      const template = await prisma.contractTemplate.create({
        data: { name: 'Modelo de teste', provider: 'fake', providerTemplateId: 'fake-1', variableMap: {} },
      });
      return prisma.contract.create({
        data: {
          customerId,
          templateId: template.id,
          title: `Contrato ${status}`,
          status,
          provider: 'fake',
          variables: {},
          chargePlan: {},
          totalCents: 100_000,
        },
      });
    },

    subscription(customerId: string, status: SubscriptionStatus) {
      return prisma.subscription.create({
        data: {
          customerId,
          status,
          billingType: 'BOLETO',
          valueCents: 50_000,
          cycle: 'MONTHLY',
          nextDueDate: new Date('2026-11-05T00:00:00Z'),
          description: `Assinatura ${status}`,
          externalReference: `rec_${randomUUID()}`,
        },
      });
    },
  };
}
