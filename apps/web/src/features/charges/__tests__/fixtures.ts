import type { ChargeDetailDto, CustomerDetailDto, CustomerListItemDto, ServiceListItemDto } from '@financeiro/shared';

export const customerItem: CustomerListItemDto = {
  id: 'c-1',
  name: 'Maria Silva',
  personType: 'PF',
  document: '52998224725',
  email: 'maria@example.com',
  phone: null,
  asaasCustomerId: null,
  archivedAt: null,
  chargesCount: 0,
  paidCents: 0,
  openCents: 0,
  overdueCents: 0,
};

export function customerDetail(overrides: Partial<CustomerDetailDto> = {}): CustomerDetailDto {
  return {
    ...customerItem,
    address: null,
    notes: null,
    remindersEnabled: true,
    asaasSyncError: null,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    totals: { chargesCount: 0, paidCents: 0, openCents: 0, overdueCents: 0 },
    recentCharges: [],
    subscriptions: [],
    contracts: [],
    ...overrides,
  };
}

function service(id: string, name: string, defaultPriceCents: number): ServiceListItemDto {
  return {
    id,
    name,
    description: null,
    defaultPriceCents,
    active: true,
    usageCount: 0,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
  };
}

// O ChargePlanSchema exige UUID válido em serviceId.
export const consulting = service('0f8f5a3e-1c2d-4e5f-8a9b-1234567890ab', 'Consultoria', 15_000);
export const fee = service('6b1d2c3e-4f5a-4b6c-9d7e-0a1b2c3d4e5f', 'Taxa de adesão', 300);

export function chargeDetail(overrides: Partial<ChargeDetailDto> = {}): ChargeDetailDto {
  return {
    id: 'ch-1',
    customer: { id: 'c-1', name: 'Maria Silva', document: '52998224725' },
    origin: 'MANUAL',
    type: 'SINGLE',
    status: 'PENDING',
    billingType: 'PIX',
    valueCents: 30_000,
    netValueCents: null,
    refundedCents: 0,
    discountCents: 0,
    finePct: 2,
    interestPct: 1,
    dueDate: '2026-10-11',
    paidAt: null,
    description: 'Consultoria (2x)',
    installmentNumber: null,
    installmentCount: null,
    groupKey: null,
    asaasPaymentId: 'pay_123',
    asaasInstallmentId: null,
    invoiceUrl: 'https://sandbox.asaas.com/i/123',
    bankSlipUrl: null,
    pixPayload: '00020126580014br.gov.bcb.pix0136pix-123',
    identificationField: null,
    lastError: null,
    contractId: null,
    subscriptionId: null,
    items: [
      {
        id: 'it-1',
        serviceId: consulting.id,
        description: 'Consultoria',
        quantity: 2,
        unitPriceCents: 15_000,
        totalCents: 30_000,
      },
    ],
    events: [],
    createdAt: '2026-10-08T12:00:00.000Z',
    updatedAt: '2026-10-08T12:00:00.000Z',
    ...overrides,
  };
}
